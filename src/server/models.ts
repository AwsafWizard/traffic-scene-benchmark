import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { audit } from "./audit";
import { resolveConnection, type ResolvedConnection } from "./connections";
import { sql } from "./db";
import { shuffled } from "./engine";
import type { Option } from "./questions";
import type { Result } from "./sprints";
import { imageBytes, type StoredImage } from "./storage";

/**
 * Models and the model check. A model with an API connection (and its provider
 * model ID) can be asked directly; any other model is answered by hand: the
 * admin runs it elsewhere and records the letter it chose. Either way each
 * answer records the option order the model was shown, its token use and time.
 */

export type Family = "proprietary" | "open_weight" | "driving" | "other";

export interface Model {
  id: number;
  name: string;
  /** The developer, as written in the proposal. */
  provider: string;
  model_id: string | null;
  connection_id: number | null;
  connection_name: string | null;
  family: Family;
  funded: boolean;
  price_in: number | null;
  price_out: number | null;
  request_options: Record<string, unknown> | null;
  notes: string | null;
  active: boolean;
  /** True when the app can call this model itself. */
  api_ready: boolean;
}

const fail = (error: string): Result => ({ ok: false, error });
const LETTERS = ["A", "B", "C", "D", "E"];

export async function listModels({ activeOnly = false } = {}): Promise<Model[]> {
  const rows = await sql<(Omit<Model, "price_in" | "price_out"> & { price_in: string | null; price_out: string | null })[]>`
    select m.id, m.name, m.provider, m.model_id, m.connection_id, c.name as connection_name, m.family, m.funded,
      m.price_in, m.price_out, m.request_options, m.notes, m.active,
      (m.model_id is not null and c.active and (c.api_key_enc is not null or c.kind = 'openai_compatible')) is true as api_ready
    from models m left join api_connections c on c.id = m.connection_id
    where ${activeOnly ? sql`m.active` : sql`true`}
    order by m.active desc, m.sort, m.name`;
  return rows.map((r) => ({
    ...r,
    price_in: r.price_in === null ? null : Number(r.price_in),
    price_out: r.price_out === null ? null : Number(r.price_out),
  }));
}

/** Parses the admin's request-options JSON: an object, small, and unable to replace the prompt. */
export function parseRequestOptions(text: string): { ok: true; value: Record<string, unknown> | null } | { ok: false; error: string } {
  const trimmed = text.trim();
  if (!trimmed) return { ok: true, value: null };
  if (trimmed.length > 4000) return { ok: false, error: "Keep request options under 4,000 characters." };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { ok: false, error: "Request options must be valid JSON." };
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ok: false, error: "Request options must be a JSON object." };
  for (const reserved of ["model", "messages", "contents", "stream"]) {
    if (reserved in value) return { ok: false, error: `Request options can't set "${reserved}".` };
  }
  return { ok: true, value: value as Record<string, unknown> };
}

function price(value: string): number | null | undefined {
  if (!value.trim()) return null;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export async function saveModel(
  adminId: string,
  input: {
    id?: number; name: string; provider: string; family: string; funded: boolean; model_id: string;
    connection_id: number | null; price_in: string; price_out: string; request_options: string; notes: string; active: boolean;
  },
): Promise<Result> {
  const name = input.name.trim();
  if (!name) return fail("Give the model a name.");
  if (!["proprietary", "open_weight", "driving", "other"].includes(input.family)) return fail("Pick a family.");
  const priceIn = price(input.price_in);
  const priceOut = price(input.price_out);
  if (priceIn === undefined || priceOut === undefined) return fail("Prices are dollars per million tokens, e.g. 2.5.");
  const options = parseRequestOptions(input.request_options);
  if (!options.ok) return fail(options.error);
  if (input.connection_id) {
    const [conn] = await sql`select 1 from api_connections where id = ${input.connection_id}`;
    if (!conn) return fail("That connection no longer exists.");
    if (!input.model_id.trim()) return fail("Give the provider's model ID so the app knows what to call.");
  }
  const [clash] = await sql`select 1 from models where lower(name) = lower(${name}) and id <> ${input.id ?? 0}`;
  if (clash) return fail("Another model already has that name.");

  const fields = {
    name,
    provider: input.provider.trim() || "Unknown",
    family: input.family,
    funded: input.funded,
    model_id: input.model_id.trim() || null,
    connection_id: input.connection_id,
    price_in: priceIn,
    price_out: priceOut,
    request_options: options.value ? sql.json(options.value as never) : null,
    notes: input.notes.trim() || null,
    active: input.active,
  };
  if (input.id) {
    await sql`update models set ${sql(fields)} where id = ${input.id}`;
  } else {
    await sql`insert into models ${sql({ ...fields, sort: 1000 })}`;
  }
  await audit(adminId, input.id ? "model.update" : "model.create", input.id ?? name, { ...input, request_options: options.value });
  return { ok: true };
}

/** The question as a model sees it: options lettered in a fresh random order. */
export function buildPrompt(prompt: string, options: Option[], order: string[]): string {
  const byId = new Map(options.map((o) => [o.id, o.text]));
  const lines = order.map((id, i) => `${LETTERS[i]}. ${byId.get(id)}`);
  return `${prompt}\n\n${lines.join("\n")}\n\nAnswer with the letter of the correct option only.`;
}

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

export interface Image64 {
  data: string;
  type: string;
}

/** Request body for an OpenAI-compatible chat completions endpoint. Our fields always win. */
export function openAIBody(modelId: string, prompt: string, image: Image64, options: Record<string, unknown> | null) {
  return {
    ...(options ?? {}),
    model: modelId,
    messages: [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${image.type};base64,${image.data}` } },
          { type: "text", text: prompt },
        ],
      },
    ],
  };
}

/** Request body for the Gemini generateContent endpoint. */
export function geminiBody(prompt: string, image: Image64, options: Record<string, unknown> | null) {
  return {
    ...(options ?? {}),
    contents: [{ role: "user", parts: [{ inline_data: { mime_type: image.type, data: image.data } }, { text: prompt }] }],
  };
}

/** The text of an OpenAI-style reply, whether content is a string or a list of parts. */
export function openAIText(body: { choices?: { message?: { content?: unknown } }[] }): string {
  const content = body.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p?.text === "string" ? p.text : "")).join("\n");
  return "";
}

interface Reply {
  text: string;
  tokensIn: number | null;
  tokensOut: number | null;
}

async function ask(c: ResolvedConnection, model: Model, prompt: string, image: Image64): Promise<Reply> {
  const options = model.request_options;
  if (c.kind === "anthropic") {
    const client = new Anthropic({ apiKey: c.apiKey, ...(c.baseUrl ? { baseURL: c.baseUrl } : {}) });
    // No refusal fallback on purpose: a fallback would answer with a different
    // model, and the benchmark would record it under the wrong name.
    const response = await client.messages.create({
      max_tokens: 16000,
      ...(options ?? {}),
      model: model.model_id!,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: image.type as "image/jpeg", data: image.data } },
            { type: "text", text: prompt },
          ],
        },
      ],
    } as Anthropic.MessageCreateParamsNonStreaming);
    if (response.stop_reason === "refusal") {
      throw new Error(`Refused${response.stop_details?.category ? ` (${response.stop_details.category})` : ""}`);
    }
    const u = response.usage;
    return {
      text: response.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n"),
      tokensIn: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      tokensOut: u.output_tokens,
    };
  }

  if (c.kind === "google") {
    const base = c.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta";
    const response = await fetch(`${base}/models/${encodeURIComponent(model.model_id!)}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": c.apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(geminiBody(prompt, image, options)),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
    const usage = body.usageMetadata ?? {};
    return {
      text: (body.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("\n"),
      tokensIn: usage.promptTokenCount ?? null,
      tokensOut: usage.candidatesTokenCount === undefined ? null : usage.candidatesTokenCount + (usage.thoughtsTokenCount ?? 0),
    };
  }

  const response = await fetch(`${c.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {}) },
    body: JSON.stringify(openAIBody(model.model_id!, prompt, image, options)),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body?.error?.message ?? `HTTP ${response.status}`);
  return {
    text: openAIText(body),
    tokensIn: body.usage?.prompt_tokens ?? null,
    tokensOut: body.usage?.completion_tokens ?? null,
  };
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

/** Asks a model one question by API and records its answer (or the error). */
export async function runModelApi(adminId: string, questionId: string, modelDbId: number): Promise<Result> {
  const [model] = (await listModels()).filter((m) => m.id === modelDbId);
  if (!model || !model.api_ready || !model.connection_id) return fail("That model has no working API connection; record its answer by hand.");
  const connection = await resolveConnection(model.connection_id);
  if (!connection) return fail("The model's connection is switched off or has no key.");
  const [q] = await sql<{ prompt: string; options: Option[]; image_id: string; storage: StoredImage["storage"]; storage_key: string; version: string | null }[]>`
    select q.prompt, q.options, i.id as image_id, i.storage, i.storage_key, i.version
    from questions q join images i on i.id = q.image_id where q.id = ${questionId}`;
  if (!q) return fail("Question not found.");

  const order = newOrder(q.options);
  const prompt = buildPrompt(q.prompt, q.options, order);
  let reply: Reply | null = null;
  let error: string | null = null;
  const started = Date.now();
  try {
    const bytes = await imageBytes({ id: q.image_id, storage: q.storage, storage_key: q.storage_key, version: q.version });
    reply = await ask(connection, model, prompt, { data: bytes.data.toString("base64"), type: bytes.type });
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 500) : "Request failed";
  }
  const latency = Date.now() - started;
  const chosen = reply ? parseLetter(reply.text, order) : null;
  if (reply && !chosen) error = "Couldn't find an option letter in the reply.";
  await sql`insert into model_answers (question_id, model_id, option_order, chosen_option, raw_output, source, error,
              created_by, tokens_in, tokens_out, latency_ms)
            values (${questionId}, ${modelDbId}, ${sql.json(order)}, ${chosen}, ${reply?.text.slice(0, 20000) ?? null}, 'api', ${error},
              ${adminId}, ${reply?.tokensIn ?? null}, ${reply?.tokensOut ?? null}, ${latency})`;
  return error ? fail(error) : { ok: true };
}

/** Tokens used and estimated spend per model, from recorded API answers. */
export async function modelSpend(): Promise<Map<number, { calls: number; tokensIn: number; tokensOut: number; dollars: number | null }>> {
  const rows = await sql<{ model_id: number; calls: number; tin: string; tout: string; price_in: string | null; price_out: string | null }[]>`
    select a.model_id, count(*)::int as calls, coalesce(sum(a.tokens_in), 0) as tin, coalesce(sum(a.tokens_out), 0) as tout,
      m.price_in, m.price_out
    from model_answers a join models m on m.id = a.model_id where a.source = 'api'
    group by a.model_id, m.price_in, m.price_out`;
  return new Map(
    rows.map((r) => {
      const tokensIn = Number(r.tin);
      const tokensOut = Number(r.tout);
      const dollars = r.price_in === null || r.price_out === null ? null : (tokensIn * Number(r.price_in) + tokensOut * Number(r.price_out)) / 1e6;
      return [r.model_id, { calls: r.calls, tokensIn, tokensOut, dollars }];
    }),
  );
}
