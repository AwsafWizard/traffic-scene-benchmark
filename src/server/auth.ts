import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { sql } from "./db";
import { hashPassword, normalizeUsername, verifyPassword } from "./password";

/**
 * Our own login: usernames and passwords issued by the admin, sessions stored in
 * the database so revoking an account or resetting a password signs that person
 * out everywhere at once. There is no sign-up and no self-service password
 * change for annotators.
 */

export type Role = "admin" | "annotator";

export interface SessionUser {
  id: string;
  username: string;
  display_name: string;
  role: Role;
}

const COOKIE = "dvqa_session";
const SESSION_DAYS = 7;
const MAX_FAILURES = 5;
const LOCK_MINUTES = 15;

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function startSession(userId: string): Promise<void> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await sql`insert into sessions (id, user_id, expires_at) values (${hashToken(token)}, ${userId}, ${expires})`;
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires,
  });
}

/** The signed-in user, or null. Memoised for the duration of one request. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const [user] = await sql<SessionUser[]>`
    select u.id, u.username, u.display_name, u.role
    from sessions s join users u on u.id = s.user_id
    where s.id = ${hashToken(token)} and s.expires_at > now() and u.active`;
  return user ?? null;
});

/** For pages: send anyone not signed in to the login page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/");
  return user;
}

export async function requireAnnotator(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "annotator") redirect("/admin");
  return user;
}

/**
 * For server actions, which are reachable by direct POST: refuse instead of
 * redirecting, so a forged call fails loudly.
 */
export class AuthError extends Error {}

export async function actionUser(role?: Role): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new AuthError("Your session has ended. Sign in again.");
  if (role && user.role !== role) throw new AuthError("Not allowed.");
  return user;
}

// A real hash to compare against when the username doesn't exist, so a wrong
// username takes as long to reject as a wrong password.
let dummyHash: Promise<string> | null = null;

export type LoginResult = { ok: true; role: Role } | { ok: false; error: string };

export async function login(usernameInput: string, password: string): Promise<LoginResult> {
  const username = normalizeUsername(usernameInput);
  const [user] = await sql<
    { id: string; role: Role; password_hash: string; active: boolean; failed_logins: number; locked_until: Date | null }[]
  >`select id, role, password_hash, active, failed_logins, locked_until from users where username = ${username}`;

  if (!user) {
    dummyHash ??= hashPassword(crypto.randomBytes(16).toString("hex"));
    await verifyPassword(password, await dummyHash);
    return { ok: false, error: "Wrong username or password." };
  }
  if (user.locked_until && user.locked_until > new Date()) {
    const minutes = Math.ceil((user.locked_until.getTime() - Date.now()) / 60000);
    return { ok: false, error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` };
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid || !user.active) {
    if (!valid) {
      const failures = user.failed_logins + 1;
      if (failures >= MAX_FAILURES) {
        await sql`update users set failed_logins = 0,
                  locked_until = now() + make_interval(mins => ${LOCK_MINUTES}) where id = ${user.id}`;
      } else {
        await sql`update users set failed_logins = ${failures} where id = ${user.id}`;
      }
    }
    // A revoked account gets the same answer as a wrong password.
    return { ok: false, error: "Wrong username or password." };
  }

  await sql`update users set failed_logins = 0, locked_until = null, last_login_at = now() where id = ${user.id}`;
  await sql`delete from sessions where expires_at < now()`;
  await startSession(user.id);
  return { ok: true, role: user.role };
}

export async function logout(): Promise<void> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (token) await sql`delete from sessions where id = ${hashToken(token)}`;
  store.delete(COOKIE);
}

/** Ends every session a user has, e.g. after revoking them or resetting their password. */
export async function endAllSessions(userId: string): Promise<void> {
  await sql`delete from sessions where user_id = ${userId}`;
}

/** Ends every session but the one making this request. */
export async function endOtherSessions(userId: string): Promise<void> {
  const token = (await cookies()).get(COOKIE)?.value;
  await sql`delete from sessions where user_id = ${userId} and id <> ${token ? hashToken(token) : ""}`;
}
