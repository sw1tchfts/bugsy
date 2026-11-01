// The QuickBooks Online daily summary (spec 20 rule 7), pure: a day's posted lines summed per mapped account into one
// balanced journal entry. Bugsy stays the ledger of record; QuickBooks gets totals by account.

export type DayLine = { gl_account_id: string; account_name: string; debit_cents: number; credit_cents: number };
export type Mapping = { gl_account_id: string; qbo_account_id: string; qbo_account_name: string };
export type SummaryLine = { qbo_account_id: string; qbo_account_name: string; posting: "Debit" | "Credit"; amount_cents: number };

export function summarizeDay(lines: readonly DayLine[], mapping: readonly Mapping[]): { ok: true; lines: SummaryLine[] } | { ok: false; unmapped: string[] } {
  const map = new Map(mapping.map((m) => [m.gl_account_id, m]));
  const net = new Map<string, { m: Mapping; cents: number }>();
  const unmapped = new Set<string>();
  for (const l of lines) {
    const m = map.get(l.gl_account_id);
    if (!m) {
      if (l.debit_cents !== l.credit_cents) unmapped.add(l.account_name);
      continue;
    }
    const cur = net.get(m.qbo_account_id) ?? { m, cents: 0 };
    cur.cents += l.debit_cents - l.credit_cents;
    net.set(m.qbo_account_id, cur);
  }
  if (unmapped.size) return { ok: false, unmapped: [...unmapped].sort() };
  const out: SummaryLine[] = [];
  for (const { m, cents } of net.values()) {
    if (cents === 0) continue;
    out.push({ qbo_account_id: m.qbo_account_id, qbo_account_name: m.qbo_account_name, posting: cents > 0 ? "Debit" : "Credit", amount_cents: Math.abs(cents) });
  }
  out.sort((a, b) => (a.posting === b.posting ? a.qbo_account_name.localeCompare(b.qbo_account_name) : a.posting === "Debit" ? -1 : 1));
  return { ok: true, lines: out };
}

export function balanced(lines: readonly SummaryLine[]): boolean {
  const d = lines.filter((l) => l.posting === "Debit").reduce((s, l) => s + l.amount_cents, 0);
  const c = lines.filter((l) => l.posting === "Credit").reduce((s, l) => s + l.amount_cents, 0);
  return d === c;
}
