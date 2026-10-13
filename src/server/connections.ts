import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { audit } from "./audit";
import { sql } from "./db";
import { decryptSecret, encryptSecret, encryptionConfigured } from "./secrets";

/**
 * API connections: one per provider account (or self-hosted model server). The
 * key is write-only from the admin's side: it's encrypted on save and never
 * returned, only its last four characters.
 */

export type ConnectionKind = "anthropic" | "google" | "openai_compatible";

export interface Connection {
  id: number;
  name: string;
  kind: ConnectionKind;
  base_url: string | null;
  key_hint: string | null;
  has_key: boolean;
  active: boolean;
  models: number;
}

/**
 * Starting points for the admin's form. Base URLs are the providers' documented
 * defaults at the time of writing; they're editable because providers move them.
 */
export const PRESETS: { label: string; kind: ConnectionKind; base_url: string; note?: string }[] = [
  { label: "Anthropic", kind: "anthropic", base_url: "" },
  { label: "Google Gemini", kind: "google", base_url: "" },
  { label: "OpenAI", kind: "openai_compatible", base_url: "https://api.openai.com/v1" },
  { label: "xAI (Grok)", kind: "openai_compatible", base_url: "https://api.x.ai/v1" },
  { label: "Mistral", kind: "openai_compatible", base_url: "https://api.mistral.ai/v1" },
  { label: "Alibaba Cloud (Qwen, international)", kind: "openai_compatible", base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1" },
  { label: "Moonshot AI (Kimi)", kind: "openai_compatible", base_url: "https://api.moonshot.ai/v1" },
  { label: "Zhipu / Z.ai (GLM)", kind: "openai_compatible", base_url: "https://api.z.ai/api/paas/v4" },
  { label: "DeepSeek", kind: "openai_compatible", base_url: "https://api.deepseek.com/v1" },
  { label: "ByteDance (BytePlus ModelArk)", kind: "openai_compatible", base_url: "https://ark.ap-southeast.bytepluses.com/api/v3" },
  { label: "Baidu Qianfan (ERNIE)", kind: "openai_compatible", base_url: "https://qianfan.baidubce.com/v2" },
  { label: "Cohere (compatibility API)", kind: "openai_compatible", base_url: "https://api.cohere.ai/compatibility/v1" },
  { label: "OpenRouter (Amazon Nova, Meta and others)", kind: "openai_compatible", base_url: "https://openrouter.ai/api/v1" },
  {
    label: "Self-hosted GPU server (vLLM / SGLang / Ollama)",
    kind: "openai_compatible",
    base_url: "https://YOUR-SERVER/v1",
    note: "For the open-weight models: serve them with an OpenAI-compatible server and paste its URL.",
  },
];

const fail = (error: string) => ({ ok: false as const, error });

export async function listConnections(): Promise<Connection[]> {
  return sql<Connection[]>`
    select c.id, c.name, c.kind, c.base_url, c.key_hint, c.api_key_enc is not null as has_key, c.active,
      (select count(*)::int from models m where m.connection_id = c.id) as models
    from api_connections c order by c.name`;
}

function checkUrl(kind: ConnectionKind, url: string): string | null {
  if (kind !== "openai_compatible") return null;
  if (!url) return "An OpenAI-compatible connection needs its base URL.";
  try {
    const parsed = new URL(url);
    const local = ["localhost", "127.0.0.1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !(local && process.env.NODE_ENV !== "production")) return "Use an https:// URL.";
  } catch {
    return "That isn't a valid URL.";
  }
  return null;
}

export async function saveConnection(
  adminId: string,
  input: { id?: number; name: string; kind: string; base_url: string; api_key: string; active: boolean; clear_key?: boolean },
) {
  const name = input.name.trim();
  if (!name) return fail("Name the connection.");
  if (!["anthropic", "google", "openai_compatible"].includes(input.kind)) return fail("Pick the API type.");
  const kind = input.kind as ConnectionKind;
  const baseUrl = input.base_url.trim().replace(/\/+$/, "") || null;
  const urlError = checkUrl(kind, baseUrl ?? "");
  if (urlError) return fail(urlError);
  const apiKey = input.api_key.trim();
  if (apiKey && !encryptionConfigured()) return fail("Set ENCRYPTION_KEY on the server before storing API keys.");
  const [clash] = await sql`select 1 from api_connections where lower(name) = lower(${name}) and id <> ${input.id ?? 0}`;
  if (clash) return fail("Another connection has that name.");

  const enc = apiKey ? encryptSecret(apiKey) : null;
  const hint = apiKey ? apiKey.slice(-4) : null;
  if (input.id) {
    await sql`update api_connections set name = ${name}, kind = ${kind}, base_url = ${baseUrl}, active = ${input.active},
              api_key_enc = case when ${input.clear_key ?? false} then null when ${enc}::text is not null then ${enc} else api_key_enc end,
              key_hint = case when ${input.clear_key ?? false} then null when ${hint}::text is not null then ${hint} else key_hint end,
              updated_at = now() where id = ${input.id}`;
  } else {
    await sql`insert into api_connections (name, kind, base_url, api_key_enc, key_hint, active)
              values (${name}, ${kind}, ${baseUrl}, ${enc}, ${hint}, ${input.active})`;
  }
  await audit(adminId, input.id ? "connection.update" : "connection.create", input.id ?? name, {
    name, kind, base_url: baseUrl, key_changed: Boolean(apiKey), key_cleared: Boolean(input.clear_key),
  });
  return { ok: true as const };
}

export async function deleteConnection(adminId: string, id: number) {
  await sql`delete from api_connections where id = ${id}`;
  await audit(adminId, "connection.delete", id);
  return { ok: true as const };
}

export interface ResolvedConnection {
  kind: ConnectionKind;
  baseUrl: string | null;
  apiKey: string;
}

/** The connection with its key decrypted, for one outgoing request. Server only. */
export async function resolveConnection(id: number): Promise<ResolvedConnection | null> {
  const [row] = await sql<{ kind: ConnectionKind; base_url: string | null; api_key_enc: string | null; active: boolean }[]>`
    select kind, base_url, api_key_enc, active from api_connections where id = ${id}`;
  if (!row || !row.active) return null;
  const apiKey = row.api_key_enc ? decryptSecret(row.api_key_enc) : "";
  // Self-hosted servers often run without a key; hosted providers never do.
  if (!apiKey && row.kind !== "openai_compatible") return null;
  return { kind: row.kind, baseUrl: row.base_url, apiKey };
}

/** Checks the key works and lists the model IDs the account can use. Free on every provider listed. */
export async function listRemoteModels(id: number): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  try {
    const c = await resolveConnection(id);
    if (!c) return fail("The connection is switched off or has no key.");
    if (c.kind === "anthropic") {
      const client = new Anthropic({ apiKey: c.apiKey, ...(c.baseUrl ? { baseURL: c.baseUrl } : {}) });
      const ids: string[] = [];
      for await (const model of client.models.list()) ids.push(model.id);
      return { ok: true, ids };
    }
    if (c.kind === "google") {
      const response = await fetch(`${c.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta"}/models?pageSize=1000`, {
        headers: { "x-goog-api-key": c.apiKey },
      });
      const body = await response.json();
      if (!response.ok) return fail(body?.error?.message ?? `HTTP ${response.status}`);
      return { ok: true, ids: (body.models ?? []).map((m: { name: string }) => m.name.replace(/^models\//, "")) };
    }
    const response = await fetch(`${c.baseUrl}/models`, {
      headers: c.apiKey ? { Authorization: `Bearer ${c.apiKey}` } : {},
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) return fail(body?.error?.message ?? `HTTP ${response.status}`);
    return { ok: true, ids: (body.data ?? []).map((m: { id: string }) => m.id) };
  } catch (error) {
    return fail(error instanceof Error ? error.message.slice(0, 300) : "Request failed");
  }
}
