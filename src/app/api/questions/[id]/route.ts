import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import { getDb, uploadPath } from "@/lib/db";
import { answerKeyHiddenHere } from "@/lib/blind";
import { parseQuestionFields, type RawQuestionFields } from "@/lib/question-fields";
import { regradeQuestion } from "@/lib/regrade";
import { isGrounder } from "@/lib/session";
import { syncInBackground } from "@/lib/sync";
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

/** Which fields travel to the other copy. Notes stay here and don't count. */
function sharedFields(q: {
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
}) {
  return {
    prompt: q.prompt,
    category: q.category,
    answer_type: q.answer_type,
    options: q.options,
    type_code: q.type_code,
    verifiability: q.verifiability,
    modality: q.modality,
    probes: q.probes,
    answer_format: q.answer_format,
    reference_answer: q.reference_answer,
  };
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (await isGrounder()) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const { id } = await params;
  const db = getDb();
  const question = db.prepare("SELECT * FROM questions WHERE id = ?").get(id) as
    | Question
    | undefined;
  if (!question) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // The edit form shows the answer key, so it is held back exactly as Compare is.
  if (answerKeyHiddenHere(question)) {
    return NextResponse.json(
      { error: "Answer this question before editing it — editing reveals its answer key." },
      { status: 403 },
    );
  }

  const parsed = parseQuestionFields((await request.json()) as RawQuestionFields);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const f = parsed.fields;

  const before = sharedFields(question);
  const after = sharedFields({
    prompt: f.prompt,
    category: f.category,
    answer_type: f.answerType,
    options: f.options,
    type_code: f.typeCode,
    verifiability: f.verifiability,
    modality: f.modality,
    probes: f.probes,
    answer_format: f.format,
    reference_answer: f.reference,
  });
  const sharedChanged = JSON.stringify(before) !== JSON.stringify(after);

  // An emptied field has to be told apart from one never filled in, or the
  // other copy's old value would simply win it back on the next sync.
  const cleared = new Set<string>(
    question.cleared_fields ? (JSON.parse(question.cleared_fields) as string[]) : [],
  );
  for (const field of ["options", "reference_answer"] as const) {
    const had = before[field] !== null && before[field] !== "";
    const has = after[field] !== null && after[field] !== "";
    if (has) cleared.delete(field);
    else if (had) cleared.add(field);
  }

  db.prepare(
    `UPDATE questions
        SET prompt = ?, category = ?, answer_type = ?, options = ?, type_code = ?,
            verifiability = ?, modality = ?, probes = ?, answer_format = ?,
            reference_answer = ?, notes = ?, cleared_fields = ?,
            -- Only a change the other copy will see moves the stamp. A notes-only
            -- edit leaves it alone, so it doesn't send them an unchanged question.
            updated_at = CASE WHEN ? THEN datetime('now') ELSE updated_at END
      WHERE id = ?`,
  ).run(
    f.prompt,
    f.category,
    f.answerType,
    f.options,
    f.typeCode,
    f.verifiability,
    f.modality,
    f.probes,
    f.format,
    f.reference,
    f.notes,
    cleared.size ? JSON.stringify([...cleared].sort()) : null,
    sharedChanged ? 1 : 0,
    id,
  );

  const scoringChanged =
    before.reference_answer !== after.reference_answer ||
    before.answer_format !== after.answer_format ||
    before.options !== after.options;
  const regraded = scoringChanged ? regradeQuestion(question.id) : 0;

  // Publishes the rewritten question file, and the answers file if any verdict moved.
  await syncInBackground();
  return NextResponse.json({ ok: true, shared: sharedChanged, regraded });
}
