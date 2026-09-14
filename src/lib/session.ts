import { redirect } from "next/navigation";
import { getDb } from "./db";
import type { Role } from "./types";

/**
 * How this copy is used. "both" is the normal case: you write some questions
 * and ground the ones your partner wrote, and the app works that out per
 * question rather than making you flip a switch. "grounder" is for a machine
 * that should never see answers at all.
 */
export type InstallMode = "both" | "grounder";

export function getInstallMode(): InstallMode {
  const row = getDb().prepare("SELECT value FROM settings WHERE key = 'install_role'").get() as
    | { value: string }
    | undefined;
  return row?.value === "grounder" ? "grounder" : "both";
}

export function setInstallRole(role: Role): void {
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES ('install_role', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(role);
}

export function getInstallRole(): Role {
  return getInstallMode() === "grounder" ? "grounder" : "benchmarker";
}

export async function getRole(): Promise<Role> {
  return getInstallRole();
}

/** For pages: send grounders back to their queue instead of showing answers. */
export async function requireBenchmarkerPage(): Promise<void> {
  if ((await getRole()) === "grounder") redirect("/ground");
}

/** For route handlers: refuse rather than redirect. */
export async function isGrounder(): Promise<boolean> {
  return (await getRole()) === "grounder";
}
