import "server-only";
// The public API's front door (spec 20 rules 1 and 2): the key from the request, its company and scopes, the limit,
// and the log. Every handler runs as anon through definer functions that check the key's scope themselves.
import { NextResponse } from "next/server";
import { type Tx, withAnon } from "@/lib/db";
import { hashKey, parseKey } from "./keys";

export type ApiKey = { key_id: string; tenant_id: string; scopes: string[] };

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

export function apiError(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return json(status, { error: { code, message } }, headers);
}

/** Runs one API call: authenticate, check the limit, run, map the database's refusals, log the outcome. */
export async function apiCall(request: Request, run: (tx: Tx, key: ApiKey) => Promise<unknown>, successStatus = 200): Promise<NextResponse> {
  const raw = request.headers.get("authorization") ?? request.headers.get("x-api-key");
  const parsed = parseKey(raw);
  if (!parsed) return apiError(401, "unauthorized", "Send the API key as a Bearer token.");
  const path = new URL(request.url).pathname;
  // Rule 2: the key is checked and the call takes its place in the minute's count in one step (no burst slips past).
  const [key] = await withAnon((tx) =>
    tx<(ApiKey & { request_id: string; limited: boolean })[]>`select request_id, key_id, tenant_id, scopes, limited from app.api_begin(${parsed.prefix}, ${hashKey(parsed.key)}, ${request.method}, ${path})`,
  );
  if (!key) return apiError(401, "unauthorized", "That key is not valid or was revoked.");
  const log = (status: number) => withAnon((tx) => tx`select app.api_finish(${key.request_id}, ${status})`).catch(() => undefined);
  if (key.limited) return apiError(429, "rate_limited", "At most 60 calls a minute per key.", { "retry-after": "60" });
  try {
    const body = await withAnon((tx) => run(tx, key));
    await log(successStatus);
    return json(successStatus, body);
  } catch (err) {
    const e = err as { code?: string; message?: string; status?: number };
    const status = e.status ?? (e.code === "42501" ? 403 : e.code === "P0002" ? 404 : e.code === "22023" || e.code === "22P02" || e.code === "23514" ? 422 : 500);
    await log(status);
    if (status === 500) {
      console.error("api error", e.code ?? "", e.message ?? err);
      return apiError(500, "server_error", "Something went wrong; try again.");
    }
    return apiError(status, status === 403 ? "forbidden" : status === 404 ? "not_found" : "invalid", (e.message ?? "refused").replace(/\s+/g, " ").slice(0, 200));
  }
}

/** A JSON body, or a 422 the handler throws. */
export async function body(request: Request): Promise<Record<string, unknown>> {
  try {
    const b = (await request.json()) as unknown;
    if (b && typeof b === "object" && !Array.isArray(b)) return b as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw Object.assign(new Error("Send a JSON object."), { status: 422 });
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function need(value: string | null, pattern: RegExp, name: string): string {
  if (!value || !pattern.test(value)) throw Object.assign(new Error(`${name} is missing or not valid`), { status: 422 });
  return value;
}
