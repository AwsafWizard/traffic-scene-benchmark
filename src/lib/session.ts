import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "./db";
import type { Role } from "./types";

export const ROLE_COOKIE = "bench-role";

/**
 * The role cookie only ever *removes* access, so it does not need to be
 * tamper-proof: clearing it lands you back on the benchmarker view, which is
 * the default. It exists to stop the grounder from stumbling onto reference
 * answers, not to defend against someone determined to look.
 */
export async function getRole(): Promise<Role> {
  const store = await cookies();
  return store.get(ROLE_COOKIE)?.value === "grounder" ? "grounder" : "benchmarker";
}

/** For pages: send grounders back to their queue instead of showing answers. */
export async function requireBenchmarkerPage(): Promise<void> {
  if ((await getRole()) === "grounder") redirect("/ground");
}

/** For route handlers: refuse rather than redirect. */
export async function isGrounder(): Promise<boolean> {
  return (await getRole()) === "grounder";
}

export function getShareToken(): string {
  const db = getDb();
  const row = db.prepare("SELECT value FROM settings WHERE key = 'share_token'").get() as
    | { value: string }
    | undefined;
  if (row) return row.value;

  const token = crypto.randomBytes(16).toString("hex");
  db.prepare("INSERT INTO settings (key, value) VALUES ('share_token', ?)").run(token);
  return token;
}

export function rotateShareToken(): string {
  const token = crypto.randomBytes(16).toString("hex");
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES ('share_token', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(token);
  return token;
}
