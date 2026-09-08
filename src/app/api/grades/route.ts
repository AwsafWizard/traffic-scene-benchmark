import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isGrounder } from "@/lib/session";

export async function POST(request: Request) {
  if (await isGrounder()) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const body = (await request.json()) as {
    target_type?: string;
    target_id?: number;
    verdict?: string;
  };

  if (!["human", "llm"].includes(body.target_type ?? "")) {
    return NextResponse.json({ error: "Invalid target type" }, { status: 400 });
  }
  if (!["correct", "partial", "incorrect"].includes(body.verdict ?? "")) {
    return NextResponse.json({ error: "Invalid verdict" }, { status: 400 });
  }
  if (!body.target_id) {
    return NextResponse.json({ error: "target_id is required" }, { status: 400 });
  }

  getDb().prepare(
    `INSERT OR REPLACE INTO grades (target_type, target_id, verdict, grader)
     VALUES (?, ?, ?, 'setter')`,
  ).run(body.target_type, body.target_id, body.verdict);

  return NextResponse.json({ ok: true });
}
