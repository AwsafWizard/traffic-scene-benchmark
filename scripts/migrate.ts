/**
 * Applies db/migrations/*.sql in order, each once, then makes sure the admin
 * account exists.
 *
 *   npm run db:migrate                 apply pending migrations
 *   npm run db:migrate -- --reset-admin   also set the admin password from env
 *
 * Runs on every Vercel build (see "build" in package.json), so deploying is
 * enough to bring the database up to date.
 *
 * Admin account: on an empty database it is created from ADMIN_USERNAME and
 * ADMIN_PASSWORD. Later deploys leave it alone, unless --reset-admin is passed
 * (the recovery path if the admin password is ever lost).
 */
import fs from "node:fs";
import path from "node:path";
import postgres from "postgres";
import { hashPassword, MIN_PASSWORD_LENGTH, normalizeUsername, USERNAME_PATTERN } from "../src/server/password";

// Locally the values live in .env.local; on Vercel they're already in the environment.
if (fs.existsSync(".env.local") && !process.env.VERCEL) process.loadEnvFile(".env.local");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });

async function migrate() {
  await sql`create table if not exists schema_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;
  const applied = new Set((await sql<{ name: string }[]>`select name from schema_migrations`).map((r) => r.name));
  const dir = path.join(process.cwd(), "db", "migrations");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const text = fs.readFileSync(path.join(dir, file), "utf8");
    await sql.begin(async (tx) => {
      await tx.unsafe(text);
      await tx`insert into schema_migrations (name) values (${file})`;
    });
    console.log(`applied ${file}`);
  }

  // Every table, including ones added by later migrations, stays closed to
  // Supabase's public API.
  await sql.unsafe(`
    do $$
    declare t text;
    begin
      for t in select tablename from pg_tables where schemaname = 'public' loop
        execute format('alter table public.%I enable row level security', t);
      end loop;
      if exists (select 1 from pg_roles where rolname = 'anon') then
        execute 'revoke all on all tables in schema public from anon, authenticated';
        execute 'revoke all on all sequences in schema public from anon, authenticated';
        execute 'revoke all on all functions in schema public from anon, authenticated';
      end if;
    end $$;
  `);
}

async function ensureAdmin(reset: boolean) {
  const [existing] = await sql<{ id: string }[]>`select id from users where role = 'admin'`;
  if (existing && !reset) return;

  const username = normalizeUsername(process.env.ADMIN_USERNAME ?? "");
  const password = process.env.ADMIN_PASSWORD ?? "";
  if (!username || !password) {
    if (!existing) console.warn("No admin account yet: set ADMIN_USERNAME and ADMIN_PASSWORD and run again.");
    else console.error("--reset-admin needs ADMIN_USERNAME and ADMIN_PASSWORD.");
    return;
  }
  if (!USERNAME_PATTERN.test(username)) throw new Error("ADMIN_USERNAME: 3–32 of a-z 0-9 . _ -");
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`ADMIN_PASSWORD: at least ${MIN_PASSWORD_LENGTH} characters`);

  const hash = await hashPassword(password);
  if (existing) {
    await sql.begin(async (tx) => {
      await tx`update users set username = ${username}, password_hash = ${hash}, active = true,
               failed_logins = 0, locked_until = null, password_changed_at = now()
               where id = ${existing.id}`;
      await tx`delete from sessions where user_id = ${existing.id}`;
      await tx`insert into audit_log (actor_id, action, target) values (null, 'admin.reset_from_server', ${existing.id})`;
    });
    console.log(`admin password reset for "${username}"`);
  } else {
    await sql`insert into users (username, display_name, role, password_hash)
              values (${username}, 'Admin', 'admin', ${hash})`;
    console.log(`admin account "${username}" created`);
  }
}

migrate()
  .then(() => ensureAdmin(process.argv.includes("--reset-admin")))
  .then(() => sql.end())
  .catch(async (error) => {
    console.error(error);
    await sql.end();
    process.exit(1);
  });
