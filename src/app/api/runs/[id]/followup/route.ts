import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getDb, uploadPath } from "@/lib/db";
import { askFollowUp, type Turn } from "@/lib/providers";
import { isGrounder } from "@/lib/session";
import { syncInBackground } from "@/lib/sync";
import type { LlmRun, ModelRow, Question, RunTurn } from "@/lib/types";

export const maxDuration = 300;

const MEDIA: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (await isGrounder()) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json()) as { message?: string; answer?: string };
  const message = (body.message ?? "").trim();
  if (!message) {
    return NextResponse.json({ error: "Ask something first" }, { status: 400 });
  }

  const db = getDb();
  const run = db.prepare("SELECT * FROM llm_runs WHERE id = ?").get(id) as LlmRun | undefined;
  if (!run) return NextResponse.json({ error: "Unknown answer" }, { status: 404 });
  if (run.error) {
    return NextResponse.json({ error: "That run failed — re-run it first" }, { status: 400 });
  }

  const question = db.prepare("SELECT * FROM questions WHERE id = ?").get(run.question_id) as
    | Question
    | undefined;
  const model = db.prepare("SELECT * FROM models WHERE key = ?").get(run.model_key) as
    | ModelRow
    | undefined;
  if (!question || !model) {
    return NextResponse.json({ error: "Question or model is missing" }, { status: 404 });
  }

  const priorTurns = db
    .prepare("SELECT * FROM run_turns WHERE run_id = ? ORDER BY id")
    .all(run.id) as RunTurn[];

  const insertTurn = db.prepare(
    "INSERT INTO run_turns (run_id, role, content, latency_ms, error) VALUES (?, ?, ?, ?, ?)",
  );

  // A manual model has no API to call, so the reply is supplied by hand.
  if (model.provider === "manual") {
    const answer = (body.answer ?? "").trim();
    if (!answer) {
      return NextResponse.json(
        { error: "This is a manual model — paste its reply too" },
        { status: 400 },
      );
    }
    insertTurn.run(run.id, "user", message, null, null);
    insertTurn.run(run.id, "assistant", answer, null, null);
    await syncInBackground();
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  // The thread replays the model's own first answer, then every stored turn.
  const history: Turn[] = [
    { role: "assistant", content: run.answer ?? "" },
    ...priorTurns
      .filter((t) => !t.error)
      .map((t) => ({ role: t.role, content: t.content })),
    { role: "user", content: message },
  ];

  const bytes = await fs.readFile(uploadPath(question.image_path));
  const mediaType = MEDIA[path.extname(question.image_path).toLowerCase()] ?? "image/png";

  const started = Date.now();
  try {
    const reply = await askFollowUp(
      model,
      question,
      bytes.toString("base64"),
      mediaType,
      history,
    );
    insertTurn.run(run.id, "user", message, null, null);
    insertTurn.run(run.id, "assistant", reply, Date.now() - started, null);
    await syncInBackground();
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    insertTurn.run(run.id, "user", message, null, null);
    insertTurn.run(
      run.id,
      "assistant",
      "",
      Date.now() - started,
      error instanceof Error ? error.message : String(error),
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Follow-up failed" },
      { status: 502 },
    );
  }
}
