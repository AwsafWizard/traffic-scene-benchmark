"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { actionUser, AuthError } from "@/server/auth";
import { nextTaskId, submitBlind, submitJudgment } from "@/server/checks";
import { sql } from "@/server/db";
import {
  createQuestion,
  deleteQuestion,
  resubmitQuestion,
  setImageTags,
  updateQuestion,
  type QuestionInput,
} from "@/server/questions";
import type { Result } from "@/server/sprints";
import {
  imageSrc,
  registerCloudinaryUpload,
  uploadTicket,
  type CloudinaryUploadResult,
  type UploadTicket,
} from "@/server/storage";

/** Every action re-checks the session itself: server actions are reachable by direct POST. */
async function annotator() {
  return actionUser("annotator");
}

function failure(error: unknown): Result {
  if (error instanceof AuthError) return { ok: false, error: error.message };
  console.error(error);
  return { ok: false, error: "Something went wrong. Try again." };
}

export async function getUploadTicketAction(): Promise<UploadTicket | { error: string }> {
  try {
    return uploadTicket((await annotator()).id);
  } catch (error) {
    const result = failure(error);
    return { error: result.ok ? "Uploads are unavailable." : result.error };
  }
}

export async function registerUploadAction(result: CloudinaryUploadResult): Promise<{ id: string; src: string } | { error: string }> {
  try {
    const user = await annotator();
    const id = await registerCloudinaryUpload(user.id, result);
    const [image] = await sql<{ id: string; storage: "cloudinary"; storage_key: string; version: string }[]>`
      select id, storage, storage_key, version from images where id = ${id}`;
    return { id, src: imageSrc(image, 900) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Upload failed." };
  }
}

export async function saveImageTagsAction(imageId: string, tagIds: number[]): Promise<Result> {
  try {
    const user = await annotator();
    return await setImageTags(user.id, imageId, tagIds.filter(Number.isInteger));
  } catch (error) {
    return failure(error);
  }
}

function cleanInput(raw: QuestionInput): QuestionInput {
  return {
    subtypeId: Number(raw.subtypeId),
    imageId: String(raw.imageId ?? ""),
    prompt: String(raw.prompt ?? ""),
    options: Array.isArray(raw.options) ? raw.options.map(String) : [],
    correctIndex: Number(raw.correctIndex),
  };
}

export async function createQuestionAction(assignmentId: number, raw: QuestionInput): Promise<Result> {
  try {
    const user = await annotator();
    const result = await createQuestion(user.id, Number(assignmentId), cleanInput(raw));
    if (result.ok) revalidatePath("/");
    return result;
  } catch (error) {
    return failure(error);
  }
}

export async function updateQuestionAction(questionId: string, raw: QuestionInput): Promise<Result> {
  try {
    const user = await annotator();
    const result = await updateQuestion(user.id, String(questionId), cleanInput(raw));
    if (result.ok) revalidatePath("/questions");
    return result;
  } catch (error) {
    return failure(error);
  }
}

export async function deleteQuestionAction(questionId: string): Promise<void> {
  const user = await annotator();
  const result = await deleteQuestion(user.id, String(questionId));
  if (!result.ok) throw new Error(result.error);
  redirect("/questions");
}

export async function resubmitQuestionAction(questionId: string): Promise<void> {
  const user = await annotator();
  const result = await resubmitQuestion(user.id, String(questionId));
  if (!result.ok) throw new Error(result.error);
  redirect("/questions");
}

export async function submitBlindAction(checkId: string, choice: string, note: string): Promise<Result> {
  try {
    const user = await annotator();
    return await submitBlind(user.id, String(checkId), String(choice), String(note ?? ""));
  } catch (error) {
    return failure(error);
  }
}

export async function submitJudgmentAction(
  checkId: string,
  judgment: string,
  reason: string,
  oddOne: string | null,
): Promise<Result> {
  try {
    const user = await annotator();
    return await submitJudgment(user.id, String(checkId), String(judgment), String(reason ?? ""), oddOne ? String(oddOne) : null);
  } catch (error) {
    return failure(error);
  }
}

export async function goToNextTaskAction(): Promise<void> {
  const user = await annotator();
  const next = await nextTaskId(user.id);
  redirect(next ? `/check/${next}` : "/check?done=1");
}
