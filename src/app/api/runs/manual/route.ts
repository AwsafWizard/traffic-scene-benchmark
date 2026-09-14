import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { autoGrade } from "@/lib/scoring";
import { isGrounder } from "@/lib/session";
import type { ModelRow, Question } from "@/lib/types";
import { syncInBackground } from "@/lib/sync";

/** Records an answer the benchmarker obtained outside this app and pasted in. */
export async function POST(request: Request) {
  if (await isGrounder()) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const body = (await request.json()) as {
    question_id?: number;
    model_key?: string;
    answer?: string;
    reasoning?: string;
  };

  const db = getDb();
  const question = db.prepare("SELECT * FROM questions WHERE id = ?").get(body.question_id) as
    | Question
    | undefined;
  if (!question) return NextResponse.json({ error: "Unknown question" }, { status: 404 });

  const model = db.prepare("SELECT * FROM models WHERE key = ?").get(body.model_key) as
    | ModelRow
    | undefined;
  if (!model) return NextResponse.json({ error: "Unknown model" }, { status: 404 });

  const answer = (body.answer ?? "").trim();
  if (!answer) return NextResponse.json({ error: "An answer is required" }, { status: 400 });

  const info = db
    .prepare(
      `INSERT INTO llm_runs (uid, question_id, model_key, answer, reasoning, source)
       VALUES (?, ?, ?, ?, ?, 'manual')`,
    )
    .run(crypto.randomUUID(), question.id, model.key, answer, body.reasoning?.trim() || null);

  const verdict = autoGrade(question, answer);
  if (verdict) {
    db.prepare(
      `INSERT OR REPLACE INTO grades (target_type, target_id, verdict, grader)
       VALUES ('llm', ?, ?, 'auto')`,
    ).run(info.lastInsertRowid, verdict);
  }

  await syncInBackground();
  return NextResponse.json({ id: info.lastInsertRowid }, { status: 201 });
}
