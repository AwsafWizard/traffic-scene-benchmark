import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { getDb, uploadPath } from "./db";
import { autoGrade } from "./scoring";
import type { AnswerType, Category, Question } from "./types";

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

export function exportResponses(): ResponseBundle {
  const rows = getDb()
    .prepare(
      `SELECT q.uid AS question_uid, h.grounder_name, h.answer, h.confidence,
              h.rationale, h.duration_ms, h.created_at
       FROM human_responses h
       JOIN questions q ON q.id = h.question_id
       ORDER BY h.id`,
    )
    .all() as BundleResponse[];

  const comments = getDb()
    .prepare(
      `SELECT c.uid, q.uid AS question_uid, c.author_role, c.author_name, c.body, c.created_at
       FROM comments c
       JOIN questions q ON q.id = c.question_id
       ORDER BY c.id`,
    )
    .all() as BundleComment[];

  return {
    format: "traffic-bench",
    version: BUNDLE_VERSION,
    kind: "responses",
    exported_at: new Date().toISOString(),
    responses: rows,
    comments,
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
}

export function importQuestions(bundle: QuestionBundle): ImportResult {
  const db = getDb();
  if (!Array.isArray(bundle.questions)) throw new BundleError("Bundle has no questions.");

  const existing = db.prepare("SELECT 1 FROM questions WHERE uid = ?");
  const insert = db.prepare(
    `INSERT INTO questions (uid, image_path, prompt, category, answer_type, options)
     VALUES (?, ?, ?, ?, ?, ?)`,
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
       (question_id, grounder_name, answer, confidence, rationale, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
    `INSERT INTO comments (uid, question_id, author_role, author_name, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const commentExists = db.prepare("SELECT 1 FROM comments WHERE uid = ?");

  let comments = 0;
  const runComments = db.transaction((list: BundleComment[]) => {
    for (const c of list) {
      if (!c?.uid || !c.body || !c.question_uid) continue;
      if (commentExists.get(c.uid)) continue;
      const question = findQuestion.get(c.question_uid) as Question | undefined;
      if (!question) continue;
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

  run(bundle.responses);
  if (Array.isArray(bundle.comments)) runComments(bundle.comments);

  return { kind: "responses", added, skipped, unmatched, comments };
}
