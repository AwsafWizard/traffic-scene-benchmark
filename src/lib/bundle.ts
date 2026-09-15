import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb, uploadPath } from "./db";
import { autoGrade } from "./scoring";
import type { AnswerType, Category, Question, Verdict } from "./types";

export const BUNDLE_VERSION = 1;

/**
 * A question as it travels to another install. It carries the setter's answer
 * key, so both copies can reveal the same thing and score the same way — what
 * keeps grounding honest is the Compare page refusing to open a question you
 * haven't answered yet, not the key being absent from the bundle. The setter's
 * private working notes still stay home.
 */
export interface BundleQuestion {
  uid: string;
  prompt: string;
  category: Category;
  answer_type: AnswerType;
  options: string[] | null;
  image: { media_type: string; data: string };
  /** Taxonomy. Optional so bundles written before it still import. */
  type_code?: string | null;
  verifiability?: string | null;
  modality?: string | null;
  probes?: string[] | null;
  answer_format?: string | null;
  /**
   * The setter's answer key. It travels so the other copy can reveal it once
   * they have answered, and can score checkable formats for itself. The Compare
   * page is gated on having answered, so arriving here can't spoil grounding.
   */
  reference_answer?: string | null;
  /** When the shared fields were last edited. Absent on pre-taxonomy bundles. */
  updated_at?: string | null;
}

export interface BundleResponse {
  question_uid: string;
  grounder_name: string;
  answer: string;
  confidence: number | null;
  rationale: string | null;
  duration_ms: number | null;
  created_at: string;
  /** The grade this answer was given, so both copies show the same one. */
  verdict?: string | null;
}

export interface QuestionBundle {
  format: "traffic-bench";
  version: number;
  kind: "questions";
  exported_at: string;
  questions: BundleQuestion[];
}

export interface BundleRunTurn {
  role: "user" | "assistant";
  content: string;
  error: string | null;
}

export interface BundleRun {
  uid: string;
  question_uid: string;
  model_key: string;
  /** Carried so the other side can name the model even without it configured. */
  model_label: string | null;
  answer: string | null;
  reasoning: string | null;
  error: string | null;
  latency_ms: number | null;
  source: "api" | "manual";
  /** The grade the exporting install gave, so Results agree on both machines. */
  verdict: Verdict | null;
  turns: BundleRunTurn[];
  created_at: string;
}

export interface BundleModel {
  key: string;
  label: string;
  provider: string;
  model_id: string;
  extra: string | null;
}

export interface BundleComment {
  uid: string;
  question_uid: string;
  author_role: "benchmarker" | "grounder";
  author_name: string | null;
  body: string;
  created_at: string;
}

export interface ResponseBundle {
  format: "traffic-bench";
  version: number;
  kind: "responses";
  exported_at: string;
  responses: BundleResponse[];
  /** Optional so bundles written before comments existed still import. */
  comments?: BundleComment[];
  /** Optional so bundles written before model answers synced still import. */
  runs?: BundleRun[];
  /** The model roster, so both copies agree on what is being benchmarked. */
  models?: BundleModel[];
}

export type Bundle = QuestionBundle | ResponseBundle;

const MEDIA: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export function exportQuestions(ids?: number[]): QuestionBundle {
  const db = getDb();
  const rows = (
    ids?.length
      ? db
          .prepare(`SELECT * FROM questions WHERE id IN (${ids.map(() => "?").join(",")})`)
          .all(...ids)
      : db.prepare("SELECT * FROM questions ORDER BY id").all()
  ) as Question[];

  const questions: BundleQuestion[] = rows.map((q) => {
    const ext = path.extname(q.image_path).toLowerCase();
    return {
      uid: q.uid,
      prompt: q.prompt,
      category: q.category,
      answer_type: q.answer_type,
      options: q.options ? (JSON.parse(q.options) as string[]) : null,
      type_code: q.type_code,
      verifiability: q.verifiability,
      modality: q.modality,
      probes: q.probes ? (JSON.parse(q.probes) as string[]) : null,
      answer_format: q.answer_format,
      reference_answer: q.reference_answer,
      updated_at: q.updated_at ?? null,
      image: {
        media_type: MEDIA[ext] ?? "image/png",
        data: fs.readFileSync(uploadPath(q.image_path)).toString("base64"),
      },
    };
  });

  return {
    format: "traffic-bench",
    version: BUNDLE_VERSION,
    kind: "questions",
    exported_at: new Date().toISOString(),
    questions,
  };
}

/**
 * Everything this copy holds, not only what it typed itself. An answer that
 * reached us by hand-imported bundle, or a grade we gave someone else's answer,
 * is just as much part of the picture — and imports are keyed and idempotent,
 * so a row travelling through a third copy lands once and stays put.
 */
export function exportResponses({
  includeSetterComments = true,
}: { includeSetterComments?: boolean } = {}): ResponseBundle {
  const rows = getDb()
    .prepare(
      `SELECT q.uid AS question_uid, h.grounder_name, h.answer, h.confidence,
              h.rationale, h.duration_ms, h.created_at, g.verdict AS verdict
       FROM human_responses h
       JOIN questions q ON q.id = h.question_id
       LEFT JOIN grades g ON g.target_type = 'human' AND g.target_id = h.id
       ORDER BY h.id`,
    )
    .all() as BundleResponse[];

  // Folder sync shares a directory with the grounder, so the setter's private
  // working notes stay out of it — seeing them could give away the answer.
  const comments = getDb()
    .prepare(
      `SELECT c.uid, q.uid AS question_uid, c.author_role, c.author_name, c.body, c.created_at
       FROM comments c
       JOIN questions q ON q.id = c.question_id
       ${includeSetterComments ? "" : "WHERE c.author_role = 'grounder'"}
       ORDER BY c.id`,
    )
    .all() as BundleComment[];

  const runRows = getDb()
    .prepare(
      `SELECT r.uid, q.uid AS question_uid, r.model_key, m.label AS model_label,
              r.answer, r.reasoning, r.error, r.latency_ms, r.source, r.created_at,
              g.verdict AS verdict
       FROM llm_runs r
       JOIN questions q ON q.id = r.question_id
       LEFT JOIN models m ON m.key = r.model_key
       LEFT JOIN grades g ON g.target_type = 'llm' AND g.target_id = r.id
       ORDER BY r.id`,
    )
    .all() as (Omit<BundleRun, "turns"> & { uid: string })[];

  const turnsFor = getDb().prepare(
    `SELECT t.role, t.content, t.error FROM run_turns t
     JOIN llm_runs r ON r.id = t.run_id
     WHERE r.uid = ? ORDER BY t.id`,
  );
  const runs: BundleRun[] = runRows.map((run) => ({
    ...run,
    turns: turnsFor.all(run.uid) as BundleRunTurn[],
  }));

  // The roster travels so both copies benchmark the same set. Keys stay out of
  // it — every install reads its own from .env.local.
  const models = getDb()
    .prepare("SELECT key, label, provider, model_id, extra FROM models ORDER BY key")
    .all() as BundleModel[];

  return {
    format: "traffic-bench",
    version: BUNDLE_VERSION,
    kind: "responses",
    exported_at: new Date().toISOString(),
    responses: rows,
    comments,
    runs,
    models,
  };
}

export class BundleError extends Error {}

export function parseBundle(text: string): Bundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new BundleError("That file isn't valid JSON. Pick a .json file exported by this tool.");
  }

  const bundle = parsed as Partial<Bundle>;
  if (bundle?.format !== "traffic-bench") {
    throw new BundleError("That file wasn't exported by this tool.");
  }
  if (typeof bundle.version !== "number" || bundle.version > BUNDLE_VERSION) {
    throw new BundleError(
      `That bundle is version ${String(bundle.version)}, newer than this copy of the tool understands. Update the tool.`,
    );
  }
  if (bundle.kind !== "questions" && bundle.kind !== "responses") {
    throw new BundleError("Unrecognised bundle type.");
  }
  return bundle as Bundle;
}

export interface ImportResult {
  kind: "questions" | "responses";
  added: number;
  skipped: number;
  unmatched: number;
  /** Rows already here that the incoming copy had edited more recently. */
  updated?: number;
  /** Grades applied to answers this copy had not graded yet. */
  grades?: number;
  comments?: number;
  runs?: number;
  models?: number;
}

type MergedQuestion = {
  prompt: string;
  category: string;
  answer_type: string;
  options: string | null;
  type_code: string | null;
  verifiability: string | null;
  modality: string | null;
  probes: string | null;
  answer_format: string | null;
  reference_answer: string | null;
  updated_at: string | null;
};

/**
 * Reconciles a question both copies hold. Two rules, in this order:
 *
 * 1. A filled-in value always beats an empty one. Classifying a question the
 *    other side wrote must reach them, and their un-classified copy must never
 *    blank it back out — which matters because an imported row's timestamp is
 *    the moment it was imported, not the moment the question was written.
 * 2. When both sides have a value and they differ, the more recent edit wins.
 *
 * Returns null when nothing at all changes, so an unremarkable pull stays
 * silent. When only the stamp differs the row still takes the later one: the
 * two copies must agree on it, or each would keep seeing the other's file as
 * news and rewrite its own, forever. The reference answer, private notes and
 * the image are not shared fields and are never touched.
 */
function mergeQuestion(
  here: Question,
  theirs: BundleQuestion,
): { row: MergedQuestion; contentChanged: boolean } | null {
  const mine = here.updated_at ?? "";
  const yours = theirs.updated_at ?? "";

  // Same second, different content: without a rule both copies would think the
  // other's edit was no newer than their own and each would keep its own
  // version for good. Comparing the content itself breaks the tie the same way
  // on both machines, so they end up agreeing rather than quietly diverging.
  const shared = (q: {
    prompt: string;
    category: string;
    answer_type: string;
    options: string | null;
    type_code: string | null;
    verifiability: string | null;
    modality: string | null;
    probes: string | null;
    answer_format: string | null;
    reference_answer: string | null;
  }) =>
    JSON.stringify([
      q.prompt,
      q.category,
      q.answer_type,
      q.options,
      q.type_code,
      q.verifiability,
      q.modality,
      q.probes,
      q.answer_format,
      q.reference_answer,
    ]);
  const theirContent = shared({
    prompt: theirs.prompt,
    category: theirs.category,
    answer_type: theirs.answer_type,
    options: theirs.options ? JSON.stringify(theirs.options) : null,
    type_code: theirs.type_code ?? null,
    verifiability: theirs.verifiability ?? null,
    modality: theirs.modality ?? null,
    probes: theirs.probes ? JSON.stringify(theirs.probes) : null,
    answer_format: theirs.answer_format ?? null,
    reference_answer: theirs.reference_answer ?? null,
  });
  const theirsIsNewer = yours > mine || (yours === mine && theirContent > shared(here));

  const pick = (ours: string | null, incoming: string | null): string | null => {
    const oursSet = ours !== null && ours !== "";
    const incomingSet = incoming !== null && incoming !== "";
    if (!incomingSet) return ours;
    if (!oursSet) return incoming;
    return theirsIsNewer ? incoming : ours;
  };

  const merged: MergedQuestion = {
    prompt: pick(here.prompt, theirs.prompt) ?? here.prompt,
    category: pick(here.category, theirs.category) ?? here.category,
    answer_type: pick(here.answer_type, theirs.answer_type) ?? here.answer_type,
    options: pick(here.options, theirs.options ? JSON.stringify(theirs.options) : null),
    type_code: pick(here.type_code, theirs.type_code ?? null),
    verifiability: pick(here.verifiability, theirs.verifiability ?? null),
    modality: pick(here.modality, theirs.modality ?? null),
    probes: pick(here.probes, theirs.probes ? JSON.stringify(theirs.probes) : null),
    answer_format: pick(here.answer_format, theirs.answer_format ?? null),
    reference_answer: pick(here.reference_answer, theirs.reference_answer ?? null),
    updated_at: here.updated_at,
  };

  const contentChanged =
    merged.prompt !== here.prompt ||
    merged.category !== here.category ||
    merged.answer_type !== here.answer_type ||
    merged.options !== here.options ||
    merged.type_code !== here.type_code ||
    merged.verifiability !== here.verifiability ||
    merged.modality !== here.modality ||
    merged.probes !== here.probes ||
    merged.answer_format !== here.answer_format ||
    merged.reference_answer !== here.reference_answer;

  // Which stamp to keep. A real edit carries the later one, because that is the
  // edit that won. Two copies that already agree on the content settle on the
  // earlier one instead — they have nothing to argue about, and both picking
  // the same value is what stops each from seeing the other's file as news and
  // republishing its own every time it syncs.
  merged.updated_at = contentChanged
    ? (yours > mine ? yours : here.updated_at)
    : !yours || !mine
      ? here.updated_at ?? theirs.updated_at ?? null
      : yours < mine
        ? yours
        : here.updated_at;

  if (!contentChanged && merged.updated_at === here.updated_at) return null;
  return { row: merged, contentChanged };
}

export function importQuestions(bundle: QuestionBundle): ImportResult {
  const db = getDb();
  if (!Array.isArray(bundle.questions)) throw new BundleError("Bundle has no questions.");

  const existing = db.prepare("SELECT * FROM questions WHERE uid = ?");
  // The shared fields only. A reference answer, private notes and the image
  // stay exactly as they are on this copy.
  const update = db.prepare(
    `UPDATE questions
        SET prompt = ?, category = ?, answer_type = ?, options = ?, type_code = ?,
            verifiability = ?, modality = ?, probes = ?, answer_format = ?,
            reference_answer = ?, updated_at = ?
      WHERE uid = ?`,
  );
  const insert = db.prepare(
    `INSERT INTO questions
       (uid, image_path, prompt, category, answer_type, options, imported,
        type_code, verifiability, modality, probes, answer_format, reference_answer,
        updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
  );

  let added = 0;
  let skipped = 0;
  let updated = 0;

  const run = db.transaction((questions: BundleQuestion[]) => {
    for (const q of questions) {
      if (!q?.uid || !q.prompt || !q.image?.data) {
        skipped += 1;
        continue;
      }
      const here = existing.get(q.uid) as Question | undefined;
      if (here) {
        const merged = mergeQuestion(here, q);
        if (merged) {
          const { row } = merged;
          update.run(
            row.prompt,
            row.category,
            row.answer_type,
            row.options,
            row.type_code,
            row.verifiability,
            row.modality,
            row.probes,
            row.answer_format,
            row.reference_answer,
            row.updated_at,
            q.uid,
          );
        }
        if (merged?.contentChanged) updated += 1;
        else skipped += 1;
        continue;
      }

      const ext = EXT[q.image.media_type];
      if (!ext) {
        skipped += 1;
        continue;
      }

      const name = `${crypto.randomUUID()}${ext}`;
      fs.writeFileSync(uploadPath(name), Buffer.from(q.image.data, "base64"));
      insert.run(
        q.uid,
        name,
        q.prompt,
        q.category,
        q.answer_type,
        q.options ? JSON.stringify(q.options) : null,
        q.type_code ?? null,
        q.verifiability ?? null,
        q.modality ?? null,
        q.probes ? JSON.stringify(q.probes) : null,
        q.answer_format ?? null,
        q.reference_answer ?? null,
        q.updated_at ?? null,
      );
      added += 1;
    }
  });

  run(bundle.questions);
  return { kind: "questions", added, skipped, updated, unmatched: 0 };
}

export function importResponses(bundle: ResponseBundle): ImportResult {
  const db = getDb();
  if (!Array.isArray(bundle.responses)) throw new BundleError("Bundle has no responses.");

  const findQuestion = db.prepare("SELECT * FROM questions WHERE uid = ?");
  // The same grounder answering the same question twice is a re-import, not a
  // second data point — match on the original timestamp to stay idempotent.
  const duplicate = db.prepare(
    "SELECT id FROM human_responses WHERE question_id = ? AND grounder_name = ? AND created_at = ?",
  );
  // A grade is a judgement its grader owns: fill in one we are missing, never
  // overwrite one made here. Two copies that disagree each keep their own.
  const hasGrade = db.prepare(
    "SELECT 1 FROM grades WHERE target_type = ? AND target_id = ?",
  );
  const putGrade = db.prepare(
    `INSERT OR REPLACE INTO grades (target_type, target_id, verdict, grader)
     VALUES (?, ?, ?, 'synced')`,
  );
  const insert = db.prepare(
    `INSERT INTO human_responses
       (question_id, grounder_name, answer, confidence, rationale, duration_ms, created_at, imported)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
  );

  let added = 0;
  let skipped = 0;
  let unmatched = 0;
  let grades = 0;

  /** Applies a verdict that travelled with a row we already had. */
  const adoptGrade = (targetType: "human" | "llm", targetId: number, verdict?: string | null) => {
    if (!verdict) return;
    if (hasGrade.get(targetType, targetId)) return;
    putGrade.run(targetType, targetId, verdict);
    grades += 1;
  };

  const run = db.transaction((responses: BundleResponse[]) => {
    for (const r of responses) {
      if (!r?.question_uid || !r.answer) {
        skipped += 1;
        continue;
      }
      const question = findQuestion.get(r.question_uid) as Question | undefined;
      if (!question) {
        unmatched += 1;
        continue;
      }
      const createdAt = r.created_at ?? new Date().toISOString();
      const here = duplicate.get(question.id, r.grounder_name, createdAt) as
        | { id: number }
        | undefined;
      if (here) {
        // Already have the answer, but its grade may be new to us.
        adoptGrade("human", here.id, r.verdict);
        skipped += 1;
        continue;
      }
      const info = insert.run(
        question.id,
        r.grounder_name || "anonymous",
        r.answer,
        r.confidence ?? null,
        r.rationale ?? null,
        r.duration_ms ?? null,
        createdAt,
      );

      // The grounder's copy has no reference answer, so scoring happens here.
      // A verdict that travelled with the answer stands in where it can't.
      const verdict = autoGrade(question, r.answer);
      if (verdict) {
        db.prepare(
          `INSERT OR REPLACE INTO grades (target_type, target_id, verdict, grader)
           VALUES ('human', ?, ?, 'auto')`,
        ).run(info.lastInsertRowid, verdict);
      } else {
        adoptGrade("human", Number(info.lastInsertRowid), r.verdict);
      }
      added += 1;
    }
  });

  const insertComment = db.prepare(
    `INSERT INTO comments (uid, question_id, author_role, author_name, body, created_at, imported)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
  );
  const commentExists = db.prepare("SELECT 1 FROM comments WHERE uid = ?");

  let comments = 0;
  const runComments = db.transaction((list: BundleComment[]) => {
    for (const c of list) {
      if (!c?.uid || !c.body || !c.question_uid) continue;
      if (commentExists.get(c.uid)) continue;
      const question = findQuestion.get(c.question_uid) as Question | undefined;
      if (!question) {
        unmatched += 1;
        continue;
      }
      insertComment.run(
        c.uid,
        question.id,
        c.author_role === "benchmarker" ? "benchmarker" : "grounder",
        c.author_name ?? null,
        c.body,
        c.created_at ?? new Date().toISOString(),
      );
      comments += 1;
    }
  });

  // A model the other side used may not be on this copy's roster yet.
  const findModel = db.prepare("SELECT key FROM models WHERE key = ?");
  const addModel = db.prepare(
    `INSERT INTO models (key, label, provider, model_id, enabled)
     VALUES (?, ?, 'manual', ?, 0)`,
  );
  const runExists = db.prepare("SELECT id FROM llm_runs WHERE uid = ?");
  const insertRun = db.prepare(
    `INSERT INTO llm_runs
       (uid, question_id, model_key, answer, reasoning, error, latency_ms, source, created_at, imported)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
  );
  const insertTurn = db.prepare(
    "INSERT INTO run_turns (run_id, role, content, error) VALUES (?, ?, ?, ?)",
  );
  const setGrade = db.prepare(
    `INSERT OR REPLACE INTO grades (target_type, target_id, verdict, grader)
     VALUES ('llm', ?, ?, 'synced')`,
  );

  // Bring in the other side's roster first, so their runs land against a model
  // that is already named here.
  let models = 0;
  const upsertModel = db.prepare(
    `INSERT INTO models (key, label, provider, model_id, extra, enabled)
     VALUES (?, ?, ?, ?, ?, 0)
     ON CONFLICT(key) DO UPDATE SET
       label = excluded.label,
       model_id = excluded.model_id,
       extra = excluded.extra`,
  );
  const runModels = db.transaction((list: BundleModel[]) => {
    for (const m of list) {
      if (!m?.key || !m.label) continue;
      const existing = findModel.get(m.key) as { key: string } | undefined;
      upsertModel.run(m.key, m.label, m.provider ?? "manual", m.model_id ?? m.key, m.extra ?? null);
      if (!existing) models += 1;
    }
  });

  let runs = 0;
  const runRuns = db.transaction((list: BundleRun[]) => {
    for (const item of list) {
      if (!item?.uid || !item.question_uid || !item.model_key) continue;
      const known = runExists.get(item.uid) as { id: number } | undefined;
      if (known) {
        adoptGrade("llm", known.id, item.verdict);
        continue;
      }
      const question = findQuestion.get(item.question_uid) as Question | undefined;
      if (!question) {
        unmatched += 1;
        continue;
      }

      if (!findModel.get(item.model_key)) {
        addModel.run(item.model_key, item.model_label ?? item.model_key, item.model_key);
      }

      const info = insertRun.run(
        item.uid,
        question.id,
        item.model_key,
        item.answer ?? null,
        item.reasoning ?? null,
        item.error ?? null,
        item.latency_ms ?? null,
        item.source === "manual" ? "manual" : "api",
        item.created_at ?? new Date().toISOString(),
      );

      for (const turn of item.turns ?? []) {
        if (!turn?.role) continue;
        insertTurn.run(info.lastInsertRowid, turn.role, turn.content ?? "", turn.error ?? null);
      }
      // The grounder has no reference answer, so the grade has to travel.
      if (item.verdict) setGrade.run(info.lastInsertRowid, item.verdict);
      runs += 1;
    }
  });

  if (Array.isArray(bundle.models)) runModels(bundle.models);
  run(bundle.responses);
  if (Array.isArray(bundle.comments)) runComments(bundle.comments);
  if (Array.isArray(bundle.runs)) runRuns(bundle.runs);

  return { kind: "responses", added, skipped, unmatched, grades, comments, runs, models };
}
