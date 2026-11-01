// The phone integration (spec 20 rule 8): who is calling, the call log, and outgoing calls placed from Bugsy.
import type postgres from "postgres";
import { phoneDigits } from "@/lib/geo/normalize";

type Sql = postgres.Sql | postgres.TransactionSql;

export type CallerMatch = { kind: "account" | "lead"; id: string; name: string; contact_name: string | null };

/** Everyone a number belongs to: accounts (by their own phone or a contact's), then leads, newest first. */
export async function callerMatches(tx: Sql, tenantId: string, number: string): Promise<CallerMatch[]> {
  const digits = phoneDigits(number)?.slice(-10);
  if (!digits || digits.length < 7) return [];
  const accounts = await tx<{ id: string; name: string; contact_name: string | null }[]>`
    select a.id, a.name, (select c.name from public.contacts c where c.tenant_id = a.tenant_id and c.account_id = a.id and c.archived_at is null and right(c.phone_digits, 10) = ${digits} order by c.created_at desc limit 1) as contact_name
    from public.accounts a
    where a.tenant_id = ${tenantId} and a.archived_at is null
      and (right(a.phone_digits, 10) = ${digits}
           or exists (select 1 from public.contacts c where c.tenant_id = a.tenant_id and c.account_id = a.id and c.archived_at is null and right(c.phone_digits, 10) = ${digits}))
    order by a.created_at desc limit 5`;
  const leads = accounts.length
    ? []
    : await tx<{ id: string; name: string }[]>`
        select l.id, l.name from public.leads l where l.tenant_id = ${tenantId} and right(l.phone_digits, 10) = ${digits} order by l.created_at desc limit 3`;
  return [
    ...accounts.map((a) => ({ kind: "account" as const, id: a.id, name: a.name, contact_name: a.contact_name })),
    ...leads.map((l) => ({ kind: "lead" as const, id: l.id, name: l.name, contact_name: null })),
  ];
}

export type CallRow = {
  id: string;
  direction: "inbound" | "outbound";
  from_number: string;
  to_number: string;
  account_id: string | null;
  lead_id: string | null;
  started_at: Date;
  duration_seconds: number | null;
  recording_url: string | null;
  notes: string | null;
  user_name: string | null;
};

/** The calls on an account, newest first. */
export async function callsForAccount(tx: Sql, tenantId: string, accountId: string): Promise<CallRow[]> {
  return tx<CallRow[]>`
    select c.id, c.direction, c.from_number, c.to_number, c.account_id, c.lead_id, c.started_at, c.duration_seconds, c.recording_url, c.notes,
           m.display_name as user_name
    from public.calls c left join public.memberships m on m.tenant_id = c.tenant_id and m.user_id = c.user_id
    where c.tenant_id = ${tenantId} and c.account_id = ${accountId}
    order by c.started_at desc limit 50`;
}

export type RingingCall = { id: string; from_number: string; started_at: Date; matches: CallerMatch[] };

/** Inbound calls of the last two minutes, each with everyone its number belongs to (the caller pop). */
export async function ringingCalls(tx: Sql, tenantId: string): Promise<RingingCall[]> {
  const calls = await tx<{ id: string; from_number: string; started_at: Date }[]>`
    select id, from_number, started_at from public.calls
    where tenant_id = ${tenantId} and direction = 'inbound' and started_at > now() - interval '2 minutes' and duration_seconds is null
    order by started_at desc limit 3`;
  const out: RingingCall[] = [];
  for (const c of calls) out.push({ ...c, matches: await callerMatches(tx, tenantId, c.from_number) });
  return out;
}

/** An outgoing call placed from a contact's page: logged, then dialed by the person's phone (`tel:`). */
export async function logOutboundCall(tx: Sql, tenantId: string, userId: string, call: { to: string; account_id: string | null; contact_id: string | null }): Promise<string> {
  const [conn] = await tx<{ settings: { call_number?: string } }[]>`select settings from public.integration_connections where tenant_id = ${tenantId} and provider = 'phone'`;
  const [row] = await tx<{ id: string }[]>`
    insert into public.calls (tenant_id, direction, from_number, to_number, account_id, contact_id, user_id, started_at, provider_call_id)
    values (${tenantId}, 'outbound', ${conn?.settings.call_number ?? ""}, ${call.to}, ${call.account_id}, ${call.contact_id}, ${userId}, now(), ${`bugsy:${crypto.randomUUID()}`})
    returning id`;
  return row.id;
}
