import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { autoGrade } from "@/lib/scoring";
import type { Question } from "@/lib/types";
import { syncInBackground } from "@/lib/sync";
import { isGrounder } from "@/lib/session";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    question_id?: number;
    grounder_name?: string;
    answer?: string;
    confidence?: number;
    rationale?: string;
    duration_ms?: number;
  };

  const question = getDb().prepare("SELECT * FROM questions WHERE id = ?").get(body.question_id) as
    | Question
    | undefined;
  if (!question) return NextResponse.json({ error: "Unknown question" }, { status: 404 });

  const answer = (body.answer ?? "").trim();
  if (!answer) return NextResponse.json({ error: "An answer is required" }, { status: 400 });

  const info = getDb()
    .prepare(
      `INSERT INTO human_responses (question_id, grounder_name, answer, confidence, rationale, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      question.id,
      (body.grounder_name ?? "anonymous").trim() || "anonymous",
      answer,
      body.confidence ?? null,
      body.rationale?.trim() || null,
      body.duration_ms ?? null,
    );

  const verdict = autoGrade(question, answer);
  if (verdict) {
    getDb().prepare(
      `INSERT OR REPLACE INTO grades (target_type, target_id, verdict, grader)
       VALUES ('human', ?, ?, 'auto')`,
    ).run(info.lastInsertRowid, verdict);
  }

  // Hand back the next unanswered question so a copy that only grounds can keep
  // going without passing through the Compare page, which would reveal the
  // answers.
  const next = getDb()
    .prepare(
      `SELECT q.id FROM questions q
       WHERE NOT EXISTS (SELECT 1 FROM human_responses h WHERE h.question_id = q.id)
       ORDER BY q.id LIMIT 1`,
    )
    .get() as { id: number } | undefined;

  await syncInBackground();

  // Only a copy set to Grounder stays blind. Having now answered the question
  // yourself there is nothing left to spoil, whether you wrote it or your
  // partner did — and the button did say "Submit and reveal".
  const stayBlind = await isGrounder();

  return NextResponse.json(
    { id: info.lastInsertRowid, next_question_id: next?.id ?? null, stay_blind: stayBlind },
    { status: 201 },
  );
}
