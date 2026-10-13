import "server-only";
import { sql, type Tx } from "./db";
import {
  allowedJudgments,
  CANT_TELL,
  checkComplete,
  decide,
  needsJudgment,
  NONE,
  type CheckFacts,
  type CheckRole,
  type Judgment,
  type Verifiability,
} from "./engine";
import type { Option } from "./questions";
import type { Result } from "./sprints";
import type { StoredImage } from "./storage";

/**
 * The checker's side. Everything here enforces blindness on the server: a
 * checker's page is only ever given what their current step allows, never the
 * setter's answer or another checker's answer early.
 */

const fail = (error: string): Result => ({ ok: false, error });
const MAX_NOTE = 1000;

interface CheckRow extends CheckFacts {
  id: string;
  question_id: string;
  checker_id: string;
  option_order: string[];
  blind_note: string | null;
  judgment_reason: string | null;
  odd_one: string | null;
  opened_at: Date | null;
  blind_at: Date | null;
}

export interface QueueItem {
  check_id: string;
  step: "blind" | "judgment";
  verifiability: Verifiability;
  subtype_code: string;
  subtype_name: string;
  prompt: string;
}

/** Everything this person still has to do in the live sprint, blind steps first. */
export async function myQueue(userId: string): Promise<{ todo: QueueItem[]; done: number }> {
  const rows = await sql<(CheckRow & { verifiability: Verifiability; correct_option: string; subtype_code: string; subtype_name: string; prompt: string })[]>`
    select c.*, q.verifiability, q.correct_option, q.prompt, st.code as subtype_code, st.name as subtype_name
    from checks c join questions q on q.id = c.question_id join sprints s on s.id = q.sprint_id
    join subtypes st on st.id = q.subtype_id
    where c.checker_id = ${userId} and s.status = 'verifying'
    order by c.created_at, st.sort, q.created_at`;
  const todo: QueueItem[] = [];
  let done = 0;
  for (const r of rows) {
    if (checkComplete(r, r)) {
      done++;
      continue;
    }
    todo.push({
      check_id: r.id,
      step: r.blind_choice === null ? "blind" : "judgment",
      verifiability: r.verifiability,
      subtype_code: r.subtype_code,
      subtype_name: r.subtype_name,
      prompt: r.prompt,
    });
  }
  // Finish second steps before starting new questions.
  todo.sort((a, b) => (a.step === b.step ? 0 : a.step === "judgment" ? -1 : 1));
  return { todo, done };
}

export interface ChoiceView {
  choice: string;
  note: string | null;
}

export type TaskView = {
  check_id: string;
  role: CheckRole | null;
  verifiability: Verifiability;
  subtype: string;
  prompt: string;
  /** Options in the order this checker sees them. */
  options: Option[];
  image: StoredImage;
} & (
  | { step: "blind" }
  | {
      step: "judgment";
      mine: ChoiceView;
      setter: string;
      /** Only for the third checker on an I question. */
      second?: ChoiceView;
    }
  | { step: "done"; summary: string }
);

export async function getTask(userId: string, checkId: string): Promise<TaskView | null> {
  const [row] = await sql<(CheckRow & {
    verifiability: Verifiability; correct_option: string; prompt: string; options: Option[];
    subtype_code: string; subtype_name: string; image_id: string; storage: "cloudinary" | "local";
    storage_key: string; version: string | null; sprint_status: string;
  })[]>`
    select c.*, q.verifiability, q.correct_option, q.prompt, q.options, st.code as subtype_code,
      st.name as subtype_name, i.id as image_id, i.storage, i.storage_key, i.version, s.status as sprint_status
    from checks c join questions q on q.id = c.question_id join subtypes st on st.id = q.subtype_id
    join images i on i.id = q.image_id join sprints s on s.id = q.sprint_id
    where c.id = ${checkId} and c.checker_id = ${userId}`;
  if (!row) return null;

  if (!row.opened_at && row.sprint_status === "verifying") {
    await sql`update checks set opened_at = now() where id = ${checkId} and opened_at is null`;
  }

  const byId = new Map(row.options.map((o) => [o.id, o]));
  const base = {
    check_id: row.id,
    role: row.role,
    verifiability: row.verifiability,
    subtype: `${row.subtype_code} ${row.subtype_name}`,
    prompt: row.prompt,
    options: row.option_order.map((id) => byId.get(id)!).filter(Boolean),
    image: { id: row.image_id, storage: row.storage, storage_key: row.storage_key, version: row.version },
  };

  if (row.blind_choice === null) {
    return row.sprint_status === "verifying" ? { ...base, step: "blind" } : { ...base, step: "done", summary: "Verification for this sprint has ended." };
  }
  const mine = { choice: row.blind_choice, note: row.blind_note };

  if (needsJudgment(row, row) && row.judgment === null && row.sprint_status === "verifying") {
    if (row.role === "third") {
      const [second] = await sql<{ blind_choice: string; blind_note: string | null }[]>`
        select blind_choice, blind_note from checks where question_id = ${row.question_id} and role = 'second'`;
      return { ...base, step: "judgment", mine, setter: row.correct_option, second: { choice: second.blind_choice, note: second.blind_note } };
    }
    return { ...base, step: "judgment", mine, setter: row.correct_option };
  }

  return { ...base, step: "done", summary: doneSummary(row) };
}

function doneSummary(row: CheckRow & { verifiability: Verifiability; correct_option: string }): string {
  switch (row.verifiability) {
    case "V":
      if (row.blind_choice === row.correct_option) return "Your answer matched the setter's.";
      return row.judgment === "misread"
        ? "You said you misread it, so the setter's answer stands."
        : "You reported a mistake by the setter. The admin will review it.";
    case "C":
      // C stays blind even afterwards: the other checker may not have answered yet.
      return "Your answer is recorded. Thanks.";
    case "I":
      return row.judgment === "agree" || row.judgment === "all_agree"
        ? "You agreed. Your answer is recorded."
        : "You disagreed. Your reason is recorded for the admin.";
  }
}

/** Re-decides a question from its checks, inside the caller's transaction. */
async function settle(tx: Tx, questionId: string): Promise<void> {
  const [q] = await tx<{ verifiability: Verifiability; correct_option: string; status: string }[]>`
    select verifiability, correct_option, status from questions where id = ${questionId}`;
  if (q.status !== "checking") return;
  const checks = await tx<CheckFacts[]>`select role, blind_choice, judgment from checks where question_id = ${questionId}`;
  const outcome = decide(q, checks);
  if (outcome.state === "accepted") {
    await tx`update questions set status = 'accepted', resolution = ${outcome.resolution}, updated_at = now() where id = ${questionId}`;
  } else if (outcome.state === "flagged") {
    await tx`update questions set status = 'flagged', resolution = ${outcome.reason}, updated_at = now() where id = ${questionId}`;
  }
}

async function lockCheck(tx: Tx, userId: string, checkId: string) {
  // Lock the question row so two checkers answering at the same moment are
  // processed one after the other (this is what decides who is "second").
  const [row] = await tx<(CheckRow & { verifiability: Verifiability; correct_option: string; options: Option[]; status: string; sprint_status: string })[]>`
    select c.*, q.verifiability, q.correct_option, q.options, q.status, s.status as sprint_status
    from checks c join questions q on q.id = c.question_id join sprints s on s.id = q.sprint_id
    where c.id = ${checkId} and c.checker_id = ${userId}
    for update of q, c`;
  return row ?? null;
}

export async function submitBlind(userId: string, checkId: string, choice: string, noteInput: string): Promise<Result> {
  const note = noteInput.trim();
  return sql.begin(async (tx) => {
    const row = await lockCheck(tx, userId, checkId);
    if (!row) return fail("Task not found.");
    if (row.sprint_status !== "verifying") return fail("Verification for this sprint has ended.");
    if (row.blind_choice !== null) return fail("You've already answered this one.");

    const special = choice === NONE || choice === CANT_TELL;
    if (!special && !row.options.some((o) => o.id === choice)) return fail("Pick one of the options.");
    if (choice === NONE && !note) return fail("Type what the correct answer is.");
    if (choice === CANT_TELL && !note) return fail("Say why it can't be told from the image.");
    if (note.length > MAX_NOTE) return fail("Keep it under 1,000 characters.");

    let role = row.role;
    if (row.verifiability === "I") {
      const [{ n }] = await tx<{ n: number }[]>`
        select count(*)::int as n from checks where question_id = ${row.question_id} and id <> ${checkId} and blind_at is not null`;
      role = n === 0 ? "second" : "third";
    }
    await tx`update checks set blind_choice = ${choice}, blind_note = ${special ? note : null}, blind_at = now(),
             role = ${role}, opened_at = coalesce(opened_at, now()) where id = ${checkId}`;
    await settle(tx, row.question_id);
    return { ok: true } as Result;
  });
}

export async function submitJudgment(
  userId: string,
  checkId: string,
  judgment: string,
  reasonInput: string,
  oddOne: string | null,
): Promise<Result> {
  const reason = reasonInput.trim();
  return sql.begin(async (tx) => {
    const row = await lockCheck(tx, userId, checkId);
    if (!row) return fail("Task not found.");
    if (row.sprint_status !== "verifying") return fail("Verification for this sprint has ended.");
    if (row.blind_choice === null) return fail("Answer the question first.");
    if (row.judgment !== null) return fail("You've already finished this one.");
    if (!needsJudgment(row, row) || !row.role) return fail("Nothing more is needed here.");
    if (!allowedJudgments(row.role).includes(judgment as Judgment)) return fail("Pick one of the choices.");

    const needsReason = ["setter_mistake", "disagree", "not_all_agree"].includes(judgment);
    if (needsReason && !reason) return fail("Give a short reason.");
    if (reason.length > MAX_NOTE) return fail("Keep it under 1,000 characters.");
    if (judgment === "not_all_agree" && !["setter", "second", "mine"].includes(oddOne ?? "")) {
      return fail("Say which answer is the odd one out.");
    }

    await tx`update checks set judgment = ${judgment}, judgment_reason = ${reason || null},
             odd_one = ${judgment === "not_all_agree" ? oddOne : null}, judged_at = now() where id = ${checkId}`;
    await settle(tx, row.question_id);
    return { ok: true } as Result;
  });
}

/** The next unfinished task after this one, if any. */
export async function nextTaskId(userId: string): Promise<string | null> {
  const { todo } = await myQueue(userId);
  return todo[0]?.check_id ?? null;
}
