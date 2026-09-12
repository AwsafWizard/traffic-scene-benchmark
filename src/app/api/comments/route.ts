import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { getDb } from "@/lib/db";
import { getRole } from "@/lib/session";
import { syncInBackground } from "@/lib/sync";

export async function POST(request: Request) {
  const body = (await request.json()) as {
    question_id?: number;
    body?: string;
    author_name?: string;
  };

  const text = (body.body ?? "").trim();
  if (!text) return NextResponse.json({ error: "Write something first" }, { status: 400 });

  const db = getDb();
  const question = db.prepare("SELECT id FROM questions WHERE id = ?").get(body.question_id) as
    | { id: number }
    | undefined;
  if (!question) return NextResponse.json({ error: "Unknown question" }, { status: 404 });

  const role = await getRole();
  const info = db
    .prepare(
      `INSERT INTO comments (uid, question_id, author_role, author_name, body)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      question.id,
      role,
      (body.author_name ?? "").trim() || null,
      text,
    );

  syncInBackground();
  return NextResponse.json({ id: info.lastInsertRowid }, { status: 201 });
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const db = getDb();
  const role = await getRole();
  // A grounder can retract their own note but not touch the setter's.
  const result =
    role === "grounder"
      ? db.prepare("DELETE FROM comments WHERE id = ? AND author_role = 'grounder'").run(id)
      : db.prepare("DELETE FROM comments WHERE id = ?").run(id);

  if (result.changes === 0) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }
  return NextResponse.json({ ok: true });
}
