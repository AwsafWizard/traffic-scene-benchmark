import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb, uploadPath } from "./db";
import { autoGrade } from "./scoring";
import type { AnswerType, Category, Question, Verdict } from "./types";

export const BUNDLE_VERSION = 1;

/**
 * A question as it travels to another install. Deliberately carries no
 * reference answer and no notes: the grounder must answer blind, and an
 * exported bundle is the easiest way to leak the answer key by accident.
 */
export interface BundleQuestion {
  uid: string;
  prompt: string;
  category: Category;
  answer_type: AnswerType;
  options: string[] | null;
  image: { media_type: string; data: string };
}

export interface BundleResponse {
  question_uid: string;
  grounder_name: string;
  answer: string;
  confidence: number | null;
  rationale: string | null;
  duration_ms: number | null;
  created_at: string;
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

export function exportQuestions(
  ids?: number[],
  { localOnly = false }: { localOnly?: boolean } = {},
): QuestionBundle {
  const db = getDb();
  const rows = (
    ids?.length
      ? db
          .prepare(`SELECT * FROM questions WHERE id IN (${ids.map(() => "?").join(",")})`)
          .all(...ids)
      : localOnly
        ? db.prepare("SELECT * FROM questions WHERE imported = 0 ORDER BY id").all()
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

export function exportResponses({
  includeSetterComments = true,
  localOnly = false,
}: { includeSetterComments?: boolean; localOnly?: boolean } = {}): ResponseBundle {
  const rows = getDb()
    .prepare(
      `SELECT q.uid AS question_uid, h.grounder_name, h.answer, h.confidence,
              h.rationale, h.duration_ms, h.created_at
       FROM human_responses h
       JOIN questions q ON q.id = h.question_id
       ${localOnly ? "WHERE h.imported = 0" : ""}
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
       ${[
         includeSetterComments ? null : "c.author_role = 'grounder'",
         localOnly ? "c.imported = 0" : null,
       ]
         .filter(Boolean)
         .map((clause, i) => (i === 0 ? `WHERE ${clause}` : `AND ${clause}`))
         .join(" ")}
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
       ${localOnly ? "WHERE r.imported = 0" : ""}
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

  return {
    format: "traffic-bench",
    version: BUNDLE_VERSION,
    kind: "responses",
    exported_at: new Date().toISOString(),
    responses: rows,
    comments,
    runs,
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
  comments?: number;
  runs?: number;
}

export function importQuestions(bundle: QuestionBundle): ImportResult {
  const db = getDb();
  if (!Array.isArray(bundle.questions)) throw new BundleError("Bundle has no questions.");

  const existing = db.prepare("SELECT 1 FROM questions WHERE uid = ?");
  const insert = db.prepare(
    `INSERT INTO questions (uid, image_path, prompt, category, answer_type, options, imported)
     VALUES (?, ?, ?, ?, ?, ?, 1)`,
  );

  let added = 0;
  let skipped = 0;

  const run = db.transaction((questions: BundleQuestion[]) => {
    for (const q of questions) {
      if (!q?.uid || !q.prompt || !q.image?.data) {
        skipped += 1;
        continue;
      }
      if (existing.get(q.uid)) {
        skipped += 1;
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
      );
      added += 1;
    }
  });

  run(bundle.questions);
  return { kind: "questions", added, skipped, unmatched: 0 };
}

export function importResponses(bundle: ResponseBundle): ImportResult {
  const db = getDb();
  if (!Array.isArray(bundle.responses)) throw new BundleError("Bundle has no responses.");

  const findQuestion = db.prepare("SELECT * FROM questions WHERE uid = ?");
  // The same grounder answering the same question twice is a re-import, not a
  // second data point — match on the original timestamp to stay idempotent.
  const duplicate = db.prepare(
    "SELECT 1 FROM human_responses WHERE question_id = ? AND grounder_name = ? AND created_at = ?",
  );
  const insert = db.prepare(
    `INSERT INTO human_responses
       (question_id, grounder_name, answer, confidence, rationale, duration_ms, created_at, imported)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
  );

  let added = 0;
  let skipped = 0;
  let unmatched = 0;

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
      if (duplicate.get(question.id, r.grounder_name, createdAt)) {
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
      const verdict = autoGrade(question, r.answer);
      if (verdict) {
        db.prepare(
          `INSERT OR REPLACE INTO grades (target_type, target_id, verdict, grader)
           VALUES ('human', ?, ?, 'auto')`,
        ).run(info.lastInsertRowid, verdict);
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

  // A model the other side used may not be configured here. Register it
  // disabled, so its answers are labelled properly and it is never called.
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

  let runs = 0;
  const runRuns = db.transaction((list: BundleRun[]) => {
    for (const item of list) {
      if (!item?.uid || !item.question_uid || !item.model_key) continue;
      if (runExists.get(item.uid)) continue;
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

  run(bundle.responses);
  if (Array.isArray(bundle.comments)) runComments(bundle.comments);
  if (Array.isArray(bundle.runs)) runRuns(bundle.runs);

  return { kind: "responses", added, skipped, unmatched, comments, runs };
}
