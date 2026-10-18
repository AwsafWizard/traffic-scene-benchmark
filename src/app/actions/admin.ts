"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { audit } from "@/server/audit";
import { actionUser, AuthError } from "@/server/auth";
import { sql } from "@/server/db";
import { deleteConnection, listRemoteModels, saveConnection } from "@/server/connections";
import { deleteModel, recordManualAnswer, runModelApi, saveModel } from "@/server/models";
import { reviewQuestion, type ReviewAction } from "@/server/questions";
import {
  addAssignment,
  closeSprint,
  createSprint,
  drawModelSample,
  drawSprintCheckers,
  removeAssignment,
  setCheckerSlot,
  startVerification,
  startWriting,
  updateAssignmentTarget,
  updateSprint,
} from "@/server/sprints";
import {
  deleteCategory,
  deleteSubtype,
  moveQuestionToSubtype,
  saveCategory,
  saveSubtype,
  saveTag,
  saveTagGroup,
} from "@/server/taxonomy";
import { listRepoVideos, parseRepo } from "@/server/hf";
import { addVideos, deleteVideo, listVideos, setFolderActive, setVideoActive } from "@/server/videos";
import {
  changeAdminPassword,
  createAnnotator,
  renameAnnotator,
  resetAnnotatorPassword,
  setAnnotatorActive,
} from "@/server/users";

export type AdminState = { error?: string; ok?: string; secret?: { username: string; password: string } } | undefined;

/** Every action checks the role itself: server actions are reachable by direct POST. */
async function admin() {
  return actionUser("admin");
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "");
const num = (form: FormData, key: string) => Number(form.get(key));
const flag = (form: FormData, key: string) => form.get(key) === "on" || form.get(key) === "true";

async function guarded(run: () => Promise<AdminState>): Promise<AdminState> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof AuthError) return { error: error.message };
    throw error;
  }
}

// Accounts -------------------------------------------------------------------------------

export async function createAnnotatorAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    const result = await createAnnotator(me.id, text(form, "username"), text(form, "display_name"));
    if (!result.ok) return { error: result.error };
    revalidatePath("/admin/annotators");
    return { ok: "Account created.", secret: { username: result.username, password: result.password } };
  });
}

export async function resetPasswordAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    const password = await resetAnnotatorPassword(me.id, text(form, "user_id"));
    if (!password) return { error: "Annotator not found." };
    return { ok: "Password reset. They've been signed out everywhere.", secret: { username: text(form, "username"), password } };
  });
}

export async function setActiveAction(form: FormData): Promise<void> {
  const me = await admin();
  await setAnnotatorActive(me.id, text(form, "user_id"), flag(form, "active"));
  revalidatePath("/admin/annotators");
}

export async function renameAnnotatorAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    const error = await renameAnnotator(me.id, text(form, "user_id"), text(form, "display_name"));
    if (error) return { error };
    revalidatePath("/admin/annotators");
    return { ok: "Saved." };
  });
}

export async function changePasswordAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    if (text(form, "next") !== text(form, "confirm")) return { error: "The new passwords don't match." };
    const error = await changeAdminPassword(me.id, text(form, "current"), text(form, "next"));
    return error ? { error } : { ok: "Password changed. Other sessions were signed out." };
  });
}

// Videos -------------------------------------------------------------------------------------

export type RepoListing =
  | { ok: true; repo: string; files: { path: string; size: number | null; inLibrary: boolean }[] }
  | { ok: false; error: string };

/** Lists the videos in a Hugging Face dataset repo, marking the ones already in the library. */
export async function findRepoVideosAction(input: string): Promise<RepoListing> {
  try {
    await admin();
    const repo = parseRepo(String(input));
    if (!repo) return { ok: false, error: "Enter the repo as owner/name, or paste its link." };
    const [files, library] = await Promise.all([listRepoVideos(repo), listVideos()]);
    if (files.length === 0) return { ok: false, error: "There are no videos in that repo." };
    const known = new Set(library.filter((v) => v.repo === repo).map((v) => v.path));
    return { ok: true, repo, files: files.map((f) => ({ ...f, inLibrary: known.has(f.path) })) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't read the repo." };
  }
}

/** Adds videos from a repo. The paths are checked against the repo itself. */
export async function addVideosAction(input: string, paths: string[]): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
  try {
    const me = await admin();
    const repo = parseRepo(String(input));
    if (!repo) return { ok: false, error: "That isn't a repo name." };
    const wanted = new Set(Array.isArray(paths) ? paths.map(String) : []);
    const files = (await listRepoVideos(repo)).filter((f) => wanted.has(f.path));
    if (files.length === 0) return { ok: false, error: "No videos to add." };
    const added = await addVideos(me.id, repo, files);
    revalidatePath("/admin/videos");
    return { ok: true, added };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Couldn't add the videos." };
  }
}

export async function setVideoActiveAction(form: FormData): Promise<void> {
  const me = await admin();
  await setVideoActive(me.id, num(form, "id"), flag(form, "active"));
  revalidatePath("/admin/videos");
}

export async function setFolderActiveAction(form: FormData): Promise<void> {
  const me = await admin();
  await setFolderActive(me.id, text(form, "repo"), text(form, "folder"), flag(form, "active"));
  revalidatePath("/admin/videos");
}

export async function deleteVideoAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    await deleteVideo(me.id, num(form, "id"));
    revalidatePath("/admin/videos");
    return { ok: "Removed." };
  });
}

// Taxonomy -----------------------------------------------------------------------------------

export async function saveCategoryAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    const id = num(form, "id") || undefined;
    const input = { id, code: text(form, "code"), name: text(form, "name"), description: text(form, "description"), sort: num(form, "sort") || 0, active: flag(form, "active") };
    const result = await saveCategory(input);
    if (!result.ok) return { error: result.error };
    await audit(me.id, id ? "category.update" : "category.create", id ?? input.code, input);
    revalidatePath("/admin/taxonomy");
    return { ok: "Saved." };
  });
}

export async function saveSubtypeAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    const id = num(form, "id") || undefined;
    const input = {
      id,
      category_id: num(form, "category_id"),
      code: text(form, "code"),
      name: text(form, "name"),
      keywords: text(form, "keywords"),
      verifiability: text(form, "verifiability"),
      regional: flag(form, "regional"),
      sort: num(form, "sort") || 0,
      active: flag(form, "active"),
    };
    const result = await saveSubtype(input);
    if (!result.ok) return { error: result.error };
    await audit(me.id, id ? "subtype.update" : "subtype.create", id ?? input.code, input);
    revalidatePath("/admin/taxonomy");
    return { ok: "Saved." };
  });
}

export async function deleteSubtypeAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    const id = num(form, "id");
    const result = await deleteSubtype(id);
    if (!result.ok) return { error: result.error };
    await audit(me.id, "subtype.delete", id, { questions: result.questions, topics: result.topics });
    revalidatePath("/admin/taxonomy");
    return { ok: "Deleted." };
  });
}

export async function deleteCategoryAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    const id = num(form, "id");
    const result = await deleteCategory(id);
    if (!result.ok) return { error: result.error };
    await audit(me.id, "category.delete", id, { topics: result.topics });
    revalidatePath("/admin/taxonomy");
    return { ok: "Deleted." };
  });
}

export async function moveQuestionAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    const id = text(form, "question_id");
    const subtypeId = num(form, "subtype_id");
    const result = await moveQuestionToSubtype(id, subtypeId);
    if (!result.ok) return { error: result.error };
    await audit(me.id, "question.move", id, { subtype_id: subtypeId, from: result.from, to: result.to });
    revalidatePath(`/admin/questions/${id}`);
    return { ok: result.from === result.to ? "Moved." : `Moved. Its code is now ${result.to} (was ${result.from}).` };
  });
}

export async function saveTagGroupAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    const id = num(form, "id") || undefined;
    const input = { id, name: text(form, "name"), required: flag(form, "required"), sort: num(form, "sort") || 0, active: flag(form, "active") };
    const result = await saveTagGroup(input);
    if (!result.ok) return { error: result.error };
    await audit(me.id, id ? "tag_group.update" : "tag_group.create", id ?? input.name, input);
    revalidatePath("/admin/taxonomy");
    return { ok: "Saved." };
  });
}

export async function saveTagAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    const id = num(form, "id") || undefined;
    const input = { id, group_id: num(form, "group_id"), name: text(form, "name"), sort: num(form, "sort") || 0, active: flag(form, "active") };
    const result = await saveTag(input);
    if (!result.ok) return { error: result.error };
    await audit(me.id, id ? "tag.update" : "tag.create", id ?? input.name, input);
    revalidatePath("/admin/taxonomy");
    return { ok: "Saved." };
  });
}

// Sprints --------------------------------------------------------------------------------------

export async function createSprintAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  const me = await admin();
  const result = await createSprint(me.id, text(form, "name"), num(form, "sample_pct"));
  if (!result.ok) return { error: result.error };
  redirect(`/admin/sprints/${result.id}`);
}

export async function updateSprintAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    const id = num(form, "sprint_id");
    const result = await updateSprint(me.id, id, text(form, "name"), num(form, "sample_pct"));
    if (!result.ok) return { error: result.error };
    revalidatePath(`/admin/sprints/${id}`);
    return { ok: "Saved." };
  });
}

export async function addAssignmentAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    const sprintId = num(form, "sprint_id");
    // "topic" is "c:<category id>" for a whole type or "s:<subtype id>" for one subtype.
    const [kind, rawId] = text(form, "topic").split(":");
    let categoryId = Number(rawId);
    let subtypeId: number | null = null;
    if (kind === "s") {
      const [row] = await sql<{ category_id: number }[]>`select category_id from subtypes where id = ${Number(rawId)}`;
      if (!row) return { error: "Pick a topic." };
      categoryId = row.category_id;
      subtypeId = Number(rawId);
    } else if (kind !== "c") {
      return { error: "Pick a topic." };
    }
    const result = await addAssignment(me.id, sprintId, {
      annotatorId: text(form, "annotator_id"),
      categoryId,
      subtypeId,
      target: num(form, "target"),
    });
    if (!result.ok) return { error: result.error };
    revalidatePath(`/admin/sprints/${sprintId}`);
    return { ok: "Topic assigned." };
  });
}

/** Stage changes and small edits on the sprint page share one action, picked by "op". */
export async function sprintOpAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    const sprintId = num(form, "sprint_id");
    const op = text(form, "op");
    let result: { ok: boolean; error?: string; size?: number };
    switch (op) {
      case "target":
        result = await updateAssignmentTarget(me.id, num(form, "assignment_id"), num(form, "target"));
        break;
      case "remove":
        result = await removeAssignment(me.id, num(form, "assignment_id"));
        break;
      case "start_writing":
        result = await startWriting(me.id, sprintId);
        break;
      case "draw":
        result = await drawSprintCheckers(me.id, sprintId);
        break;
      case "set_checker":
        result = await setCheckerSlot(me.id, num(form, "assignment_id"), num(form, "slot"), text(form, "checker_id"));
        break;
      case "start_verification":
        result = await startVerification(me.id, sprintId);
        break;
      case "close":
        result = await closeSprint(me.id, sprintId);
        break;
      case "sample":
        result = await drawModelSample(me.id, sprintId);
        break;
      default:
        return { error: "Unknown action." };
    }
    revalidatePath(`/admin/sprints/${sprintId}`);
    if (!result.ok) return { error: result.error };
    return { ok: op === "sample" ? `Sample drawn: ${result.size} questions.` : "Done." };
  });
}

// Questions --------------------------------------------------------------------------------------

export async function reviewAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    const id = text(form, "question_id");
    const action = text(form, "action") as ReviewAction;
    if (!["accept", "fix", "send_back", "drop", "restore"].includes(action)) return { error: "Unknown action." };
    const options = form.getAll("option").map(String);
    const result = await reviewQuestion(me.id, id, action, {
      note: text(form, "note"),
      prompt: action === "fix" ? text(form, "prompt") : undefined,
      options: action === "fix" ? options : undefined,
      correctIndex: action === "fix" ? num(form, "correct") : undefined,
    });
    if (!result.ok) return { error: result.error };
    revalidatePath(`/admin/questions/${id}`);
    return { ok: "Saved." };
  });
}

// Models -------------------------------------------------------------------------------------------

export async function saveModelAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    const result = await saveModel(me.id, {
      id: num(form, "id") || undefined,
      name: text(form, "name"),
      provider: text(form, "provider"),
      family: text(form, "family"),
      funded: flag(form, "funded"),
      model_id: text(form, "model_id"),
      connection_id: num(form, "connection_id") || null,
      price_in: text(form, "price_in"),
      price_out: text(form, "price_out"),
      request_options: text(form, "request_options"),
      notes: text(form, "notes"),
      active: flag(form, "active"),
    });
    if (!result.ok) return { error: result.error };
    revalidatePath("/admin/models");
    return { ok: "Saved." };
  });
}

export async function saveConnectionAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    const result = await saveConnection(me.id, {
      id: num(form, "id") || undefined,
      name: text(form, "name"),
      kind: text(form, "kind"),
      base_url: text(form, "base_url"),
      api_key: text(form, "api_key"),
      active: flag(form, "active"),
      clear_key: flag(form, "clear_key"),
    });
    if (!result.ok) return { error: result.error };
    revalidatePath("/admin/models");
    return { ok: "Saved. The key is stored encrypted and won't be shown again." };
  });
}

export async function deleteModelAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    const result = await deleteModel(me.id, num(form, "id"));
    if (!result.ok) return { error: result.error };
    revalidatePath("/admin/models");
    return { ok: "Deleted." };
  });
}

export async function deleteConnectionAction(form: FormData): Promise<void> {
  const me = await admin();
  await deleteConnection(me.id, num(form, "id"));
  revalidatePath("/admin/models");
}

/** Checks a connection's key and returns the model IDs it can use. */
export async function listRemoteModelsAction(connectionId: number): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  try {
    await admin();
    return await listRemoteModels(Number(connectionId));
  } catch (error) {
    return { ok: false, error: error instanceof AuthError ? error.message : "Couldn't reach the provider." };
  }
}

export async function manualModelAnswerAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    const questionId = text(form, "question_id");
    const order = text(form, "order").split(",").filter(Boolean);
    const result = await recordManualAnswer(me.id, questionId, num(form, "model_id"), order, text(form, "chosen"), text(form, "raw"));
    if (!result.ok) return { error: result.error };
    revalidatePath(`/admin/questions/${questionId}`);
    revalidatePath("/admin/models/check");
    return { ok: "Recorded." };
  });
}

export async function runModelAction(_prev: AdminState, form: FormData): Promise<AdminState> {
  return guarded(async () => {
    const me = await admin();
    const questionId = text(form, "question_id");
    const result = await runModelApi(me.id, questionId, num(form, "model_id"));
    revalidatePath(`/admin/questions/${questionId}`);
    revalidatePath("/admin/models/check");
    return result.ok ? { ok: "Answer recorded." } : { error: result.error };
  });
}

/** One model, one question: the client-side runner calls this repeatedly, so no request runs long. */
export async function runOneAction(questionId: string, modelId: number): Promise<{ ok: boolean; error?: string }> {
  try {
    const me = await admin();
    const result = await runModelApi(me.id, String(questionId), Number(modelId));
    return result.ok ? { ok: true } : { ok: false, error: result.error };
  } catch (error) {
    return { ok: false, error: error instanceof AuthError ? error.message : "Request failed" };
  }
}
