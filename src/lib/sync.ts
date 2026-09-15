import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  BUNDLE_VERSION,
  exportQuestions,
  exportResponses,
  importQuestions,
  importResponses,
  parseBundle,
} from "./bundle";
import { getDb } from "./db";
import {
  QUESTION_PREFIX,
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
 * Questions go one per file under `q/`, keyed by the question's own uid, so
 * adding a question costs one small upload instead of rewriting a bundle that
 * carries every image ever added. Answers stay in a single per-install file —
 * they hold no images and are tiny.
 *
 * Imports are keyed by uid and idempotent, so both sides converge whatever
 * order the files arrive in.
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
  pulled: {
    questions: number;
    /** Questions already here that the other copy had edited more recently. */
    updated: number;
    answers: number;
    /** Grades that arrived for answers this copy had not graded. */
    grades: number;
    comments: number;
    runs: number;
    models: number;
  };
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

/**
 * One sync at a time. A tab polls every 30 seconds and every save pushes, so
 * two runs overlap easily — and since each reads the bookkeeping of what it has
 * already seen at the start and writes it back at the end, the slower one used
 * to overwrite the other's record, leaving files marked as read that were never
 * applied. Callers that arrive mid-run wait for the one in flight instead.
 */
let inFlight: Promise<SyncResult> | null = null;

export async function syncNow(): Promise<SyncResult> {
  if (inFlight) return inFlight;
  inFlight = runSync().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runSync(): Promise<SyncResult> {
  const config = getSyncConfig();
  if (config.mode === "off") throw new SyncError("Sync is turned off.");

  const remote = remoteFor(config);
  const pulled = { questions: 0, updated: 0, answers: 0, grades: 0, comments: 0, runs: 0, models: 0 };
  let filesSeen = 0;

  const mine = new Set([
    `questions-${config.installId}.json`,
    `answers-${config.installId}.json`,
  ]);

  // Remember each remote file's version so an unchanged one is never
  // re-downloaded — the questions bundle carries every image.
  const seen = JSON.parse(setting("sync_seen") ?? "{}") as Record<string, string>;

  // What we last published for each question. Loaded before the pull, because
  // importing a question tells us its file is already up to date.
  const hashes = JSON.parse(setting("sync_hash_q") ?? "{}") as Record<string, string>;

  // Questions must land before the answers and model runs that reference them,
  // or a first sync drops them all as unmatched.
  const files = (await remote.list()).sort((a, b) => {
    const rank = (name: string) => (name.startsWith("answers-") ? 1 : 0);
    return rank(a.name) - rank(b.name);
  });

  // Our own files, so we can notice if one has been emptied or removed behind
  // our back — otherwise the stored hash would stop us ever republishing it.
  const ownRemote = new Map<string, number>();

  for (const file of files) {
    if (mine.has(file.name) || file.name.startsWith(QUESTION_PREFIX)) {
      ownRemote.set(file.name, file.size);
    }
    if (!file.name.endsWith(".json") || mine.has(file.name)) continue;

    const isQuestion = file.name.startsWith(QUESTION_PREFIX);
    // `questions-<id>.json` is the pre-split aggregate. Still read it, so an
    // install that hasn't updated yet doesn't go silent.
    const isLegacyAggregate = file.name.startsWith("questions-");
    const isAnswers = file.name.startsWith("answers-");
    if (!isQuestion && !isLegacyAggregate && !isAnswers) continue;

    filesSeen += 1;
    if (seen[file.name] === file.version) continue;

    let bundle;
    let raw;
    try {
      raw = await remote.get(file.name);
      bundle = parseBundle(raw);
    } catch {
      // Half-written or foreign file; try again on the next pass.
      continue;
    }

    if (bundle.kind === "questions") {
      const result = importQuestions(bundle);
      pulled.questions += result.added;
      pulled.updated += result.updated ?? 0;
      seen[file.name] = file.version;
      // We now hold exactly what that file holds, so there is nothing to send
      // back. If our copy was the newer one it was left alone, and the hash
      // below won't match — which is precisely when we should publish.
      //
      // Only for a question we actually hold. A file blanked because someone
      // deleted the question carries nothing to hold, and recording it as ours
      // would have the pass below blank it again on every sync, for good.
      if (isQuestion) {
        const uid = file.name.slice(QUESTION_PREFIX.length).replace(/\.json$/, "");
        const held = getDb().prepare("SELECT 1 FROM questions WHERE uid = ?").get(uid);
        if (held) hashes[uid] = fingerprint(raw);
        else delete hashes[uid];
      }
    } else {
      const result = importResponses(bundle);
      pulled.answers += result.added;
      pulled.grades += result.grades ?? 0;
      pulled.comments += result.comments ?? 0;
      pulled.runs += result.runs ?? 0;
      pulled.models += result.models ?? 0;
      // Rows referencing a question we haven't received yet must not mark the
      // file as read, or one bad pass would drop them for good.
      if (result.unmatched === 0) seen[file.name] = file.version;
    }
  }
  putSetting("sync_seen", JSON.stringify(seen));

  // Push ours, but only when the payload actually changed. Comparing against a
  // stored hash avoids downloading our own bundle just to diff it.
  const pushed: string[] = [];
  const db = getDb();

  /** A bundle carrying nothing is ~130 bytes of envelope and no payload. */
  const looksEmpty = (name: string) => (ownRemote.get(name) ?? 0) < 200;
  // Every question, including ones that arrived from the other copy: a
  // classification or a corrected prompt is an edit they should get back. The
  // file is keyed by the question's own uid, so this rewrites their file rather
  // than adding a copy of it, and the hash gate means an untouched question is
  // never uploaded twice.
  const localQuestions = db
    .prepare("SELECT id, uid FROM questions ORDER BY id")
    .all() as { id: number; uid: string }[];

  for (const question of localQuestions) {
    const name = `${QUESTION_PREFIX}${question.uid}.json`;
    const body = JSON.stringify(exportQuestions([question.id]), null, 2);
    const hash = fingerprint(body);
    // Republish if the remote copy has gone missing or been emptied.
    if (hashes[question.uid] === hash && !looksEmpty(name)) continue;
    await remote.put(name, body);
    hashes[question.uid] = hash;
    pushed.push(name);
  }

  // A question deleted here leaves its file behind; blank it so it stops
  // costing storage. (Imports only ever add, so this doesn't delete anyone's
  // copy of the question — it never did.)
  const liveUids = new Set(localQuestions.map((q) => q.uid));
  for (const uid of Object.keys(hashes)) {
    if (liveUids.has(uid)) continue;
    const name = `${QUESTION_PREFIX}${uid}.json`;
    await remote.put(
      name,
      JSON.stringify({
        format: "traffic-bench",
        version: BUNDLE_VERSION,
        kind: "questions",
        exported_at: new Date().toISOString(),
        questions: [],
      }),
    );
    delete hashes[uid];
    pushed.push(name);
  }
  putSetting("sync_hash_q", JSON.stringify(hashes));

  // Retire our own pre-split aggregate once every question has its own file.
  if (localQuestions.length > 0 && setting("sync_legacy_retired") !== "1") {
    await remote.put(
      `questions-${config.installId}.json`,
      JSON.stringify({
        format: "traffic-bench",
        version: BUNDLE_VERSION,
        kind: "questions",
        exported_at: new Date().toISOString(),
        questions: [],
      }),
    );
    putSetting("sync_legacy_retired", "1");
    pushed.push(`questions-${config.installId}.json`);
  }

  // Everything this copy holds travels, not only what it typed: an answer that
  // came in by hand-imported bundle, or a grade given to the other side's
  // answer, would otherwise exist here and nowhere else. Imports are keyed and
  // idempotent, so the copies converge instead of accumulating duplicates.
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  const haveSomethingToSay =
    count("SELECT COUNT(*) AS n FROM human_responses") > 0 ||
    count("SELECT COUNT(*) AS n FROM comments WHERE author_role = 'grounder'") > 0 ||
    count("SELECT COUNT(*) AS n FROM llm_runs") > 0 ||
    count("SELECT COUNT(*) AS n FROM models") > 0;
  if (haveSomethingToSay) {
    const name = `answers-${config.installId}.json`;
    const body = JSON.stringify(exportResponses({ includeSetterComments: false }), null, 2);
    const hash = fingerprint(body);
    if (setting("sync_hash_answers") !== hash || looksEmpty(name)) {
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
