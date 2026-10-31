import "server-only";
import type { Tx } from "@/lib/db";
import { type DuplicateCandidate, type DuplicateMatch, type DuplicateProbe, matchDuplicates } from "@/lib/customers/duplicates";
import { normalizeEmail, phoneDigits } from "@/lib/geo/normalize";

/** Loads possible matches under row level security and applies the pure matching rules. */
export async function findDuplicates(tx: Tx, tenantId: string, probe: DuplicateProbe): Promise<DuplicateMatch[]> {
  const address = probe.normalizedAddress?.trim() || null;
  const phone = phoneDigits(probe.phone);
  const email = normalizeEmail(probe.email);
  if (!address && !phone && !email) return [];

  const candidates: DuplicateCandidate[] = [];
  if (phone || email) {
    const accounts = await tx<{ id: string; name: string; phone_digits: string | null; email: string | null }[]>`
      select id, name, phone_digits, email from public.accounts
      where tenant_id = ${tenantId} and archived_at is null
        and ((${phone}::text is not null and phone_digits = ${phone}) or (${email}::text is not null and email = ${email}))`;
    candidates.push(...accounts.map((a) => ({ kind: "account" as const, id: a.id, label: a.name, phoneDigits: a.phone_digits, email: a.email })));
    const contacts = await tx<{ id: string; name: string; phone_digits: string | null; email: string | null; account_id: string | null }[]>`
      select id, name, phone_digits, email, account_id from public.contacts
      where tenant_id = ${tenantId} and archived_at is null
        and ((${phone}::text is not null and phone_digits = ${phone}) or (${email}::text is not null and email = ${email}))`;
    candidates.push(...contacts.map((c) => ({ kind: "contact" as const, id: c.account_id ?? c.id, label: `${c.name} (contact)`, phoneDigits: c.phone_digits, email: c.email })));
  }
  if (address) {
    const properties = await tx<{ id: string; account_id: string; normalized_address: string }[]>`
      select id, account_id, normalized_address from public.properties
      where tenant_id = ${tenantId} and archived_at is null and normalized_address = ${address}`;
    candidates.push(...properties.map((p) => ({ kind: "property" as const, id: p.id, label: p.normalized_address, normalizedAddress: p.normalized_address })));
  }
  // Every stage counts: a lost lead from last month is exactly the duplicate staff should reopen instead of re-entering.
  const leads = await tx<{ id: string; name: string; stage: string; phone_digits: string | null; email: string | null; normalized_address: string | null }[]>`
    select id, name, stage, phone_digits, email, normalized_address from public.leads
    where tenant_id = ${tenantId}
      and ((${phone}::text is not null and phone_digits = ${phone})
        or (${email}::text is not null and email = ${email})
        or (${address}::text is not null and normalized_address = ${address}))`;
  candidates.push(
    ...leads.map((l) => ({
      kind: "lead" as const,
      id: l.id,
      label: `${l.name} (${l.stage.replace("_", " ")} lead)`,
      phoneDigits: l.phone_digits,
      email: l.email,
      normalizedAddress: l.normalized_address,
    })),
  );

  return matchDuplicates(candidates, probe);
}
