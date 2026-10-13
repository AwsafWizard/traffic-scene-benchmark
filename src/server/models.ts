import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { audit } from "./audit";
import { sql } from "./db";
import { shuffled } from "./engine";
import type { Option } from "./questions";
import type { Result } from "./sprints";
import { imageBytes, type StoredImage } from "./storage";

/**
 * Models and the model check. The admin either pastes which option a model chose
 * (run anywhere they like), or, when that provider's API key is set, has the app
 * ask the model directly. Either way each answer records the option order the
 * model was shown, so answers can't lean on position.
 */

export type Provider = "openai" | "anthropic" | "google" | "manual";

export interface Model {
  id: number;
  name: string;
  provider: Provider;
  model_id: string | null;
  notes: string | null;
  active: boolean;
}

const fail = (error: string): Result => ({ ok: false, error });
const LETTERS = ["A", "B", "C", "D", "E"];

export async function listModels({ activeOnly = false } = {}): Promise<Model[]> {
  return sql<Model[]>`select id, name, provider, model_id, notes, active from models
                      where ${activeOnly ? sql`active` : sql`true`} order by active desc, name`;
}

export function apiAvailable(provider: Provider): boolean {
  if (provider === "anthropic") return Boolean(process.env.ANTHROPIC_API_KEY);
  if (provider === "openai") return Boolean(process.env.OPENAI_API_KEY);
  if (provider === "google") return Boolean(process.env.GEMINI_API_KEY);
  return false;
}

export async function saveModel(
  adminId: string,
  input: { id?: number; name: string; provider: string; model_id: string; notes: string; active: boolean },
): Promise<Result> {
  const name = input.name.trim();
  if (!name) return fail("Give the model a name.");
  if (!["openai", "anthropic", "google", "manual"].includes(input.provider)) return fail("Pick a provider.");
  const modelId = input.model_id.trim() || null;
  if (input.provider !== "manual" && !modelId) return fail("Give the provider's model ID, e.g. claude-opus-5-5.");
  const [clash] = await sql`select 1 from models where lower(name) = lower(${name}) and id <> ${input.id ?? 0}`;
  if (clash) return fail("Another model already has that name.");
  if (input.id) {
    await sql`update models set name = ${name}, provider = ${input.provider}, model_id = ${modelId},
              notes = ${input.notes.trim() || null}, active = ${input.active} where id = ${input.id}`;
  } else {
    await sql`insert into models (name, provider, model_id, notes, active)
              values (${name}, ${input.provider}, ${modelId}, ${input.notes.trim() || null}, ${input.active})`;
  }
  await audit(adminId, input.id ? "model.update" : "model.create", input.id ?? name, { ...input });
  return { ok: true };
}

/** The question as a model sees it: options lettered in a fresh random order. */
export function buildPrompt(prompt: string, options: Option[], order: string[]): string {
  const byId = new Map(options.map((o) => [o.id, o.text]));
  const lines = order.map((id, i) => `${LETTERS[i]}. ${byId.get(id)}`);
  return `${prompt}\n\n${lines.join("\n")}\n\nAnswer with the letter of the correct option only.`;
}

/** A fresh option order for a model to see. */
export function newOrder(options: Option[]): string[] {
  return shuffled(options.map((o) => o.id));
}

/** Finds the chosen letter in a model's reply and maps it back to an option id. */
export function parseLetter(text: string, order: string[]): string | null {
  const valid = LETTERS.slice(0, order.length).join("");
  const trimmed = text.trim();
  const patterns = [
    new RegExp(`^\\(?([${valid}])\\)?(?:[.):\\s]|$)`),
    new RegExp(`answer(?: is)?\\s*[:\\-]?\\s*\\(?([${valid}])\\b`, "i"),
    new RegExp(`\\b([${valid}])\\b(?![^\\n]*\\b[${valid}]\\b)`),
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match) return order[LETTERS.indexOf(match[1].toUpperCase())] ?? null;
  }
  return null;
}

export async function recordManualAnswer(
  adminId: string,
  questionId: string,
  modelId: number,
  order: string[],
  chosen: string,
  raw: string,
): Promise<Result> {
  const [q] = await sql<{ options: Option[] }[]>`select options from questions where id = ${questionId}`;
  if (!q) return fail("Question not found.");
  const ids = q.options.map((o) => o.id);
  if (!ids.includes(chosen)) return fail("Pick the option the model chose.");
  if (order.length !== ids.length || !order.every((id) => ids.includes(id))) return fail("Bad option order.");
  await sql`insert into model_answers (question_id, model_id, option_order, chosen_option, raw_output, source, created_by)
            values (${questionId}, ${modelId}, ${sql.json(order)}, ${chosen}, ${raw.trim() || null}, 'manual', ${adminId})`;
  return { ok: true };
}

async function askAnthropic(model: string, prompt: string, image: { data: Buffer; type: string }): Promise<string> {
  const client = new Anthropic();
  // No refusal fallback on purpose: a fallback would answer with a different
  // model, and the benchmark would record it under the wrong name.
  const response = await client.messages.create({
    model,
    max_tokens: 16000,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: image.data.toString("base64") } },
          { type: "text", text: prompt },
        ],
      },
    ],
  });
  if (response.stop_reason === "refusal") {
    throw new Error(`Refused${response.stop_details?.category ? ` (${response.stop_details.category})` : ""}`);
  }
  return response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n");
}

async function askOpenAI(model: string, prompt: string, image: { data: Buffer; type: string }): Promise<string> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${image.type};base64,${image.data.toString("base64")}` } },
            { type: "text", text: prompt },
          ],
        },
      ],
    }),
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message ?? `OpenAI error ${response.status}`);
  return body.choices?.[0]?.message?.content ?? "";
}

async function askGemini(model: string, prompt: string, image: { data: Buffer; type: string }): Promise<string> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "x-goog-api-key": process.env.GEMINI_API_KEY!, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: image.type, data: image.data.toString("base64") } }, { text: prompt }] }],
      }),
    },
  );
  const body = await response.json();
  if (!response.ok) throw new Error(body?.error?.message ?? `Gemini error ${response.status}`);
  return (body.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("\n");
}

/** Asks a model one question by API and records its answer (or the error). */
export async function runModelApi(adminId: string, questionId: string, modelDbId: number): Promise<Result> {
  const [model] = await sql<Model[]>`select * from models where id = ${modelDbId} and active`;
  if (!model || model.provider === "manual" || !model.model_id) return fail("That model can't be run by API.");
  if (!apiAvailable(model.provider)) return fail(`No API key is set for ${model.provider}.`);
  const [q] = await sql<{ prompt: string; options: Option[]; image_id: string; storage: StoredImage["storage"]; storage_key: string; version: string | null }[]>`
    select q.prompt, q.options, i.id as image_id, i.storage, i.storage_key, i.version
    from questions q join images i on i.id = q.image_id where q.id = ${questionId}`;
  if (!q) return fail("Question not found.");

  const order = newOrder(q.options);
  const prompt = buildPrompt(q.prompt, q.options, order);
  let raw: string | null = null;
  let error: string | null = null;
  try {
    const image = await imageBytes({ id: q.image_id, storage: q.storage, storage_key: q.storage_key, version: q.version });
    const ask = model.provider === "anthropic" ? askAnthropic : model.provider === "openai" ? askOpenAI : askGemini;
    raw = await ask(model.model_id, prompt, image);
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 500) : "Request failed";
  }
  const chosen = raw ? parseLetter(raw, order) : null;
  if (raw && !chosen) error = "Couldn't find an option letter in the reply.";
  await sql`insert into model_answers (question_id, model_id, option_order, chosen_option, raw_output, source, error, created_by)
            values (${questionId}, ${modelDbId}, ${sql.json(order)}, ${chosen}, ${raw?.slice(0, 20000) ?? null}, 'api', ${error}, ${adminId})`;
  return error ? fail(error) : { ok: true };
}
