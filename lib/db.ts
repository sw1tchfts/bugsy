import "server-only";
import postgres from "postgres";
import { serverEnv } from "@/lib/supabase/env";

// One pool per process. prepare: false keeps it compatible with Supabase's transaction-mode pooler.
const globalForDb = globalThis as unknown as { bugsySql?: postgres.Sql };

export const sql: postgres.Sql =
  globalForDb.bugsySql ??
  postgres(serverEnv().databaseUrl, {
    max: 10,
    prepare: false,
    onnotice: () => {},
  });

if (process.env.NODE_ENV !== "production") globalForDb.bugsySql = sql;

export type Tx = postgres.TransactionSql;

export type Claims = {
  sub: string;
  email?: string;
  role: "authenticated";
};

/**
 * Runs `fn` inside a transaction that carries the signed-in user's JWT claims, exactly as Supabase's API
 * does, so every row level security policy applies. All tenant data access in the app goes through here;
 * the database, not the application, decides what the user may see.
 */
export async function withRls<T>(claims: Claims, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await sql.begin(async (tx) => {
    await tx.unsafe("set local role authenticated");
    await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
    return fn(tx);
  });
  return result as T;
}

/** Runs `fn` as an anonymous visitor: only what the anon role may reach, such as an invitation preview. */
export async function withAnon<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const result = await sql.begin(async (tx) => {
    await tx.unsafe("set local role anon");
    return fn(tx);
  });
  return result as T;
}

/** Turns a database error into a short code for a redirect query string. */
export function errorCode(err: unknown): string {
  const e = err as { code?: string; message?: string };
  if (e?.message?.includes("at least one owner")) return "last-owner";
  if (e?.code === "42501") return "forbidden";
  if (e?.code === "23505") return "duplicate";
  if (e?.code === "23503") return "in-use";
  if (e?.code === "23514") return e.message?.replace(/\s+/g, " ").slice(0, 120) ?? "invalid";
  return "failed";
}
