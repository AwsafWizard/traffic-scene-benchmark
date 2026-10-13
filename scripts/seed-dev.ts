/**
 * Local development only: four sample annotators sharing one password, and a
 * sprint in its writing stage with a topic each (one V, two C, one I subtype),
 * so every checking flow can be tried by hand.
 *
 *   DEV_SEED_PASSWORD=something-long npm run db:seed-dev
 *
 * Refuses to run on Vercel or against anything but a localhost database.
 */
import fs from "node:fs";
import postgres from "postgres";
import { hashPassword } from "../src/server/password";

if (fs.existsSync(".env.local") && !process.env.VERCEL) process.loadEnvFile(".env.local");
const url = process.env.DATABASE_URL ?? "";
if (process.env.VERCEL || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) {
  console.error("seed-dev only runs against a local database.");
  process.exit(1);
}
const password = process.env.DEV_SEED_PASSWORD ?? "";
if (password.length < 10) {
  console.error("Set DEV_SEED_PASSWORD (10+ characters) for the sample annotators.");
  process.exit(1);
}

const sql = postgres(url, { max: 1, onnotice: () => {} });
const people = [
  ["fuad", "A H M Fuad", "1.1"],
  ["muttakin", "Muttakin Morshed", "1.4"],
  ["azmain", "Kazi Azmain Awsaf", "5.4"],
  ["rafi", "Sample Annotator", "8.1"],
] as const;

async function main() {
  const hash = await hashPassword(password);
  const [live] = await sql`select 1 from sprints where status in ('writing', 'verifying')`;
  if (live) throw new Error("A sprint is already live; close it first or reset .pgdata.");
  const [sprint] = await sql<{ id: number }[]>`
    insert into sprints (name, status, writing_started_at) values ('Dev sprint', 'writing', now()) returning id`;
  for (const [username, name, code] of people) {
    const [user] = await sql<{ id: string }[]>`
      insert into users (username, display_name, role, password_hash) values (${username}, ${name}, 'annotator', ${hash})
      on conflict (username) do update set password_hash = excluded.password_hash, active = true
      returning id`;
    await sql`insert into assignments (sprint_id, annotator_id, category_id, subtype_id, target)
              select ${sprint.id}, ${user.id}, category_id, id, 3 from subtypes where code = ${code}`;
  }
  console.log(`Seeded sprint ${sprint.id} with ${people.map((p) => p[0]).join(", ")}.`);
}

main()
  .then(() => sql.end())
  .catch(async (error) => {
    console.error(error.message);
    await sql.end();
    process.exit(1);
  });
