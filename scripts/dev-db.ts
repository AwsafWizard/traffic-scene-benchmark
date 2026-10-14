/**
 * A real Postgres for local development, no Docker or root needed.
 *
 * Production uses Supabase; this stands in for it on your machine. Data lives in
 * .pgdata/ (gitignored). Leave it running in its own terminal:
 *
 *   npm run db:dev
 *
 * and point DATABASE_URL at postgres://postgres:postgres@localhost:54329/dhakavqa
 */
import EmbeddedPostgres from "embedded-postgres";
import fs from "node:fs";
import path from "node:path";

const dir = path.resolve(".pgdata");
const port = Number(process.env.DEV_DB_PORT ?? 54329);
const fresh = !fs.existsSync(path.join(dir, "PG_VERSION"));

const pg = new EmbeddedPostgres({
  databaseDir: dir,
  user: "postgres",
  password: "postgres",
  port,
  persistent: true,
});

async function main() {
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase(process.env.DEV_DB_NAME ?? "dhakavqa");
  console.log(`Postgres ready on port ${port}${fresh ? " (new database created)" : ""}. Ctrl-C to stop.`);
}

async function stop() {
  await pg.stop();
  process.exit(0);
}

process.on("SIGINT", stop);
process.on("SIGTERM", stop);
main().catch(async (error) => {
  console.error(error);
  await pg.stop().catch(() => {});
  process.exit(1);
});
