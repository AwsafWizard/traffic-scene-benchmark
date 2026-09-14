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
  size: number;
}

export class RemoteError extends Error {}

/** Questions live one-per-file under this prefix; see sync.ts. */
export const QUESTION_PREFIX = "q/";

export function folderRemote(dir: string): Remote {
  return {
    label: dir,
    async list() {
      if (!fs.existsSync(dir)) {
        throw new RemoteError(
          `The sync folder has gone missing: ${dir}. If it's a Drive folder, check the sync client is running.`,
        );
      }
      const entries: RemoteFile[] = [];
      const scan = (sub: string) => {
        const full = path.join(dir, sub);
        if (!fs.existsSync(full)) return;
        for (const name of fs.readdirSync(full)) {
          const stat = fs.statSync(path.join(full, name));
          if (stat.isDirectory()) continue;
          entries.push({
            name: sub + name,
            version: `${stat.mtimeMs}:${stat.size}`,
            size: stat.size,
          });
        }
      };
      scan("");
      scan(QUESTION_PREFIX);
      return entries;
    },
    async get(name) {
      return fs.readFileSync(path.join(dir, name), "utf8");
    },
    async put(name, contents) {
      const target = path.join(dir, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, contents);
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

/** Encodes each path segment but keeps the separators. */
function encodePath(name: string): string {
  return name.split("/").map(encodeURIComponent).join("/");
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
      // Supabase lists one prefix at a time and reports subfolders as entries
      // with a null id, so the questions prefix needs its own call.
      const page = async (prefix: string): Promise<RemoteFile[]> => {
        const out: RemoteFile[] = [];
        for (let offset = 0; ; offset += 1000) {
          const response = await fetch(`${url}/storage/v1/object/list/${bucket}`, {
            method: "POST",
            headers: { ...headers, "Content-Type": "application/json" },
            body: JSON.stringify({ prefix, limit: 1000, offset }),
          });
          await check(response, "list");
          const rows = (await response.json()) as {
            id: string | null;
            name: string;
            updated_at?: string;
            metadata?: { size?: number };
          }[];
          for (const row of rows) {
            if (row.id === null) continue; // a folder, not an object
            out.push({
              name: prefix + row.name,
              version: `${row.updated_at ?? ""}:${row.metadata?.size ?? ""}`,
              size: row.metadata?.size ?? 0,
            });
          }
          if (rows.length < 1000) return out;
        }
      };
      return [...(await page("")), ...(await page(QUESTION_PREFIX))];
    },
    async get(name) {
      const response = await fetch(
        `${url}/storage/v1/object/${bucket}/${encodePath(name)}`,
        { headers },
      );
      await check(response, "download");
      return response.text();
    },
    async put(name, contents) {
      const response = await fetch(
        `${url}/storage/v1/object/${bucket}/${encodePath(name)}`,
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
