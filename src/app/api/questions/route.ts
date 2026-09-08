import { NextResponse } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { getDb, uploadPath } from "@/lib/db";
import { isGrounder } from "@/lib/session";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function POST(request: Request) {
  if (await isGrounder()) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("image");
  const prompt = String(form.get("prompt") ?? "").trim();
  const category = String(form.get("category") ?? "");
  const answerType = String(form.get("answer_type") ?? "");
  const optionsRaw = String(form.get("options") ?? "").trim();
  const reference = String(form.get("reference_answer") ?? "").trim();
  const notes = String(form.get("notes") ?? "").trim();

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "An image is required" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: `Unsupported image type: ${file.type}` }, { status: 400 });
  }
  if (!prompt) return NextResponse.json({ error: "A question is required" }, { status: 400 });
  if (!["spatial", "logical", "behavioral"].includes(category)) {
    return NextResponse.json({ error: "Invalid category" }, { status: 400 });
  }
  if (!["mcq", "free"].includes(answerType)) {
    return NextResponse.json({ error: "Invalid answer type" }, { status: 400 });
  }

  let options: string | null = null;
  if (answerType === "mcq") {
    const list = optionsRaw.split("\n").map((o) => o.trim()).filter(Boolean);
    if (list.length < 2) {
      return NextResponse.json({ error: "Give at least two options" }, { status: 400 });
    }
    options = JSON.stringify(list);
  }

  const ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" }[
    file.type
  ]!;
  const name = `${crypto.randomUUID()}${ext}`;
  await fs.writeFile(uploadPath(name), Buffer.from(await file.arrayBuffer()));

  const info = getDb()
    .prepare(
      `INSERT INTO questions (uid, image_path, prompt, category, answer_type, options, reference_answer, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      name,
      prompt,
      category,
      answerType,
      options,
      reference || null,
      notes || null,
    );

  return NextResponse.json({ id: info.lastInsertRowid }, { status: 201 });
}
