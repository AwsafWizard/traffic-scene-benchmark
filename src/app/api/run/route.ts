import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";
import { getDb, uploadPath } from "@/lib/db";
import { askModel } from "@/lib/providers";
import { autoGrade } from "@/lib/scoring";
import { isGrounder } from "@/lib/session";
import type { ModelRow, Question } from "@/lib/types";

export const maxDuration = 300;

const MEDIA: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

export async function POST(request: Request) {
  if (await isGrounder()) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const body = (await request.json()) as { question_id?: number; model_keys?: string[] };

  const question = getDb().prepare("SELECT * FROM questions WHERE id = ?").get(body.question_id) as
    | Question
    | undefined;
  if (!question) return NextResponse.json({ error: "Unknown question" }, { status: 404 });

  const models = (
    body.model_keys?.length
      ? getDb()
          .prepare(
            `SELECT * FROM models WHERE key IN (${body.model_keys.map(() => "?").join(",")})`,
          )
          .all(...body.model_keys)
      : getDb().prepare("SELECT * FROM models WHERE enabled = 1").all()
  ) as ModelRow[];

  // Manual models have no API to call; their answers are pasted in instead.
  const callable = models.filter((m) => m.provider !== "manual");

  if (callable.length === 0) {
    return NextResponse.json(
      {
        error: models.length
          ? "Every enabled model is manual — paste those answers in below."
          : "No models enabled. Add one on the Models page.",
      },
      { status: 400 },
    );
  }

  const bytes = await fs.readFile(uploadPath(question.image_path));
  const imageB64 = bytes.toString("base64");
  const mediaType = MEDIA[path.extname(question.image_path).toLowerCase()] ?? "image/png";

  const insert = getDb().prepare(
    `INSERT INTO llm_runs (question_id, model_key, answer, reasoning, raw, latency_ms, error)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const results = await Promise.all(
    callable.map(async (model) => {
      const started = Date.now();
      try {
        const result = await askModel(model, question, imageB64, mediaType);
        const latency = Date.now() - started;
        const info = insert.run(
          question.id,
          model.key,
          result.answer,
          result.reasoning,
          JSON.stringify(result.raw),
          latency,
          null,
        );
        const verdict = autoGrade(question, result.answer);
        if (verdict) {
          getDb().prepare(
            `INSERT OR REPLACE INTO grades (target_type, target_id, verdict, grader)
             VALUES ('llm', ?, ?, 'auto')`,
          ).run(info.lastInsertRowid, verdict);
        }
        return { model: model.key, ok: true };
      } catch (error) {
        insert.run(
          question.id,
          model.key,
          null,
          null,
          null,
          Date.now() - started,
          error instanceof Error ? error.message : String(error),
        );
        return { model: model.key, ok: false };
      }
    }),
  );

  return NextResponse.json({ results });
}
