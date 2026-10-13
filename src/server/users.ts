import "server-only";
import { audit } from "./audit";
import { endAllSessions, endOtherSessions } from "./auth";
import { sql } from "./db";
import {
  generatePassword,
  hashPassword,
  MIN_PASSWORD_LENGTH,
  normalizeUsername,
  USERNAME_PATTERN,
  verifyPassword,
} from "./password";

export interface Annotator {
  id: string;
  username: string;
  display_name: string;
  active: boolean;
  last_login_at: Date | null;
  created_at: Date;
}

export async function listAnnotators({ activeOnly = false } = {}): Promise<Annotator[]> {
  return sql<Annotator[]>`
    select id, username, display_name, active, last_login_at, created_at from users
    where role = 'annotator' and ${activeOnly ? sql`active` : sql`true`}
    order by active desc, display_name`;
}

export async function getAnnotator(id: string): Promise<Annotator | null> {
  const [row] = await sql<Annotator[]>`
    select id, username, display_name, active, last_login_at, created_at from users
    where id = ${id} and role = 'annotator'`;
  return row ?? null;
}

/** Creates an annotator and returns the generated password, which is never stored or shown again. */
export async function createAnnotator(
  adminId: string,
  usernameInput: string,
  displayName: string,
): Promise<{ ok: true; username: string; password: string } | { ok: false; error: string }> {
  const username = normalizeUsername(usernameInput);
  const name = displayName.trim();
  if (!USERNAME_PATTERN.test(username)) {
    return { ok: false, error: "Usernames are 3–32 characters: letters, digits, dot, dash or underscore." };
  }
  if (!name || name.length > 80) return { ok: false, error: "Give a display name (up to 80 characters)." };
  const [taken] = await sql`select 1 from users where username = ${username}`;
  if (taken) return { ok: false, error: `"${username}" is already taken.` };

  const password = generatePassword();
  const [row] = await sql<{ id: string }[]>`
    insert into users (username, display_name, role, password_hash)
    values (${username}, ${name}, 'annotator', ${await hashPassword(password)}) returning id`;
  await audit(adminId, "user.create", row.id, { username });
  return { ok: true, username, password };
}

export async function resetAnnotatorPassword(adminId: string, userId: string): Promise<string | null> {
  const user = await getAnnotator(userId);
  if (!user) return null;
  const password = generatePassword();
  await sql`update users set password_hash = ${await hashPassword(password)}, failed_logins = 0,
            locked_until = null, password_changed_at = now() where id = ${userId}`;
  await endAllSessions(userId);
  await audit(adminId, "user.reset_password", userId);
  return password;
}

export async function setAnnotatorActive(adminId: string, userId: string, active: boolean): Promise<void> {
  await sql`update users set active = ${active} where id = ${userId} and role = 'annotator'`;
  if (!active) await endAllSessions(userId);
  await audit(adminId, active ? "user.restore" : "user.revoke", userId);
}

export async function renameAnnotator(adminId: string, userId: string, displayName: string): Promise<string | null> {
  const name = displayName.trim();
  if (!name || name.length > 80) return "Give a display name (up to 80 characters).";
  await sql`update users set display_name = ${name} where id = ${userId} and role = 'annotator'`;
  await audit(adminId, "user.rename", userId, { display_name: name });
  return null;
}

/** The admin changing their own password. Every other session they have is ended. */
export async function changeAdminPassword(adminId: string, current: string, next: string): Promise<string | null> {
  const [admin] = await sql<{ password_hash: string }[]>`select password_hash from users where id = ${adminId}`;
  if (!admin || !(await verifyPassword(current, admin.password_hash))) return "Your current password is wrong.";
  if (next.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  await sql`update users set password_hash = ${await hashPassword(next)}, password_changed_at = now() where id = ${adminId}`;
  await endOtherSessions(adminId);
  await audit(adminId, "admin.change_password", adminId);
  return null;
}
