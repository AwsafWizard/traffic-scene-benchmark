import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isGrounder } from "@/lib/session";
import { syncInBackground } from "@/lib/sync";

const FORBIDDEN = NextResponse.json({ error: "Not allowed" }, { status: 403 });

/**
 * Model IDs are short public strings like "gemini-2.5-pro". These shapes are
 * API keys or auth tokens, which people paste in by mistake — storing one would
 * put a live credential in the database and in page HTML.
 */
const SECRET_SHAPES = [
  /^AIza[\w-]{10,}$/, // Google API key
  /^AQ\.[\w-]{10,}$/, // Google auth/ephemeral token
  /^sk-[\w-]{10,}$/, // OpenAI
  /^sk-ant-[\w-]{10,}$/, // Anthropic
  /^ya29\.[\w-]{10,}$/, // Google OAuth access token
];

function looksLikeSecret(value: string): boolean {
  return SECRET_SHAPES.some((re) => re.test(value)) || value.length > 80;
}

export async function POST(request: Request) {
  if (await isGrounder()) return FORBIDDEN;

  const body = (await request.json()) as {
    key?: string;
    label?: string;
    provider?: string;
    model_id?: string;
    extra?: string;
  };

  const label = (body.label ?? "").trim();
  const provider = (body.provider ?? "").trim();
  // A manual model needs no real model string, so fall back to its display name.
  const modelId = (body.model_id ?? "").trim() || label;
  const key = (body.key ?? "").trim() || modelId;
  const extra = (body.extra ?? "").trim();

  if (!label) return NextResponse.json({ error: "A display name is required" }, { status: 400 });
  if (!provider) {
    return NextResponse.json({ error: "A provider is required" }, { status: 400 });
  }
  if (!modelId) return NextResponse.json({ error: "A model ID is required" }, { status: 400 });
  if (looksLikeSecret(modelId) || looksLikeSecret(key)) {
    return NextResponse.json(
      {
        error:
          "That looks like an API key, not a model ID. Keys belong in .env.local — the Model ID is a short public name like \"gemini-2.5-pro\". If you pasted a real key here, revoke it.",
      },
      { status: 400 },
    );
  }
  try {
    getDb()
      .prepare("INSERT INTO models (key, label, provider, model_id, extra) VALUES (?, ?, ?, ?, ?)")
      .run(key, label, provider, modelId, extra || null);
  } catch {
    return NextResponse.json({ error: `Model "${key}" already exists` }, { status: 409 });
  }
  await syncInBackground();
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function PATCH(request: Request) {
  if (await isGrounder()) return FORBIDDEN;
  const body = (await request.json()) as { key?: string; enabled?: boolean };
  if (!body.key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  getDb().prepare("UPDATE models SET enabled = ? WHERE key = ?").run(body.enabled ? 1 : 0, body.key);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  if (await isGrounder()) return FORBIDDEN;
  const key = new URL(request.url).searchParams.get("key");
  if (!key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  getDb().prepare("DELETE FROM models WHERE key = ?").run(key);
  return NextResponse.json({ ok: true });
}
