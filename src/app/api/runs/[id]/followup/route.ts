import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isGrounder } from "@/lib/session";
import { syncInBackground } from "@/lib/sync";
import type { LlmRun } from "@/lib/types";

/**
 * Records a follow-up exchange on a model answer. Models are answered by hand,
 * so this stores the question you put to the model and the reply it gave you
 * wherever you ran it.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (await isGrounder()) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json()) as { message?: string; answer?: string };

  const message = (body.message ?? "").trim();
  if (!message) return NextResponse.json({ error: "Ask something first" }, { status: 400 });

  const answer = (body.answer ?? "").trim();
  if (!answer) {
    return NextResponse.json(
      { error: "Paste the model's reply alongside your question" },
      { status: 400 },
    );
  }

  const db = getDb();
  const run = db.prepare("SELECT * FROM llm_runs WHERE id = ?").get(id) as LlmRun | undefined;
  if (!run) return NextResponse.json({ error: "Unknown answer" }, { status: 404 });

  const insertTurn = db.prepare(
    "INSERT INTO run_turns (run_id, role, content) VALUES (?, ?, ?)",
  );
  insertTurn.run(run.id, "user", message);
  insertTurn.run(run.id, "assistant", answer);

  await syncInBackground();
  return NextResponse.json({ ok: true }, { status: 201 });
}
