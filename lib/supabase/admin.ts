import "server-only";
// Supabase Auth's admin API, server side only. Used for one thing: creating the login of a customer who holds a portal
// invitation (spec 16 rule 1). Holding the link sent to the address is the proof of the address, so the login is
// created confirmed.
import { serverEnv } from "@/lib/supabase/env";

function authUrl(): string | null {
  return process.env.SUPABASE_AUTH_INTERNAL_URL ?? (process.env.NEXT_PUBLIC_SUPABASE_URL ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1` : null);
}

export type CreateUserResult = { ok: true; id: string } | { ok: false; reason: "exists" | "unavailable" | "refused"; detail?: string };

export async function createConfirmedUser(email: string, password: string): Promise<CreateUserResult> {
  const url = authUrl();
  const key = serverEnv().serviceRoleKey;
  if (!url || !key) return { ok: false, reason: "unavailable" };
  const res = await fetch(`${url}/admin/users`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}`, apikey: key },
    body: JSON.stringify({ email, password, email_confirm: true }),
    cache: "no-store",
  });
  if (res.ok) return { ok: true, id: ((await res.json()) as { id: string }).id };
  const detail = await res.text();
  if (res.status === 422 || /already/i.test(detail)) return { ok: false, reason: "exists" };
  return { ok: false, reason: "refused", detail: detail.slice(0, 200) };
}
