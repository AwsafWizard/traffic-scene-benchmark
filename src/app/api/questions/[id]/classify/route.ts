import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isGrounder } from "@/lib/session";
import { syncInBackground } from "@/lib/sync";
import { FORMAT_BY_CODE, TYPE_BY_CODE, type AnswerFormat } from "@/lib/taxonomy";

/** Assigns a taxonomy type to a question written before the taxonomy existed. */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (await isGrounder()) {
    return NextResponse.json({ error: "Not allowed" }, { status: 403 });
  }

  const { id } = await params;
  const body = (await request.json()) as {
    type_code?: string;
    verifiability?: string;
    modality?: string;
    probes?: string[];
    answer_format?: string;
  };

  const type = TYPE_BY_CODE.get(body.type_code ?? "");
  if (!type) return NextResponse.json({ error: "Unknown type" }, { status: 400 });

  const format = (body.answer_format ?? type.format) as AnswerFormat;
  if (!FORMAT_BY_CODE.has(format)) {
    return NextResponse.json({ error: "Unknown answer format" }, { status: 400 });
  }

  const result = getDb()
    .prepare(
      `UPDATE questions
          SET type_code = ?, verifiability = ?, modality = ?, probes = ?, answer_format = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
    )
    .run(
      type.code,
      body.verifiability || type.verifiability,
      body.modality || type.modality,
      JSON.stringify(body.probes ?? type.probes),
      format,
      id,
    );

  if (result.changes === 0) {
    return NextResponse.json({ error: "Unknown question" }, { status: 404 });
  }

  // Classifying someone else's question is an edit they should see too.
  await syncInBackground();
  return NextResponse.json({ ok: true });
}
