import { NextResponse } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { getDb, uploadPath } from "@/lib/db";
import { parseQuestionFields } from "@/lib/question-fields";
import { isGrounder } from "@/lib/session";
import { syncInBackground } from "@/lib/sync";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function POST(request: Request) {
  if (await isGrounder()) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("image");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "An image is required" }, { status: 400 });
  }
  if (!ALLOWED.has(file.type)) {
    return NextResponse.json({ error: `Unsupported image type: ${file.type}` }, { status: 400 });
  }

  const parsed = parseQuestionFields(Object.fromEntries(form));
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const f = parsed.fields;

  const ext = { "image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif" }[
    file.type
  ]!;
  const name = `${crypto.randomUUID()}${ext}`;
  await fs.writeFile(uploadPath(name), Buffer.from(await file.arrayBuffer()));

  const info = getDb()
    .prepare(
      `INSERT INTO questions
         (uid, image_path, prompt, category, answer_type, options, reference_answer, notes,
          type_code, verifiability, modality, probes, answer_format, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(
      crypto.randomUUID(),
      name,
      f.prompt,
      f.category,
      f.answerType,
      f.options,
      f.reference,
      f.notes,
      f.typeCode,
      f.verifiability,
      f.modality,
      f.probes,
      f.format,
    );

  await syncInBackground();
  return NextResponse.json({ id: info.lastInsertRowid }, { status: 201 });
}
