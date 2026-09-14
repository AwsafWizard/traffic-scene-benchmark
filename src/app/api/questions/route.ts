import { NextResponse } from "next/server";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import { getDb, uploadPath } from "@/lib/db";
import { isGrounder } from "@/lib/session";
import {
  FORMAT_BY_CODE,
  TYPE_BY_CODE,
  type AnswerFormat,
} from "@/lib/taxonomy";

/**
 * The old three-way category still backs a few older views, so it is kept in
 * step with whichever dimension the chosen type belongs to.
 */
function legacyCategory(dimension: number): string {
  if (dimension === 3) return "spatial";
  if (dimension === 4) return "behavioral";
  return "logical";
}
import { syncInBackground } from "@/lib/sync";

const ALLOWED = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export async function POST(request: Request) {
  if (await isGrounder()) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const form = await request.formData();
  const file = form.get("image");
  const prompt = String(form.get("prompt") ?? "").trim();
  const typeCode = String(form.get("type_code") ?? "").trim();
  const verifiability = String(form.get("verifiability") ?? "").trim();
  const modality = String(form.get("modality") ?? "").trim();
  const answerFormat = String(form.get("answer_format") ?? "").trim();
  const probesRaw = String(form.get("probes") ?? "[]");
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

  const type = TYPE_BY_CODE.get(typeCode);
  if (!type) {
    return NextResponse.json({ error: "Pick a fine-grained type" }, { status: 400 });
  }

  const spec = FORMAT_BY_CODE.get((answerFormat || type.format) as AnswerFormat);
  if (!spec) return NextResponse.json({ error: "Unknown answer format" }, { status: 400 });

  let probes: string[] = [];
  try {
    const parsed = JSON.parse(probesRaw) as unknown;
    if (Array.isArray(parsed)) probes = parsed.filter((p): p is string => typeof p === "string");
  } catch {
    probes = [...type.probes];
  }

  let options: string | null = null;
  if (spec.hasOptions) {
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
      `INSERT INTO questions
         (uid, image_path, prompt, category, answer_type, options, reference_answer, notes,
          type_code, verifiability, modality, probes, answer_format)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      crypto.randomUUID(),
      name,
      prompt,
      // Kept in step with the taxonomy so older views keep working.
      legacyCategory(type.dimension),
      spec.hasOptions ? "mcq" : "free",
      options,
      reference || null,
      notes || null,
      type.code,
      verifiability || type.verifiability,
      modality || type.modality,
      JSON.stringify(probes),
      answerFormat || type.format,
    );

  await syncInBackground();
  return NextResponse.json({ id: info.lastInsertRowid }, { status: 201 });
}
