import "server-only";
import { audit } from "./audit";
import { sql, type Tx } from "./db";
import { shuffled, type Verifiability } from "./engine";
import { liveSprint, sprintAssignments, type Assignment, type Result } from "./sprints";
import type { StoredImage } from "./storage";

export type Option = {
  id: string;
  text: string;
};

const OPTION_IDS = ["a", "b", "c", "d", "e"];
const fail = (error: string): Result => ({ ok: false, error });

export interface QuestionInput {
  subtypeId: number;
  imageId: string;
  prompt: string;
  options: string[];
  correctIndex: number;
}

/** The rules for a question's content, shared by writing, editing and admin fixes. */
export function validateQuestionContent(input: Pick<QuestionInput, "prompt" | "options" | "correctIndex">):
  | { ok: true; prompt: string; options: Option[]; correct: string }
  | { ok: false; error: string } {
  const prompt = input.prompt.trim();
  if (!prompt) return { ok: false, error: "Write the question." };
  if (prompt.length > 2000) return { ok: false, error: "Keep the question under 2,000 characters." };
  const texts = input.options.map((o) => o.trim());
  if (texts.some((t) => !t)) return { ok: false, error: "Fill in every option, or remove the empty ones." };
  if (texts.length < 2 || texts.length > 5) return { ok: false, error: "Give 2 to 5 options." };
  if (texts.some((t) => t.length > 300)) return { ok: false, error: "Keep each option under 300 characters." };
  if (new Set(texts.map((t) => t.toLowerCase())).size !== texts.length) return { ok: false, error: "Two options are the same." };
  if (!Number.isInteger(input.correctIndex) || input.correctIndex < 0 || input.correctIndex >= texts.length) {
    return { ok: false, error: "Mark which option is correct." };
  }
  const options = texts.map((text, i) => ({ id: OPTION_IDS[i], text }));
  return { ok: true, prompt, options, correct: options[input.correctIndex].id };
}

/** The live sprint's topics for one annotator, with the subtypes each allows. */
export async function myTopics(userId: string) {
  const sprint = await liveSprint();
  if (!sprint) return { sprint: null, topics: [] as (Assignment & { subtypes: { id: number; code: string; name: string; verifiability: Verifiability }[] })[] };
  const assignments = await sprintAssignments(sprint.id, userId);
  const topics = [];
  for (const a of assignments) {
    const subtypes = await sql<{ id: number; code: string; name: string; verifiability: Verifiability }[]>`
      select id, code, name, verifiability from subtypes
      where active and ${a.subtype_id ? sql`id = ${a.subtype_id}` : sql`category_id = ${a.category_id}`}
      order by sort, code`;
    topics.push({ ...a, subtypes });
  }
  return { sprint, topics };
}

async function missingRequiredTags(imageId: string): Promise<string[]> {
  const rows = await sql<{ name: string }[]>`
    select g.name from tag_groups g
    where g.required and g.active and not exists (
      select 1 from image_tags it join tags t on t.id = it.tag_id
      where it.image_id = ${imageId} and t.group_id = g.id)
    order by g.sort`;
  return rows.map((r) => r.name);
}

export async function createQuestion(userId: string, assignmentId: number, input: QuestionInput): Promise<Result & { id?: string }> {
  const content = validateQuestionContent(input);
  if (!content.ok) return content;

  const sprint = await liveSprint();
  if (sprint?.status !== "writing") return fail("Writing is closed right now.");
  const [assignment] = await sql<{ category_id: number; subtype_id: number | null }[]>`
    select category_id, subtype_id from assignments
    where id = ${assignmentId} and annotator_id = ${userId} and sprint_id = ${sprint.id}`;
  if (!assignment) return fail("That topic isn't assigned to you.");
  const [subtype] = await sql<{ verifiability: Verifiability }[]>`
    select verifiability from subtypes where id = ${input.subtypeId} and active
      and category_id = ${assignment.category_id}
      and ${assignment.subtype_id ? sql`id = ${assignment.subtype_id}` : sql`true`}`;
  if (!subtype) return fail("Pick a subtype from your topic.");
  const [image] = await sql`select 1 from images where id = ${input.imageId} and uploader_id = ${userId}`;
  if (!image) return fail("Pick one of your images.");
  const missing = await missingRequiredTags(input.imageId);
  if (missing.length) return fail(`Tag the image first: ${missing.join(", ")}.`);

  const [row] = await sql<{ id: string }[]>`
    insert into questions (sprint_id, assignment_id, author_id, image_id, subtype_id, verifiability,
                           prompt, options, correct_option)
    values (${sprint.id}, ${assignmentId}, ${userId}, ${input.imageId}, ${input.subtypeId}, ${subtype.verifiability},
            ${content.prompt}, ${sql.json(content.options)}, ${content.correct})
    returning id`;
  return { ok: true, id: row.id };
}

/**
 * The setter editing their own question: freely while the sprint is still being
 * written, after the admin sent it back or dropped it, and while it's being
 * checked or flagged (saving then sends it back for checking). Never once accepted.
 */
export function setterCanEdit(status: string, sprintStatus: string): boolean {
  return (status === "written" && sprintStatus === "writing") || ["returned", "dropped", "checking", "flagged"].includes(status);
}

/** Editing one of these resubmits it in the same step: checking starts over. */
export function editRestartsChecking(status: string): boolean {
  return status === "checking" || status === "flagged";
}

export async function updateQuestion(
  userId: string,
  questionId: string,
  input: QuestionInput,
): Promise<Result & { rechecking?: boolean }> {
  const content = validateQuestionContent(input);
  if (!content.ok) return content;
  const [q] = await sql<{ status: string; sprint_status: string; assignment_id: number; category_id: number; topic_subtype: number | null }[]>`
    select q.status, s.status as sprint_status, q.assignment_id, a.category_id, a.subtype_id as topic_subtype
    from questions q join sprints s on s.id = q.sprint_id join assignments a on a.id = q.assignment_id
    where q.id = ${questionId} and q.author_id = ${userId}`;
  if (!q) return fail("Question not found.");
  if (!setterCanEdit(q.status, q.sprint_status)) return fail("This question can't be edited any more.");
  const [subtype] = await sql<{ verifiability: Verifiability }[]>`
    select verifiability from subtypes where id = ${input.subtypeId} and category_id = ${q.category_id}
      and ${q.topic_subtype ? sql`id = ${q.topic_subtype}` : sql`true`}`;
  if (!subtype) return fail("Pick a subtype from your topic.");
  const [image] = await sql`select 1 from images where id = ${input.imageId} and uploader_id = ${userId}`;
  if (!image) return fail("Pick one of your images.");

  return sql.begin(async (tx) => {
    // Locked so a checker answering at this moment goes either before the edit or not at all.
    const [now] = await tx<{ status: string; sprint_status: string; prompt: string; options: Option[]; correct_option: string }[]>`
      select q.status, s.status as sprint_status, q.prompt, q.options, q.correct_option
      from questions q join sprints s on s.id = q.sprint_id where q.id = ${questionId} for update of q`;
    if (!setterCanEdit(now.status, now.sprint_status)) return fail("This question can't be edited any more.");

    // A question that has been checked keeps the verifiability it was checked under.
    await tx`update questions set subtype_id = ${input.subtypeId}, image_id = ${input.imageId},
               prompt = ${content.prompt}, options = ${tx.json(content.options)}, correct_option = ${content.correct},
               verifiability = case when status = 'written' then ${subtype.verifiability} else verifiability end,
               updated_at = now()
             where id = ${questionId}`;
    if (!editRestartsChecking(now.status)) return { ok: true };
    const rechecking = await restartChecking(tx, questionId, now.sprint_status === "verifying");
    await audit(userId, "question.edit_resubmit", questionId, {
      before: { status: now.status, prompt: now.prompt, options: now.options, correct: now.correct_option },
      ...rechecking.removed,
    }, tx);
    return { ok: true, rechecking: rechecking.again };
  });
}

/**
 * After the setter edits a question that was being checked or was flagged: the
 * same checkers answer it again from scratch, on new tasks (so a page still open
 * on the old version can't answer the new one). Earlier checker and model
 * answers were about the old wording, so they're removed here and returned for
 * the audit log. If verification is over, the admin reviews it instead.
 */
async function restartChecking(tx: Tx, questionId: string, verifying: boolean) {
  const checks = await tx<{ checker_id: string; role: string | null; blind_choice: string | null; blind_note: string | null; judgment: string | null; judgment_reason: string | null; odd_one: string | null }[]>`
    delete from checks where question_id = ${questionId}
    returning checker_id, role, blind_choice, blind_note, judgment, judgment_reason, odd_one`;
  const models = await tx<{ model_id: number; chosen_option: string | null }[]>`
    delete from model_answers where question_id = ${questionId} returning model_id, chosen_option`;
  const removed = { old_checks: checks, old_model_answers: models };
  if (!verifying || checks.length === 0) {
    await tx`update questions set status = 'flagged', resolution = 'resubmitted', updated_at = now() where id = ${questionId}`;
    return { again: false, removed };
  }
  const [q] = await tx<{ options: Option[] }[]>`select options from questions where id = ${questionId}`;
  const rows = checks.map((c) => ({
    question_id: questionId,
    checker_id: c.checker_id,
    // I roles go to whoever answers first, as before.
    role: c.role === "v" || c.role === "c" ? c.role : null,
    option_order: shuffled(q.options.map((o) => o.id)),
  }));
  await tx`insert into checks (question_id, checker_id, role, option_order)
           select question_id, checker_id, role, option_order
           from jsonb_to_recordset(${tx.json(rows)}) as r(question_id uuid, checker_id uuid, role text, option_order jsonb)`;
  await tx`update questions set status = 'checking', resolution = null, updated_at = now() where id = ${questionId}`;
  return { again: true, removed };
}

export async function deleteQuestion(userId: string, questionId: string): Promise<Result> {
  const [q] = await sql<{ status: string; sprint_status: string }[]>`
    select q.status, s.status as sprint_status from questions q join sprints s on s.id = q.sprint_id
    where q.id = ${questionId} and q.author_id = ${userId}`;
  if (!q || q.status !== "written" || q.sprint_status !== "writing") return fail("Only questions not yet sent for checking can be deleted.");
  await sql`delete from questions where id = ${questionId}`;
  return { ok: true };
}

/** A setter sending a returned or dropped question back to the admin after fixing it. */
export async function resubmitQuestion(userId: string, questionId: string): Promise<Result> {
  const [q] = await sql`select 1 from questions where id = ${questionId} and author_id = ${userId} and status in ('returned', 'dropped')`;
  if (!q) return fail("Only a question the admin sent back or dropped can be resubmitted.");
  await sql`update questions set status = 'flagged', resolution = 'resubmitted', updated_at = now() where id = ${questionId}`;
  return { ok: true };
}

export interface MyQuestion {
  id: string;
  code: string;
  prompt: string;
  status: string;
  admin_note: string | null;
  subtype_code: string;
  subtype_name: string;
  verifiability: Verifiability;
  sprint_name: string;
  sprint_status: string;
  created_at: Date;
  image: StoredImage;
}

export async function listMyQuestions(userId: string): Promise<MyQuestion[]> {
  const rows = await sql`
    select q.id, q.code, q.prompt, q.status, q.admin_note, st.code as subtype_code, st.name as subtype_name,
      q.verifiability, s.name as sprint_name, s.status as sprint_status, q.created_at,
      i.id as image_id, i.storage, i.storage_key, i.version
    from questions q join subtypes st on st.id = q.subtype_id join sprints s on s.id = q.sprint_id
    join images i on i.id = q.image_id
    where q.author_id = ${userId} order by q.created_at desc`;
  return rows.map((r) => ({
    ...(r as unknown as MyQuestion),
    image: { id: r.image_id, storage: r.storage, storage_key: r.storage_key, version: r.version },
  }));
}

export interface QuestionRecord {
  id: string;
  code: string;
  sprint_id: number;
  assignment_id: number;
  author_id: string;
  subtype_id: number;
  verifiability: Verifiability;
  prompt: string;
  options: Option[];
  correct_option: string;
  status: string;
  resolution: string | null;
  admin_note: string | null;
  created_at: Date;
  updated_at: Date;
  image: StoredImage;
}

export async function getQuestion(id: string): Promise<QuestionRecord | null> {
  const [r] = await sql`
    select q.*, i.storage, i.storage_key, i.version from questions q join images i on i.id = q.image_id
    where q.id = ${id}`;
  if (!r) return null;
  return { ...(r as unknown as QuestionRecord), image: { id: r.image_id, storage: r.storage, storage_key: r.storage_key, version: r.version } };
}

// Images --------------------------------------------------------------------------------

export interface MyImage extends StoredImage {
  created_at: Date;
  tag_ids: number[];
  questions: number;
}

export async function listMyImages(userId: string): Promise<MyImage[]> {
  return sql<MyImage[]>`
    select i.id, i.storage, i.storage_key, i.version, i.created_at,
      coalesce(array_agg(distinct it.tag_id) filter (where it.tag_id is not null), '{}') as tag_ids,
      (select count(*)::int from questions q where q.image_id = i.id) as questions
    from images i left join image_tags it on it.image_id = i.id
    where i.uploader_id = ${userId}
    group by i.id order by i.created_at desc`;
}

export async function setImageTags(userId: string, imageId: string, tagIds: number[]): Promise<Result> {
  const [image] = await sql`select 1 from images where id = ${imageId} and uploader_id = ${userId}`;
  if (!image) return fail("Image not found.");
  const valid = await sql<{ id: number }[]>`select id from tags where active and id = any(${tagIds}::int[])`;
  await sql.begin(async (tx) => {
    await tx`delete from image_tags where image_id = ${imageId}`;
    if (valid.length) {
      await tx`insert into image_tags (image_id, tag_id) select ${imageId}, unnest(${valid.map((v) => v.id)}::int[])`;
    }
  });
  const missing = await missingRequiredTags(imageId);
  return missing.length ? fail(`Still needed: ${missing.join(", ")}.`) : { ok: true };
}

// Admin review --------------------------------------------------------------------------

export type ReviewAction = "accept" | "fix" | "send_back" | "drop" | "restore";

export async function reviewQuestion(
  adminId: string,
  questionId: string,
  action: ReviewAction,
  input: { note?: string; prompt?: string; options?: string[]; correctIndex?: number },
): Promise<Result> {
  const q = await getQuestion(questionId);
  if (!q) return fail("Question not found.");
  const note = input.note?.trim() || null;

  switch (action) {
    case "accept":
      if (!["flagged", "returned", "checking"].includes(q.status)) return fail("Only flagged questions need accepting.");
      await sql`update questions set status = 'accepted', resolution = 'admin_accepted', admin_note = coalesce(${note}, admin_note),
                updated_at = now() where id = ${questionId}`;
      break;
    case "fix": {
      if (["dropped"].includes(q.status)) return fail("Restore the question before fixing it.");
      if (input.options && input.options.length !== q.options.length) {
        return fail("Keep the same number of options when fixing; recorded answers refer to them by position.");
      }
      const content = validateQuestionContent({
        prompt: input.prompt ?? q.prompt,
        options: input.options ?? q.options.map((o) => o.text),
        correctIndex: input.correctIndex ?? q.options.findIndex((o) => o.id === q.correct_option),
      });
      if (!content.ok) return content;
      // Keep option ids stable for options whose position didn't change, so the
      // recorded checker and model choices still point at the same text.
      await sql`update questions set prompt = ${content.prompt}, options = ${sql.json(content.options)},
                correct_option = ${content.correct}, status = 'accepted', resolution = 'admin_fixed',
                admin_note = coalesce(${note}, admin_note), updated_at = now() where id = ${questionId}`;
      break;
    }
    case "send_back":
      if (!note) return fail("Tell the setter what to fix.");
      if (q.status !== "flagged") return fail("Only flagged questions can be sent back.");
      await sql`update questions set status = 'returned', admin_note = ${note}, updated_at = now() where id = ${questionId}`;
      break;
    case "drop":
      // The setter sees the reason on their dashboard and can fix and resubmit.
      if (!note) return fail("Tell the setter why it was dropped.");
      if (q.status === "dropped") return fail("It's already dropped.");
      await sql`update questions set status = 'dropped', resolution = 'dropped', admin_note = ${note},
                updated_at = now() where id = ${questionId}`;
      break;
    case "restore":
      if (q.status !== "dropped") return fail("Only dropped questions can be restored.");
      await sql`update questions set status = 'flagged', resolution = null, updated_at = now() where id = ${questionId}`;
      break;
  }
  await audit(adminId, `question.${action}`, questionId, {
    before: { status: q.status, prompt: q.prompt, options: q.options, correct: q.correct_option },
    note,
  });
  return { ok: true };
}

// Admin browsing ---------------------------------------------------------------------------

export interface AdminQuestionRow {
  id: string;
  code: string;
  prompt: string;
  status: string;
  resolution: string | null;
  verifiability: Verifiability;
  subtype_code: string;
  author_name: string;
  sprint_name: string;
  created_at: Date;
  checks_done: number;
  checks_total: number;
  image: StoredImage;
}

export interface AdminQuestionFilters {
  sprintId: number | null;
  status?: string;
  subtypeId?: number;
  verifiability?: string;
  authorId?: string;
  search?: string;
  page?: number;
}

export const ADMIN_PAGE_SIZE = 50;

/** Search text matches a question code (or its start, like "07-1.4") or words in the question. */
function searchMatch(search: string) {
  const term = search.trim();
  const like = term.replace(/[%_\\]/g, "\\$&");
  return sql`(q.code ilike ${like + "%"} or q.prompt ilike ${"%" + like + "%"})`;
}

export async function adminListQuestions(f: AdminQuestionFilters): Promise<{ rows: AdminQuestionRow[]; total: number }> {
  const where = sql`
    ${f.sprintId ? sql`q.sprint_id = ${f.sprintId}` : sql`true`}
    and ${f.status ? sql`q.status = ${f.status}` : sql`true`}
    and ${f.subtypeId ? sql`q.subtype_id = ${f.subtypeId}` : sql`true`}
    and ${f.verifiability ? sql`q.verifiability = ${f.verifiability}` : sql`true`}
    and ${f.authorId ? sql`q.author_id = ${f.authorId}` : sql`true`}
    and ${f.search ? searchMatch(f.search) : sql`true`}`;
  const [{ total }] = await sql<{ total: number }[]>`select count(*)::int as total from questions q where ${where}`;
  const page = Math.max(1, f.page ?? 1);
  const rows = await sql`
    select q.id, q.code, q.prompt, q.status, q.resolution, q.verifiability, st.code as subtype_code,
      u.display_name as author_name, s.name as sprint_name, q.created_at,
      i.id as image_id, i.storage, i.storage_key, i.version,
      (select count(*)::int from checks c where c.question_id = q.id and c.blind_choice is not null) as checks_done,
      (select count(*)::int from checks c where c.question_id = q.id) as checks_total
    from questions q join subtypes st on st.id = q.subtype_id join users u on u.id = q.author_id
    join sprints s on s.id = q.sprint_id join images i on i.id = q.image_id
    where ${where}
    order by case q.status when 'flagged' then 0 when 'returned' then 1 else 2 end, q.updated_at desc
    limit ${ADMIN_PAGE_SIZE} offset ${(page - 1) * ADMIN_PAGE_SIZE}`;
  return {
    total,
    rows: rows.map((r) => ({
      ...(r as unknown as AdminQuestionRow),
      image: { id: r.image_id, storage: r.storage, storage_key: r.storage_key, version: r.version },
    })),
  };
}
