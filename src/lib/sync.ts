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

/**
 * Sync through a folder that something else keeps in step across machines —
 * Google Drive for Desktop, Dropbox, Syncthing. The app only ever reads and
 * writes local files, so there is no API to authorise on either machine.
 *
 * Each install owns two files named after its own id and never writes anyone
 * else's. Because bundle imports are keyed by uid and are idempotent, both
 * sides converge no matter what order the files arrive in.
 */

export interface SyncConfig {
  dir: string | null;
  enabled: boolean;
  installId: string;
  lastSync: string | null;
  lastError: string | null;
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
  return {
    dir: setting("sync_dir"),
    enabled: setting("sync_enabled") === "1",
    installId: getInstallId(),
    lastSync: setting("sync_last"),
    lastError: setting("sync_error"),
  };
}

export class SyncError extends Error {}

export function setSyncConfig(dir: string | null, enabled: boolean): SyncConfig {
  if (enabled) {
    if (!dir?.trim()) throw new SyncError("Choose a folder first.");
    const resolved = path.resolve(dir.trim());
    if (!fs.existsSync(resolved)) {
      throw new SyncError(`That folder doesn't exist: ${resolved}`);
    }
    if (!fs.statSync(resolved).isDirectory()) {
      throw new SyncError("That path is a file, not a folder.");
    }
    try {
      fs.accessSync(resolved, fs.constants.W_OK);
    } catch {
      throw new SyncError("That folder isn't writable.");
    }
    putSetting("sync_dir", resolved);
  } else if (dir?.trim()) {
    putSetting("sync_dir", path.resolve(dir.trim()));
  }

  putSetting("sync_enabled", enabled ? "1" : "0");
  putSetting("sync_error", "");
  return getSyncConfig();
}

export interface SyncResult {
  pulled: { questions: number; answers: number; comments: number };
  pushed: string[];
  filesSeen: number;
}

/**
 * Writes a file only when the payload actually changed.
 *
 * `exported_at` moves on every export, so a naive comparison would rewrite the
 * questions bundle — images and all — on every tick, and Drive would re-upload
 * megabytes every time. Comparing everything *except* that timestamp keeps an
 * idle pair of installs completely quiet.
 */
function writeIfChanged(file: string, contents: string): boolean {
  const withoutTimestamp = (text: string) => {
    const parsed = JSON.parse(text) as Record<string, unknown>;
    delete parsed.exported_at;
    return JSON.stringify(parsed);
  };

  try {
    if (
      fs.existsSync(file) &&
      withoutTimestamp(fs.readFileSync(file, "utf8")) === withoutTimestamp(contents)
    ) {
      return false;
    }
  } catch {
    // Unreadable or unparseable means we should just rewrite it.
  }
  fs.writeFileSync(file, contents);
  return true;
}

export function syncNow(): SyncResult {
  const config = getSyncConfig();
  if (!config.enabled || !config.dir) {
    throw new SyncError("Folder sync is turned off.");
  }
  if (!fs.existsSync(config.dir)) {
    throw new SyncError(
      `The sync folder has gone missing: ${config.dir}. If it's a Drive folder, check Drive for Desktop is running.`,
    );
  }

  const pulled = { questions: 0, answers: 0, comments: 0 };
  let filesSeen = 0;

  // Pull first, so anything we then push already reflects what arrived.
  const mine = new Set([
    `questions-${config.installId}.json`,
    `answers-${config.installId}.json`,
  ]);

  for (const name of fs.readdirSync(config.dir)) {
    if (!name.endsWith(".json") || mine.has(name)) continue;
    if (!name.startsWith("questions-") && !name.startsWith("answers-")) continue;

    filesSeen += 1;
    const full = path.join(config.dir, name);
    let bundle;
    try {
      bundle = parseBundle(fs.readFileSync(full, "utf8"));
    } catch {
      // A partially-synced or foreign file shouldn't stop the whole run.
      continue;
    }

    if (bundle.kind === "questions") {
      pulled.questions += importQuestions(bundle).added;
    } else {
      const result = importResponses(bundle);
      pulled.answers += result.added;
      pulled.comments += result.comments ?? 0;
    }
  }

  const pushed: string[] = [];
  const db = getDb();

  const localQuestions = (
    db.prepare("SELECT COUNT(*) AS n FROM questions WHERE imported = 0").get() as { n: number }
  ).n;
  if (localQuestions > 0) {
    const file = path.join(config.dir, `questions-${config.installId}.json`);
    const body = JSON.stringify(exportQuestions(undefined, { localOnly: true }), null, 2);
    if (writeIfChanged(file, body)) pushed.push(path.basename(file));
  }

  const answers = (
    db.prepare("SELECT COUNT(*) AS n FROM human_responses WHERE imported = 0").get() as {
      n: number;
    }
  ).n;
  const grounderComments = (
    db.prepare(
      "SELECT COUNT(*) AS n FROM comments WHERE author_role = 'grounder' AND imported = 0",
    ).get() as {
      n: number;
    }
  ).n;
  if (answers > 0 || grounderComments > 0) {
    const file = path.join(config.dir, `answers-${config.installId}.json`);
    const body = JSON.stringify(
      exportResponses({ includeSetterComments: false, localOnly: true }),
      null,
      2,
    );
    if (writeIfChanged(file, body)) pushed.push(path.basename(file));
  }

  putSetting("sync_last", new Date().toISOString());
  putSetting("sync_error", "");

  return { pulled, pushed, filesSeen };
}

/**
 * Fire-and-forget sync for use inside mutations. A sync failure must never
 * cost someone the answer they just submitted, so it is recorded and swallowed.
 */
export function syncInBackground(): void {
  const config = getSyncConfig();
  if (!config.enabled || !config.dir) return;
  try {
    syncNow();
  } catch (error) {
    putSetting("sync_error", error instanceof Error ? error.message : String(error));
  }
}
