import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../config/env.js";
import * as schema from "./schema.js";

/**
 * A single postgres-js connection pool for the process.
 *
 * Supabase's connection poolers (pgBouncer in transaction mode on port 6543)
 * do not support prepared statements, so they are disabled. Session-mode
 * poolers and direct connections work with this setting too.
 */
export const sql = postgres(env.DATABASE_URL, {
  max: env.DATABASE_POOL_MAX,
  ssl: env.DATABASE_SSL ? "require" : false,
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 15,
  onnotice: () => {},
  types: {
    /**
     * Money columns are int8 and `SUM()` over them yields numeric; the driver
     * returns both as strings by default, which silently turns budget
     * arithmetic into string concatenation. Both are parsed as JS numbers here:
     * every amount is a whole Ngultrum value capped at Nu. 1 trillion, far
     * below Number.MAX_SAFE_INTEGER.
     */
    bigint: {
      to: 20,
      from: [20],
      serialize: (value: number | bigint) => String(value),
      parse: (value: string) => Number(value),
    },
    numeric: {
      to: 1700,
      from: [1700],
      serialize: (value: number) => String(value),
      parse: (value: string) => Number(value),
    },
  },
});

export const db = drizzle(sql, { schema, casing: "snake_case" });

export type Database = typeof db;

/** Drizzle's transaction handle — services accept this so they compose. */
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/** Either the pool or an open transaction. */
export type DbExecutor = Database | Transaction;

export async function closeDatabase(): Promise<void> {
  await sql.end({ timeout: 5 });
}

export async function checkDatabase(): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  }
}
