import fs from "node:fs";
import path from "node:path";

/**
 * Where sync bundles live. A local directory (kept in step by Drive for
 * Desktop, Dropbox, Syncthing) or a Supabase Storage bucket, which needs
 * nothing installed and works while the other machine is asleep.
 */
export interface Remote {
  readonly label: string;
  list(): Promise<RemoteFile[]>;
  get(name: string): Promise<string>;
  put(name: string, contents: string): Promise<void>;
}

export interface RemoteFile {
  name: string;
  /** Changes when the file does, so we can skip re-downloading it. */
  version: string;
}

export class RemoteError extends Error {}

export function folderRemote(dir: string): Remote {
  return {
    label: dir,
    async list() {
      if (!fs.existsSync(dir)) {
        throw new RemoteError(
          `The sync folder has gone missing: ${dir}. If it's a Drive folder, check the sync client is running.`,
        );
      }
      return fs.readdirSync(dir).map((name) => {
        const stat = fs.statSync(path.join(dir, name));
        return { name, version: `${stat.mtimeMs}:${stat.size}` };
      });
    },
    async get(name) {
      return fs.readFileSync(path.join(dir, name), "utf8");
    },
    async put(name, contents) {
      fs.writeFileSync(path.join(dir, name), contents);
    },
  };
}

export interface SupabaseSettings {
  url: string;
  anonKey: string;
  bucket: string;
}

export function supabaseSettingsFromEnv(): SupabaseSettings | null {
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey = process.env.SUPABASE_ANON_KEY?.trim();
  if (!url || !anonKey) return null;
  return {
    url: url.replace(/\/+$/, ""),
    anonKey,
    bucket: process.env.SUPABASE_BUCKET?.trim() || "traffic-bench",
  };
}

export function supabaseRemote({ url, anonKey, bucket }: SupabaseSettings): Remote {
  const headers = { apikey: anonKey, Authorization: `Bearer ${anonKey}` };

  async function check(response: Response, what: string): Promise<void> {
    if (response.ok) return;
    const body = await response.text().catch(() => "");
    if (response.status === 400 && body.includes("Bucket not found")) {
      throw new RemoteError(
        `Bucket "${bucket}" doesn't exist in your Supabase project. Create it (Storage → New bucket) and try again.`,
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new RemoteError(
        `Supabase rejected the request (${response.status}). Check the anon key, and that the bucket's policies allow read and write.`,
      );
    }
    throw new RemoteError(`Supabase ${what} failed (${response.status}). ${body.slice(0, 160)}`);
  }

  return {
    label: `Supabase bucket "${bucket}"`,
    async list() {
      const response = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: "", limit: 200, offset: 0 }),
      });
      await check(response, "list");
      const rows = (await response.json()) as {
        name: string;
        updated_at?: string;
        metadata?: { size?: number };
      }[];
      return rows.map((row) => ({
        name: row.name,
        version: `${row.updated_at ?? ""}:${row.metadata?.size ?? ""}`,
      }));
    },
    async get(name) {
      const response = await fetch(
        `${url}/storage/v1/object/${bucket}/${encodeURIComponent(name)}`,
        { headers },
      );
      await check(response, "download");
      return response.text();
    },
    async put(name, contents) {
      const response = await fetch(
        `${url}/storage/v1/object/${bucket}/${encodeURIComponent(name)}`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json", "x-upsert": "true" },
          body: contents,
        },
      );
      await check(response, "upload");
    },
  };
}
