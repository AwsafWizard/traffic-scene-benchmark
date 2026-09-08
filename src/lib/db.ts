import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export function uploadPath(name: string): string {
  const dir = path.join(process.cwd(), "data", "uploads");
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, name);
}

const globalForDb = globalThis as unknown as { __benchDb?: Database.Database };

function init(): Database.Database {
  const dir = path.join(process.cwd(), "data");
  fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });

  const db = new Database(path.join(dir, "bench.db"), { timeout: 5000 });
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      -- Stable across machines, so exported answers can be matched back to the
      -- right question on a different install.
      uid TEXT UNIQUE,
      image_path TEXT NOT NULL,
      prompt TEXT NOT NULL,
      category TEXT NOT NULL,
      answer_type TEXT NOT NULL,
      options TEXT,
      reference_answer TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS human_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      grounder_name TEXT NOT NULL,
      answer TEXT NOT NULL,
      confidence INTEGER,
      rationale TEXT,
      duration_ms INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      provider TEXT NOT NULL,
      model_id TEXT NOT NULL,
      extra TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS llm_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      model_key TEXT NOT NULL,
      answer TEXT,
      reasoning TEXT,
      raw TEXT,
      latency_ms INTEGER,
      error TEXT,
      source TEXT NOT NULL DEFAULT 'api',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- Follow-up conversation on top of a model's first answer. Turn order is by id.
    CREATE TABLE IF NOT EXISTS run_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL REFERENCES llm_runs(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      latency_ms INTEGER,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_turns_run ON run_turns(run_id);

    -- Notes either side leaves on a question: the setter's working notes, and the
    -- grounder flagging that a question is unclear or unanswerable.
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uid TEXT UNIQUE,
      question_id INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
      author_role TEXT NOT NULL,
      author_name TEXT,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_comments_question ON comments(question_id);

    CREATE TABLE IF NOT EXISTS grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      target_type TEXT NOT NULL,
      target_id INTEGER NOT NULL,
      verdict TEXT NOT NULL,
      grader TEXT NOT NULL DEFAULT 'setter',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (target_type, target_id)
    );

    CREATE INDEX IF NOT EXISTS idx_runs_question ON llm_runs(question_id);
    CREATE INDEX IF NOT EXISTS idx_human_question ON human_responses(question_id);
  `);

  // Databases created before manual answers existed are missing this column.
  const runColumns = db.prepare("PRAGMA table_info(llm_runs)").all() as { name: string }[];
  if (!runColumns.some((c) => c.name === "source")) {
    db.exec("ALTER TABLE llm_runs ADD COLUMN source TEXT NOT NULL DEFAULT 'api'");
  }

  // Likewise for question uids, which arrived with export/import.
  const questionColumns = db.prepare("PRAGMA table_info(questions)").all() as { name: string }[];
  if (!questionColumns.some((c) => c.name === "uid")) {
    db.exec("ALTER TABLE questions ADD COLUMN uid TEXT");
    db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_questions_uid ON questions(uid)");
  }
  const backfill = db.prepare("UPDATE questions SET uid = ? WHERE id = ?");
  for (const row of db.prepare("SELECT id FROM questions WHERE uid IS NULL").all() as {
    id: number;
  }[]) {
    backfill.run(crypto.randomUUID(), row.id);
  }

  const count = db.prepare("SELECT COUNT(*) AS n FROM models").get() as { n: number };
  if (count.n === 0) {
    const insert = db.prepare(
      "INSERT INTO models (key, label, provider, model_id) VALUES (?, ?, ?, ?)",
    );
    insert.run("claude-opus-5", "Claude Opus 5", "anthropic", "claude-opus-5");
    insert.run("claude-sonnet-5", "Claude Sonnet 5", "anthropic", "claude-sonnet-5");
  }

  return db;
}

export function getDb(): Database.Database {
  if (!globalForDb.__benchDb) globalForDb.__benchDb = init();
  return globalForDb.__benchDb;
}
