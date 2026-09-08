import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { getDb, uploadPath } from "@/lib/db";
import { isGrounder } from "@/lib/session";
import type { Question } from "@/lib/types";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (await isGrounder()) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const { id } = await params;
  const question = getDb().prepare("SELECT * FROM questions WHERE id = ?").get(id) as
    | Question
    | undefined;
  if (!question) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const db = getDb();
  db.prepare(
    `DELETE FROM grades WHERE (target_type = 'human' AND target_id IN
       (SELECT id FROM human_responses WHERE question_id = ?))
      OR (target_type = 'llm' AND target_id IN
       (SELECT id FROM llm_runs WHERE question_id = ?))`,
  ).run(id, id);
  db.prepare(
    `DELETE FROM run_turns WHERE run_id IN
       (SELECT id FROM llm_runs WHERE question_id = ?)`,
  ).run(id);
  db.prepare("DELETE FROM human_responses WHERE question_id = ?").run(id);
  db.prepare("DELETE FROM llm_runs WHERE question_id = ?").run(id);
  db.prepare("DELETE FROM questions WHERE id = ?").run(id);
  await fs.rm(uploadPath(question.image_path), { force: true });

  return NextResponse.json({ ok: true });
}
