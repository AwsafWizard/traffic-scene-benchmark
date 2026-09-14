import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  exportQuestions,
  exportResponses,
  importQuestions,
  importResponses,
  parseBundle,
} from "./bundle";
import { getDb } from "./db";
import {
  RemoteError,
  folderRemote,
  supabaseRemote,
  supabaseSettingsFromEnv,
  type Remote,
} from "./remote";

/**
 * Two installs stay in step by trading bundle files through a shared place —
 * a Supabase bucket, or a folder something else mirrors across machines.
 *
 * Each install owns two files named after its own id and never writes anyone
 * else's. Because imports are keyed by uid and idempotent, both sides converge
 * whatever order the files arrive in.
 */

export type SyncMode = "off" | "folder" | "supabase";

export interface SyncConfig {
  mode: SyncMode;
  dir: string | null;
  installId: string;
  lastSync: string | null;
  lastError: string | null;
  /** Whether SUPABASE_URL / SUPABASE_ANON_KEY are present in the environment. */
  supabaseConfigured: boolean;
  supabaseBucket: string | null;
}

function setting(key: string): string | null {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function putSetting(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, value);
}

export function getInstallId(): string {
  const existing = setting("install_id");
  if (existing) return existing;
  const id = crypto.randomBytes(4).toString("hex");
  putSetting("install_id", id);
  return id;
}

export function getSyncConfig(): SyncConfig {
  const supabase = supabaseSettingsFromEnv();
  const stored = setting("sync_mode");
  // Older installs stored a boolean for folder sync.
  const mode: SyncMode =
    stored === "folder" || stored === "supabase"
      ? stored
      : setting("sync_enabled") === "1"
        ? "folder"
        : "off";

  return {
    mode,
    dir: setting("sync_dir"),
    installId: getInstallId(),
    lastSync: setting("sync_last"),
    lastError: setting("sync_error") || null,
    supabaseConfigured: supabase !== null,
    supabaseBucket: supabase?.bucket ?? null,
  };
}

export class SyncError extends Error {}

export function setSyncConfig(mode: SyncMode, dir: string | null): SyncConfig {
  if (mode === "folder") {
    if (!dir?.trim()) throw new SyncError("Choose a folder first.");
    const resolved = path.resolve(dir.trim());
    if (!fs.existsSync(resolved)) throw new SyncError(`That folder doesn't exist: ${resolved}`);
    if (!fs.statSync(resolved).isDirectory()) {
      throw new SyncError("That path is a file, not a folder.");
    }
    putSetting("sync_dir", resolved);
  }

  if (mode === "supabase" && !supabaseSettingsFromEnv()) {
    throw new SyncError(
      "SUPABASE_URL and SUPABASE_ANON_KEY aren't set. Add them to .env.local and restart the dev server.",
    );
  }

  putSetting("sync_mode", mode);
  putSetting("sync_enabled", mode === "folder" ? "1" : "0");
  putSetting("sync_error", "");
  return getSyncConfig();
}

function remoteFor(config: SyncConfig): Remote {
  if (config.mode === "supabase") {
    const settings = supabaseSettingsFromEnv();
    if (!settings) throw new SyncError("Supabase isn't configured.");
    return supabaseRemote(settings);
  }
  if (!config.dir) throw new SyncError("No sync folder set.");
  return folderRemote(config.dir);
}

export interface SyncResult {
  pulled: { questions: number; answers: number; comments: number };
  pushed: string[];
  filesSeen: number;
  where: string;
}

/** Payload identity, ignoring the timestamp that moves on every export. */
function fingerprint(json: string): string {
  const parsed = JSON.parse(json) as Record<string, unknown>;
  delete parsed.exported_at;
  return crypto.createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
}

export async function syncNow(): Promise<SyncResult> {
  const config = getSyncConfig();
  if (config.mode === "off") throw new SyncError("Sync is turned off.");

  const remote = remoteFor(config);
  const pulled = { questions: 0, answers: 0, comments: 0 };
  let filesSeen = 0;

  const mine = new Set([
    `questions-${config.installId}.json`,
    `answers-${config.installId}.json`,
  ]);

  // Remember each remote file's version so an unchanged one is never
  // re-downloaded — the questions bundle carries every image.
  const seen = JSON.parse(setting("sync_seen") ?? "{}") as Record<string, string>;

  for (const file of await remote.list()) {
    if (!file.name.endsWith(".json") || mine.has(file.name)) continue;
    if (!file.name.startsWith("questions-") && !file.name.startsWith("answers-")) continue;

    filesSeen += 1;
    if (seen[file.name] === file.version) continue;

    let bundle;
    try {
      bundle = parseBundle(await remote.get(file.name));
    } catch {
      // Half-written or foreign file; try again on the next pass.
      continue;
    }

    if (bundle.kind === "questions") {
      pulled.questions += importQuestions(bundle).added;
    } else {
      const result = importResponses(bundle);
      pulled.answers += result.added;
      pulled.comments += result.comments ?? 0;
    }
    seen[file.name] = file.version;
  }
  putSetting("sync_seen", JSON.stringify(seen));

  // Push ours, but only when the payload actually changed. Comparing against a
  // stored hash avoids downloading our own bundle just to diff it.
  const pushed: string[] = [];
  const db = getDb();

  const localQuestions = (
    db.prepare("SELECT COUNT(*) AS n FROM questions WHERE imported = 0").get() as { n: number }
  ).n;
  if (localQuestions > 0) {
    const name = `questions-${config.installId}.json`;
    const body = JSON.stringify(exportQuestions(undefined, { localOnly: true }), null, 2);
    const hash = fingerprint(body);
    if (setting("sync_hash_questions") !== hash) {
      await remote.put(name, body);
      putSetting("sync_hash_questions", hash);
      pushed.push(name);
    }
  }

  const localAnswers = (
    db.prepare("SELECT COUNT(*) AS n FROM human_responses WHERE imported = 0").get() as {
      n: number;
    }
  ).n;
  const localComments = (
    db
      .prepare("SELECT COUNT(*) AS n FROM comments WHERE author_role = 'grounder' AND imported = 0")
      .get() as { n: number }
  ).n;
  if (localAnswers > 0 || localComments > 0) {
    const name = `answers-${config.installId}.json`;
    const body = JSON.stringify(
      exportResponses({ includeSetterComments: false, localOnly: true }),
      null,
      2,
    );
    const hash = fingerprint(body);
    if (setting("sync_hash_answers") !== hash) {
      await remote.put(name, body);
      putSetting("sync_hash_answers", hash);
      pushed.push(name);
    }
  }

  putSetting("sync_last", new Date().toISOString());
  putSetting("sync_error", "");

  return { pulled, pushed, filesSeen, where: remote.label };
}

/**
 * Fire-and-forget sync for use inside mutations. A sync failure must never cost
 * someone the answer they just submitted, so it is recorded and swallowed.
 */
export async function syncInBackground(): Promise<void> {
  if (getSyncConfig().mode === "off") return;
  try {
    await syncNow();
  } catch (error) {
    const message =
      error instanceof RemoteError || error instanceof SyncError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    putSetting("sync_error", message);
  }
}
