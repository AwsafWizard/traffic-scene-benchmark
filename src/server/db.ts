import "server-only";
import postgres from "postgres";

/**
 * The one database connection pool. Only server code imports this, and the
 * browser never talks to the database directly.
 *
 * On Supabase, DATABASE_URL is the transaction pooler (port 6543), which can't
 * keep prepared statements between requests, hence `prepare: false`.
 */
const globalForSql = globalThis as unknown as { __sql?: postgres.Sql };

function connect(): postgres.Sql {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return postgres(url, {
    prepare: false,
    max: process.env.VERCEL ? 3 : 5,
    idle_timeout: 20,
    onnotice: () => {},
  });
}

export const sql: postgres.Sql = globalForSql.__sql ?? connect();
if (process.env.NODE_ENV !== "production") globalForSql.__sql = sql;

export type Tx = postgres.TransactionSql;
