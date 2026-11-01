// The ledger's database layer (spec 09): posting through app.post_entry, idempotent by source key and inline with the
// business event; the sweep that catches anything missed; local payouts; the period-end reclass; period close and
// reopen; and the reads the pages and statements need. Every write goes through the caller's connection, so row level
// security applies to members and the jobs run privileged.
import type postgres from "postgres";
import { addDays, dateInZone, todayInZone } from "@/lib/dates";
import { localFeeCents } from "@/lib/payments/local";
import { type CashBasisIncome, cashBasisIncome } from "./cash-basis";
import { type AccountKey, type AccountType, CHART_TEMPLATE } from "./chart";
import { isPeriod, lastEndedPeriod, nextPeriod, periodEnd, periodOf, periodStart, periodsBetween, prevPeriod } from "./periods";
import {
  type ContractLine,
  contractPositions,
  invoiceLineAccount,
  invoiceLines,
  mirror,
  openingLines,
  payoutLines,
  paymentLines,
  productUseLines,
  reclassLines,
  refundLines,
  visitLines,
} from "./post";
import { type BalanceSheet, type DateRange, type IncomeStatement, type ReportAccount, type ReportLine, type RollForward, type TrialBalance, balanceSheet, incomeStatement, rollForward, trialBalance } from "./reports";

type Sql = postgres.Sql | postgres.TransactionSql;

export type SourceType = "invoice" | "credit_memo" | "void" | "visit" | "product_use" | "payment" | "refund" | "payout" | "reclass" | "reclass_reversal" | "opening" | "manual" | "reversal";

/** A line for app.post_entry: a template key, or an account id for manual entries. */
export type EntryLine = { account?: AccountKey; gl_account_id?: string; debit_cents: number; credit_cents: number; agreement_id?: string | null; jurisdiction?: string | null; memo?: string | null };

export type EntryInput = {
  source_type: SourceType;
  source_key: string;
  source_id?: string | null;
  posted_on: string;
  memo?: string;
  reverses?: string | null;
  lines: readonly EntryLine[];
};

function fail(message: string, code = "23514"): never {
  throw Object.assign(new Error(message), { code });
}

async function closedPeriods(tx: Sql, tenantId: string): Promise<Set<string>> {
  const rows = await tx<{ period: string }[]>`select period from public.period_closes where tenant_id = ${tenantId} and status = 'closed'`;
  return new Set(rows.map((r) => r.period));
}

export async function tenantTimeZone(tx: Sql, tenantId: string): Promise<string> {
  const [t] = await tx<{ timezone: string }[]>`select timezone from public.tenants where id = ${tenantId}`;
  return t?.timezone ?? "UTC";
}

/** Creates the template accounts the company lacks. Members may call it; the job does on every run. */
export async function ensureChart(tx: Sql, tenantId: string): Promise<number> {
  const [row] = await tx<{ added: number }[]>`select app.ensure_chart(${tenantId}, ${tx.json(CHART_TEMPLATE as unknown as postgres.JSONValue)}) as added`;
  return row?.added ?? 0;
}

/** Posts one entry (rules 1, 9, 12). app.post_entry moves an event dated in a closed period to the first open day
 *  with the original date in the memo, for every caller, including those who cannot read the period closes. Answers
 *  the entry id, or null when there was nothing to post. Idempotent by source key. */
export async function postEntry(tx: Sql, tenantId: string, input: EntryInput): Promise<string | null> {
  const lines = input.lines.filter((l) => l.debit_cents > 0 || l.credit_cents > 0);
  if (lines.length === 0) return null;
  const entry = { source_type: input.source_type, source_key: input.source_key, source_id: input.source_id ?? null, posted_on: input.posted_on, memo: input.memo ?? "", reverses: input.reverses ?? null };
  const payload = lines.map((l) => ({
    account_key: l.account ?? null,
    gl_account_id: l.gl_account_id ?? null,
    debit_cents: l.debit_cents,
    credit_cents: l.credit_cents,
    agreement_id: l.agreement_id ?? null,
    jurisdiction: l.jurisdiction ?? null,
    memo: l.memo ?? null,
  }));
  const [row] = await tx<{ id: string }[]>`
    select app.post_entry(${tenantId}, ${tx.json(entry)}, ${tx.json(payload)}, ${tx.json(CHART_TEMPLATE as unknown as postgres.JSONValue)}) as id`;
  return row.id;
}

async function entryByKey(tx: Sql, tenantId: string, sourceKey: string): Promise<{ id: string; reversed_by: string | null } | null> {
  const [row] = await tx<{ id: string; reversed_by: string | null }[]>`select id, reversed_by from public.journal_entries where tenant_id = ${tenantId} and source_key = ${sourceKey}`;
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Business events (rules 2 to 6)
// ---------------------------------------------------------------------------

type InvoiceRow = { id: string; number: number | null; kind: "invoice" | "credit_memo"; status: string; issued_on: string | null; source: string; agreement_id: string | null; account_name: string; void_reason: string | null };

async function invoiceRow(tx: Sql, tenantId: string, invoiceId: string): Promise<InvoiceRow | null> {
  const [row] = await tx<InvoiceRow[]>`
    select i.id, i.number, i.kind, i.status, i.issued_on, i.source, i.agreement_id, a.name as account_name, i.void_reason
    from public.invoices i join public.accounts a on a.id = i.account_id where i.id = ${invoiceId} and i.tenant_id = ${tenantId}`;
  return row ?? null;
}

/** An issued invoice or credit memo: receivables, the contract balance or income per line, tax per jurisdiction. */
export async function postInvoice(tx: Sql, tenantId: string, invoiceId: string): Promise<string | null> {
  const inv = await invoiceRow(tx, tenantId, invoiceId);
  if (!inv || inv.status === "draft" || !inv.issued_on) return null;
  if (inv.status === "void" && !(await entryByKey(tx, tenantId, `invoice:${inv.id}`))) return null;
  const lines = await tx<{ amount_cents: string | number; tax_cents: string | number; tax_breakdown: unknown; service_line: string | null; agreement_id: string | null; kind: "service" | "fee" | "late_fee" }[]>`
    select amount_cents, tax_cents, tax_breakdown, service_line, agreement_id, kind from public.invoice_lines where invoice_id = ${invoiceId} and tenant_id = ${tenantId} order by position`;
  const posting = invoiceLines({
    kind: inv.kind,
    source: inv.source,
    lines: lines.map((l) => ({
      amount_cents: Number(l.amount_cents),
      tax_cents: Number(l.tax_cents),
      tax_breakdown: Array.isArray(l.tax_breakdown) ? (l.tax_breakdown as { kind: string; name: string; cents: number }[]) : [],
      service_line: l.service_line,
      agreement_id: l.agreement_id ?? inv.agreement_id,
      kind: l.kind,
    })),
  });
  const label = inv.kind === "credit_memo" ? "Credit memo" : "Invoice";
  return postEntry(tx, tenantId, {
    source_type: inv.kind === "credit_memo" ? "credit_memo" : "invoice",
    source_key: `invoice:${inv.id}`,
    source_id: inv.id,
    posted_on: inv.issued_on,
    memo: `${label} #${inv.number ?? ""}, ${inv.account_name} (${inv.source.replace("_", " ")})`,
    lines: posting,
  });
}

/** A voided invoice reverses its own entry on the day of the void (rule 5). */
export async function postVoid(tx: Sql, tenantId: string, invoiceId: string, today: string): Promise<string | null> {
  const inv = await invoiceRow(tx, tenantId, invoiceId);
  if (!inv || inv.status !== "void") return null;
  const entry = await entryByKey(tx, tenantId, `invoice:${inv.id}`);
  if (!entry) return null;
  if (entry.reversed_by) return entry.reversed_by;
  return reverseEntry(tx, tenantId, entry.id, { source_type: "void", source_key: `void:${inv.id}`, source_id: inv.id, posted_on: today, memo: `Void of invoice #${inv.number ?? ""}: ${inv.void_reason ?? ""}` });
}

/** A completed visit earns its price out of the contract balance (rule 3). */
export async function postVisit(tx: Sql, tenantId: string, visitId: string, timeZone: string): Promise<string | null> {
  const [v] = await tx<{ id: string; status: string; sequence: number; price_cents: string | number; agreement_id: string | null; departed_at: Date | string | null; completed_at: Date | string | null; service_line: string; account_name: string }[]>`
    select v.id, v.status, v.sequence, v.price_cents, v.agreement_id, v.departed_at, v.completed_at, st.service_line, a.name as account_name
    from public.visits v join public.service_types st on st.id = v.service_type_id join public.accounts a on a.id = v.account_id
    where v.id = ${visitId} and v.tenant_id = ${tenantId}`;
  if (!v || v.status !== "completed") return null;
  const lines = visitLines({ price_cents: Number(v.price_cents), service_line: v.service_line, agreement_id: v.agreement_id });
  if (lines.length === 0) return null;
  const day = dateInZone(v.departed_at ?? v.completed_at ?? new Date(), timeZone);
  return postEntry(tx, tenantId, { source_type: "visit", source_key: `visit:${v.id}`, source_id: v.id, posted_on: day, memo: `Visit ${v.sequence} completed, ${v.account_name}`, lines });
}

type UsageRow = { id: string; amount: string; amount_unit: string; cost_unit: string | null; unit_cost_cents: string | number | null; product_name: string; departed_at: Date | string | null; completed_at: Date | string | null; visit_id: string; account_name: string };

async function usageRows(tx: Sql, tenantId: string, visitId: string | null): Promise<UsageRow[]> {
  return tx<UsageRow[]>`
    select vp.id, vp.amount::text as amount, vp.amount_unit, tp.unit as cost_unit, tp.unit_cost_cents, p.name as product_name, v.departed_at, v.completed_at, v.id as visit_id, a.name as account_name
    from public.visit_products vp
      join public.visits v on v.id = vp.visit_id
      join public.accounts a on a.id = v.account_id
      join public.products p on p.id = vp.product_id
      left join public.tenant_products tp on tp.product_id = vp.product_id and tp.tenant_id = vp.tenant_id
    where vp.tenant_id = ${tenantId} and v.status = 'completed' and (${visitId}::uuid is null or vp.visit_id = ${visitId}::uuid)
      and not exists (select 1 from public.journal_entries e where e.tenant_id = vp.tenant_id and e.source_key = 'product_use:' || vp.id)
    order by v.completed_at, vp.id`;
}

/** Product used at a completed stop relieves inventory at the tenant product's cost (rule 4). Unpriced usage is left for the ledger home to list. */
export async function postProductUse(tx: Sql, tenantId: string, visitId: string | null, timeZone: string): Promise<{ posted: number; unpriced: number }> {
  let posted = 0;
  let unpriced = 0;
  for (const u of await usageRows(tx, tenantId, visitId)) {
    if (!u.cost_unit || u.unit_cost_cents === null) {
      unpriced += 1;
      continue;
    }
    const lines = productUseLines({ quantity: u.amount, usage_unit: u.amount_unit, unit_cost_cents: Number(u.unit_cost_cents), cost_unit: u.cost_unit });
    if (lines === null) {
      unpriced += 1;
      continue;
    }
    if (lines.length === 0) continue;
    const day = dateInZone(u.departed_at ?? u.completed_at ?? new Date(), timeZone);
    const id = await postEntry(tx, tenantId, { source_type: "product_use", source_key: `product_use:${u.id}`, source_id: u.id, posted_on: day, memo: `${u.product_name}, ${u.amount} ${u.amount_unit} at ${u.account_name}`, lines });
    if (id) posted += 1;
  }
  return { posted, unpriced };
}

/** Usage at completed stops that cannot be priced: no tenant product cost, or units that do not convert. */
export async function unpricedUsage(tx: Sql, tenantId: string): Promise<{ id: string; visit_id: string; product_name: string; amount: string; amount_unit: string; cost_unit: string | null; account_name: string }[]> {
  const out = [];
  for (const u of await usageRows(tx, tenantId, null)) {
    const priced = u.cost_unit && u.unit_cost_cents !== null ? productUseLines({ quantity: u.amount, usage_unit: u.amount_unit, unit_cost_cents: Number(u.unit_cost_cents), cost_unit: u.cost_unit }) : null;
    if (priced === null) out.push({ id: u.id, visit_id: u.visit_id, product_name: u.product_name, amount: u.amount, amount_unit: u.amount_unit, cost_unit: u.cost_unit, account_name: u.account_name });
  }
  return out;
}

type PaymentRow = { id: string; kind: "payment" | "refund"; method: string; status: string; amount_cents: string | number; received_at: Date | string; reference: string | null; account_name: string };

async function paymentRow(tx: Sql, tenantId: string, paymentId: string): Promise<PaymentRow | null> {
  const [row] = await tx<PaymentRow[]>`
    select p.id, p.kind, p.method, p.status, p.amount_cents, p.received_at, p.reference, a.name as account_name
    from public.payments p join public.accounts a on a.id = p.account_id where p.id = ${paymentId} and p.tenant_id = ${tenantId}`;
  return row ?? null;
}

/** A succeeded payment: money into clearing or the bank, out of receivables (rule 5). */
export async function postPayment(tx: Sql, tenantId: string, paymentId: string, timeZone: string): Promise<string | null> {
  const p = await paymentRow(tx, tenantId, paymentId);
  if (!p || p.kind !== "payment" || !["succeeded", "refunded"].includes(p.status)) return null;
  const lines = paymentLines({ method: p.method, amount_cents: Number(p.amount_cents) });
  return postEntry(tx, tenantId, {
    source_type: "payment",
    source_key: `payment:${p.id}`,
    source_id: p.id,
    posted_on: dateInZone(p.received_at, timeZone),
    memo: `Payment by ${p.method.replace("_", " ")}${p.reference ? ` ${p.reference}` : ""}, ${p.account_name}`,
    lines,
  });
}

/** A refund: the mirror of a payment (rule 5). */
export async function postRefund(tx: Sql, tenantId: string, refundId: string, timeZone: string): Promise<string | null> {
  const p = await paymentRow(tx, tenantId, refundId);
  if (!p || p.kind !== "refund" || p.status !== "succeeded") return null;
  const lines = refundLines({ method: p.method, amount_cents: Number(p.amount_cents) });
  return postEntry(tx, tenantId, { source_type: "refund", source_key: `refund:${p.id}`, source_id: p.id, posted_on: dateInZone(p.received_at, timeZone), memo: `Refund by ${p.method.replace("_", " ")}, ${p.account_name}`, lines });
}

/** A payout: the bank gets the net, fees are expensed, clearing is relieved for the gross (rule 6). */
export async function postPayout(tx: Sql, tenantId: string, payoutId: string): Promise<string | null> {
  const [po] = await tx<{ id: string; gateway: string; gateway_payout_id: string; arrived_on: string; gross_cents: string | number; fee_cents: string | number; status: string }[]>`
    select id, gateway, gateway_payout_id, arrived_on, gross_cents, fee_cents, status from public.payouts where id = ${payoutId} and tenant_id = ${tenantId}`;
  if (!po || po.status !== "paid") return null;
  const lines = payoutLines({ gross_cents: Number(po.gross_cents), fee_cents: Number(po.fee_cents) });
  return postEntry(tx, tenantId, { source_type: "payout", source_key: `payout:${po.id}`, source_id: po.id, posted_on: po.arrived_on, memo: `${po.gateway === "stripe" ? "Stripe" : "Local gateway"} payout ${po.gateway_payout_id}`, lines });
}

/** A mid-term agreement's position at go-live, once (rule 13). */
export async function postOpening(tx: Sql, tenantId: string, input: { agreement_id: string; billed_cents: number; recognized_cents: number; as_of: string }): Promise<string | null> {
  const [g] = await tx<{ id: string; number: number }[]>`select id, number from public.agreements where id = ${input.agreement_id} and tenant_id = ${tenantId}`;
  if (!g) fail("agreement not found");
  if (await entryByKey(tx, tenantId, `opening:${g.id}`)) fail(`agreement #${g.number} already has its opening position`);
  const lines = openingLines(input);
  if (lines.length === 0) return null;
  return postEntry(tx, tenantId, {
    source_type: "opening",
    source_key: `opening:${g.id}`,
    source_id: g.id,
    posted_on: input.as_of,
    memo: `Opening position of agreement #${g.number}: billed ${input.billed_cents} cents, delivered ${input.recognized_cents} cents as of ${input.as_of}`,
    lines,
  });
}

/** Posts the mirror of an entry and links the two (rule 11). */
export async function reverseEntry(tx: Sql, tenantId: string, entryId: string, input: { source_type: "void" | "reversal"; source_key: string; source_id?: string | null; posted_on: string; memo: string }): Promise<string | null> {
  const [entry] = await tx<{ id: string; number: number; reversed_by: string | null }[]>`select id, number, reversed_by from public.journal_entries where id = ${entryId} and tenant_id = ${tenantId}`;
  if (!entry) fail("journal entry not found");
  if (entry.reversed_by) fail(`entry #${entry.number} is already reversed`);
  const lines = await tx<{ gl_account_id: string; debit_cents: string | number; credit_cents: string | number; agreement_id: string | null; jurisdiction: string | null; memo: string | null }[]>`
    select gl_account_id, debit_cents, credit_cents, agreement_id, jurisdiction, memo from public.journal_lines where entry_id = ${entryId} order by position`;
  const mirrored: EntryLine[] = mirror(lines.map((l) => ({ account: "operating_bank" as AccountKey, debit_cents: Number(l.debit_cents), credit_cents: Number(l.credit_cents), agreement_id: l.agreement_id, jurisdiction: l.jurisdiction, memo: l.memo }))).map((l, i) => ({
    gl_account_id: lines[i].gl_account_id,
    debit_cents: l.debit_cents,
    credit_cents: l.credit_cents,
    agreement_id: l.agreement_id,
    jurisdiction: l.jurisdiction,
    memo: l.memo,
  }));
  return postEntry(tx, tenantId, { ...input, reverses: entryId, lines: mirrored });
}

// ---------------------------------------------------------------------------
// Contract balances and the period-end reclass (rules 7 and 8)
// ---------------------------------------------------------------------------

/** Every contract liability line with the agreement it belongs to and what it was for. */
export async function contractLines(tx: Sql, tenantId: string): Promise<ContractLine[]> {
  const rows = await tx<{ agreement_id: string; debit_cents: string | number; credit_cents: string | number; posted_on: string; origin: string }[]>`
    select l.agreement_id, l.debit_cents, l.credit_cents, e.posted_on, coalesce(r.source_type, e.source_type) as origin
    from public.journal_lines l
      join public.journal_entries e on e.id = l.entry_id
      left join public.journal_entries r on r.id = e.reverses
      join public.gl_accounts g on g.id = l.gl_account_id
    where l.tenant_id = ${tenantId} and g.key = 'contract_liability' and l.agreement_id is not null
    order by e.posted_on, e.number`;
  return rows.map((r) => ({
    agreement_id: r.agreement_id,
    kind: r.origin === "visit" ? "recognition" : r.origin === "reclass" || r.origin === "reclass_reversal" ? "presentation" : "billing",
    debit_cents: Number(r.debit_cents),
    credit_cents: Number(r.credit_cents),
    posted_on: r.posted_on,
  }));
}

/** The reclass for a period, dated its last day, and its reversal on day one of the next (rule 8). Adjusts rather
 *  than repeats when the positions moved since the last reclass of the same period. */
export async function postReclass(tx: Sql, tenantId: string, period: string): Promise<{ entry_id: string | null; adjusted_cents: number }> {
  const expected = new Map(contractPositions(await contractLines(tx, tenantId), periodEnd(period)).map((p) => [p.agreement_id, p.asset_cents]));
  const presented = await tx<{ agreement_id: string; cents: string | number; n: number }[]>`
    select l.agreement_id, sum(l.debit_cents - l.credit_cents) as cents, count(distinct e.id)::int as n
    from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.gl_accounts g on g.id = l.gl_account_id
    where l.tenant_id = ${tenantId} and e.source_type = 'reclass' and e.source_key like ${`reclass:${period}%`} and g.key = 'contract_asset' and e.reversed_by is null
    group by l.agreement_id`;
  const have = new Map(presented.map((p) => [p.agreement_id, Number(p.cents)]));
  const ids = new Set([...expected.keys(), ...have.keys()]);
  const delta: { agreement_id: string; position_cents: number }[] = [];
  for (const id of ids) {
    const diff = (expected.get(id) ?? 0) - (have.get(id) ?? 0);
    if (diff !== 0) delta.push({ agreement_id: id, position_cents: -diff });
  }
  const lines = reclassLines(delta.filter((d) => d.position_cents < 0)).concat(mirror(reclassLines(delta.filter((d) => d.position_cents > 0).map((d) => ({ ...d, position_cents: -d.position_cents })))));
  if (lines.length === 0) return { entry_id: null, adjusted_cents: 0 };
  const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from public.journal_entries where tenant_id = ${tenantId} and source_type = 'reclass' and source_key like ${`reclass:${period}%`}`;
  const suffix = n === 0 ? "" : `:${n + 1}`;
  const entryId = await postEntry(tx, tenantId, { source_type: "reclass", source_key: `reclass:${period}${suffix}`, posted_on: periodEnd(period), memo: `Period-end reclass for ${period}: unbilled receivables presented as contract assets`, lines });
  await postEntry(tx, tenantId, { source_type: "reclass_reversal", source_key: `reclass_reversal:${period}${suffix}`, posted_on: periodStart(nextPeriod(period)), memo: `Reversal of the ${period} period-end reclass`, lines: mirror(lines) });
  return { entry_id: entryId, adjusted_cents: lines.reduce((s, l) => s + l.debit_cents, 0) };
}

// ---------------------------------------------------------------------------
// Sweep, payouts and the job (rules 6 and 12)
// ---------------------------------------------------------------------------

export type SweepCounts = { invoices: number; voids: number; visits: number; product_uses: number; unpriced: number; payments: number; refunds: number; payouts: number };

/** What the inline hooks might have missed: every business event without its entry. Never posts twice. */
export async function sweep(tx: Sql, tenantId: string, timeZone: string): Promise<SweepCounts> {
  const counts: SweepCounts = { invoices: 0, voids: 0, visits: 0, product_uses: 0, unpriced: 0, payments: 0, refunds: 0, payouts: 0 };
  const today = todayInZone(timeZone);
  const invoices = await tx<{ id: string }[]>`
    select i.id from public.invoices i where i.tenant_id = ${tenantId} and i.status in ('issued', 'partially_paid', 'paid', 'past_due')
      and not exists (select 1 from public.journal_entries e where e.tenant_id = i.tenant_id and e.source_key = 'invoice:' || i.id) order by i.issued_on, i.number`;
  for (const i of invoices) if (await postInvoice(tx, tenantId, i.id)) counts.invoices += 1;
  const voids = await tx<{ id: string }[]>`
    select i.id from public.invoices i where i.tenant_id = ${tenantId} and i.status = 'void'
      and exists (select 1 from public.journal_entries e where e.tenant_id = i.tenant_id and e.source_key = 'invoice:' || i.id and e.reversed_by is null)`;
  for (const i of voids) if (await postVoid(tx, tenantId, i.id, today)) counts.voids += 1;
  const visits = await tx<{ id: string }[]>`
    select v.id from public.visits v where v.tenant_id = ${tenantId} and v.status = 'completed' and v.agreement_id is not null and v.price_cents > 0
      and not exists (select 1 from public.journal_entries e where e.tenant_id = v.tenant_id and e.source_key = 'visit:' || v.id) order by v.completed_at`;
  for (const v of visits) if (await postVisit(tx, tenantId, v.id, timeZone)) counts.visits += 1;
  const usage = await postProductUse(tx, tenantId, null, timeZone);
  counts.product_uses = usage.posted;
  counts.unpriced = usage.unpriced;
  const payments = await tx<{ id: string; kind: "payment" | "refund" }[]>`
    select p.id, p.kind from public.payments p where p.tenant_id = ${tenantId} and p.status in ('succeeded', 'refunded')
      and not exists (select 1 from public.journal_entries e where e.tenant_id = p.tenant_id and e.source_key = (case when p.kind = 'refund' then 'refund:' else 'payment:' end) || p.id) order by p.received_at`;
  for (const p of payments) {
    if (p.kind === "refund") {
      if (await postRefund(tx, tenantId, p.id, timeZone)) counts.refunds += 1;
    } else if (await postPayment(tx, tenantId, p.id, timeZone)) counts.payments += 1;
  }
  const payouts = await tx<{ id: string }[]>`
    select po.id from public.payouts po where po.tenant_id = ${tenantId} and po.status = 'paid'
      and not exists (select 1 from public.journal_entries e where e.tenant_id = po.tenant_id and e.source_key = 'payout:' || po.id) order by po.arrived_on`;
  for (const po of payouts) if (await postPayout(tx, tenantId, po.id)) counts.payouts += 1;
  return counts;
}

/** Counts of events still unposted, for the ledger home; the job's next run clears them. */
export async function unposted(tx: Sql, tenantId: string): Promise<{ invoices: number; visits: number; payments: number; payouts: number }> {
  const [row] = await tx<{ invoices: number; visits: number; payments: number; payouts: number }[]>`
    select
      (select count(*)::int from public.invoices i where i.tenant_id = ${tenantId} and i.status in ('issued', 'partially_paid', 'paid', 'past_due')
         and not exists (select 1 from public.journal_entries e where e.tenant_id = i.tenant_id and e.source_key = 'invoice:' || i.id)) as invoices,
      (select count(*)::int from public.visits v where v.tenant_id = ${tenantId} and v.status = 'completed' and v.agreement_id is not null and v.price_cents > 0
         and not exists (select 1 from public.journal_entries e where e.tenant_id = v.tenant_id and e.source_key = 'visit:' || v.id)) as visits,
      (select count(*)::int from public.payments p where p.tenant_id = ${tenantId} and p.status in ('succeeded', 'refunded')
         and not exists (select 1 from public.journal_entries e where e.tenant_id = p.tenant_id and e.source_key = (case when p.kind = 'refund' then 'refund:' else 'payment:' end) || p.id)) as payments,
      (select count(*)::int from public.payouts po where po.tenant_id = ${tenantId} and po.status = 'paid'
         and not exists (select 1 from public.journal_entries e where e.tenant_id = po.tenant_id and e.source_key = 'payout:' || po.id)) as payouts`;
  return row;
}

/** The local gateway pays out each day's card and bank money the next day, less its test fee (decisions). Days before
 *  `through` (today, by default) are settled; the seed passes tomorrow so its own charges settle the same day. */
export async function localPayouts(tx: Sql, tenantId: string, gateway: string, today: string, timeZone: string, through: string = today): Promise<number> {
  if (gateway !== "local") return 0;
  type Source = { id: string; kind: "payment" | "refund"; amount_cents: string | number; received_at: Date | string };
  const rows = await tx<Source[]>`
    select id, kind, amount_cents, received_at from public.payments
    where tenant_id = ${tenantId} and gateway = 'local' and status in ('succeeded', 'refunded') and method in ('card', 'us_bank_account') and payout_id is null
    order by received_at`;
  const byDay = new Map<string, Source[]>();
  for (const r of rows) {
    const day = dateInZone(r.received_at, timeZone);
    if (day >= through) continue;
    byDay.set(day, [...(byDay.get(day) ?? []), r]);
  }
  let made = 0;
  for (const [day, batch] of byDay) {
    let gross = 0;
    let fee = 0;
    for (const r of batch) {
      if (r.kind === "refund") gross -= Number(r.amount_cents);
      else {
        gross += Number(r.amount_cents);
        fee += localFeeCents(Number(r.amount_cents));
      }
    }
    if (gross <= 0) continue;
    const key = `local_po_${tenantId.slice(0, 8)}_${day}`;
    const [inserted] = await tx<{ id: string }[]>`
      insert into public.payouts (tenant_id, gateway, gateway_payout_id, arrived_on, gross_cents, fee_cents, net_cents, status, payload)
      values (${tenantId}, 'local', ${key}, ${addDays(day, 1) > today ? today : addDays(day, 1)}, ${gross}, ${fee}, ${gross - fee}, 'paid', ${tx.json({ charges: batch.length, day })})
      on conflict (gateway, gateway_payout_id) do nothing returning id`;
    const payoutId = inserted?.id ?? (await tx<{ id: string }[]>`select id from public.payouts where gateway = 'local' and gateway_payout_id = ${key}`)[0]?.id;
    if (!payoutId) continue;
    await tx`update public.payments set payout_id = ${payoutId} where tenant_id = ${tenantId} and id = any(${batch.map((r) => r.id)}::uuid[]) and payout_id is null`;
    if (await postPayout(tx, tenantId, payoutId)) made += 1;
  }
  return made;
}

export type LedgerCounts = SweepCounts & { local_payouts: number; reclasses: number };

async function earliestPeriod(tx: Sql, tenantId: string): Promise<string | null> {
  const [row] = await tx<{ period: string | null }[]>`select min(period) as period from public.journal_entries where tenant_id = ${tenantId}`;
  return row?.period ?? null;
}

/** The ledger's share of the billing job: the chart, the sweep, local payouts, and a reclass for every ended period still open. */
export async function runLedger(tx: Sql, tenantId: string, timeZone: string, today: string, gateway: string): Promise<LedgerCounts> {
  await ensureChart(tx, tenantId);
  const swept = await sweep(tx, tenantId, timeZone);
  const local_payouts = await localPayouts(tx, tenantId, gateway, today, timeZone);
  let reclasses = 0;
  const first = await earliestPeriod(tx, tenantId);
  if (first) {
    const closed = await closedPeriods(tx, tenantId);
    const last = lastEndedPeriod(today);
    if (first <= last) {
      for (const period of periodsBetween(first, last)) {
        if (closed.has(period)) continue;
        if ((await postReclass(tx, tenantId, period)).entry_id) reclasses += 1;
      }
    }
  }
  return { ...swept, local_payouts, reclasses };
}

// ---------------------------------------------------------------------------
// Periods (rules 9 and 10)
// ---------------------------------------------------------------------------

export type PeriodRow = { period: string; status: "open" | "closed" | "reopened"; entries: number; closed_at: Date | string | null; reopened_at: Date | string | null; reopen_reason: string | null };

/** Every period from the first entry to this month, with its state. */
export async function periodsOverview(tx: Sql, tenantId: string, today: string): Promise<PeriodRow[]> {
  const first = (await earliestPeriod(tx, tenantId)) ?? periodOf(today);
  const start = first < periodOf(today) ? first : periodOf(today);
  const counts = await tx<{ period: string; n: number }[]>`select period, count(*)::int as n from public.journal_entries where tenant_id = ${tenantId} group by period`;
  const closes = await tx<{ period: string; status: "closed" | "reopened"; closed_at: Date | string; reopened_at: Date | string | null; reopen_reason: string | null }[]>`
    select period, status, closed_at, reopened_at, reopen_reason from public.period_closes where tenant_id = ${tenantId}`;
  const byPeriod = new Map(counts.map((c) => [c.period, c.n]));
  const closeBy = new Map(closes.map((c) => [c.period, c]));
  return periodsBetween(start, periodOf(today))
    .map((period) => {
      const c = closeBy.get(period);
      return { period, status: c?.status ?? "open", entries: byPeriod.get(period) ?? 0, closed_at: c?.closed_at ?? null, reopened_at: c?.reopened_at ?? null, reopen_reason: c?.reopen_reason ?? null } as PeriodRow;
    })
    .reverse();
}

/** Closes a month: it has ended, every earlier month is closed, and its reclass is posted (rule 10). */
export async function closePeriod(tx: Sql, tenantId: string, period: string, today: string): Promise<void> {
  if (!isPeriod(period)) fail("that is not a period");
  if (period >= periodOf(today)) fail(`${period} has not ended yet`);
  const closed = await closedPeriods(tx, tenantId);
  if (closed.has(period)) fail(`${period} is already closed`);
  const first = await earliestPeriod(tx, tenantId);
  if (first && first < period) {
    const open = periodsBetween(first, prevPeriod(period)).filter((p) => !closed.has(p));
    if (open.length) fail(`close ${open[0]} first; periods close in order`);
  }
  await postReclass(tx, tenantId, period);
  const result = await tx`update public.period_closes set status = 'closed' where tenant_id = ${tenantId} and period = ${period} and status = 'reopened'`;
  if (result.count === 0) await tx`insert into public.period_closes (tenant_id, period) values (${tenantId}, ${period})`;
}

/** An owner reopens a closed month with a reason; the database refuses anyone else (rule 10). */
export async function reopenPeriod(tx: Sql, tenantId: string, period: string, reason: string): Promise<void> {
  if (!reason.trim()) fail("reopening a period needs a reason");
  const result = await tx`update public.period_closes set status = 'reopened', reopen_reason = ${reason.trim()} where tenant_id = ${tenantId} and period = ${period} and status = 'closed'`;
  if (result.count === 0) fail(`${period} is not closed`);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export type AccountRow = ReportAccount & { system: boolean; balance_cents: number; lines: number };

export async function accounts(tx: Sql, tenantId: string): Promise<AccountRow[]> {
  const rows = await tx<{ id: string; key: string | null; number: string; name: string; type: AccountType; subtype: string; active: boolean; system: boolean; balance_cents: string | number; lines: number }[]>`
    select g.id, g.key, g.number, g.name, g.type, g.subtype, g.active, g.system,
           coalesce((select sum(l.debit_cents - l.credit_cents) from public.journal_lines l where l.gl_account_id = g.id), 0) as balance_cents,
           (select count(*)::int from public.journal_lines l where l.gl_account_id = g.id) as lines
    from public.gl_accounts g where g.tenant_id = ${tenantId} order by g.number`;
  return rows.map((r) => ({ ...r, balance_cents: Number(r.balance_cents) }));
}

export type EntryListRow = { id: string; number: number; posted_on: string; period: string; source_type: SourceType; memo: string; reverses: string | null; reversed_by: string | null; amount_cents: number; lines: number };

export type EntryFilters = { from?: string; to?: string; source_type?: string; q?: string; account_id?: string; limit?: number };

export async function journalEntries(tx: Sql, tenantId: string, f: EntryFilters): Promise<EntryListRow[]> {
  const rows = await tx<(Omit<EntryListRow, "amount_cents"> & { amount_cents: string | number })[]>`
    select e.id, e.number, e.posted_on, e.period, e.source_type, e.memo, e.reverses, e.reversed_by,
           (select coalesce(sum(l.debit_cents), 0) from public.journal_lines l where l.entry_id = e.id) as amount_cents,
           (select count(*)::int from public.journal_lines l where l.entry_id = e.id) as lines
    from public.journal_entries e
    where e.tenant_id = ${tenantId}
      and (${f.from ?? null}::date is null or e.posted_on >= ${f.from ?? null}::date)
      and (${f.to ?? null}::date is null or e.posted_on <= ${f.to ?? null}::date)
      and (${f.source_type ?? null}::text is null or e.source_type = ${f.source_type ?? null}::text)
      and (${f.q ?? null}::text is null or e.memo ilike ${f.q ? `%${f.q}%` : null}::text or e.number::text = ${f.q ?? null}::text)
      and (${f.account_id ?? null}::uuid is null or exists (select 1 from public.journal_lines l where l.entry_id = e.id and l.gl_account_id = ${f.account_id ?? null}::uuid))
    order by e.posted_on desc, e.number desc limit ${f.limit ?? 200}`;
  return rows.map((r) => ({ ...r, amount_cents: Number(r.amount_cents) }));
}

export type EntryDetail = {
  entry: { id: string; number: number; posted_on: string; period: string; source_type: SourceType; source_id: string | null; source_key: string; memo: string; reverses: string | null; reverses_number: number | null; reversed_by: string | null; reversed_by_number: number | null; posted_by_email: string | null; created_at: Date | string };
  lines: { id: string; position: number; account_id: string; account_number: string; account_name: string; debit_cents: number; credit_cents: number; agreement_id: string | null; agreement_number: number | null; jurisdiction: string | null; memo: string | null }[];
};

export async function journalEntry(tx: Sql, tenantId: string, entryId: string): Promise<EntryDetail | null> {
  const [entry] = await tx<EntryDetail["entry"][]>`
    select e.id, e.number, e.posted_on, e.period, e.source_type, e.source_id, e.source_key, e.memo, e.reverses, r.number as reverses_number, e.reversed_by, b.number as reversed_by_number,
           (select d.email from app.member_directory(e.tenant_id) d where d.user_id = e.posted_by) as posted_by_email, e.created_at
    from public.journal_entries e left join public.journal_entries r on r.id = e.reverses left join public.journal_entries b on b.id = e.reversed_by
    where e.id = ${entryId} and e.tenant_id = ${tenantId}`;
  if (!entry) return null;
  const lines = await tx<(Omit<EntryDetail["lines"][number], "debit_cents" | "credit_cents"> & { debit_cents: string | number; credit_cents: string | number })[]>`
    select l.id, l.position, l.gl_account_id as account_id, g.number as account_number, g.name as account_name, l.debit_cents, l.credit_cents, l.agreement_id, a.number as agreement_number, l.jurisdiction, l.memo
    from public.journal_lines l join public.gl_accounts g on g.id = l.gl_account_id left join public.agreements a on a.id = l.agreement_id
    where l.entry_id = ${entryId} order by l.position`;
  return { entry, lines: lines.map((l) => ({ ...l, debit_cents: Number(l.debit_cents), credit_cents: Number(l.credit_cents) })) };
}

export type LedgerLine = { entry_id: string; number: number; posted_on: string; source_type: SourceType; memo: string; debit_cents: number; credit_cents: number; agreement_number: number | null; jurisdiction: string | null; balance_cents: number };

/** One account's lines in a range with the running balance (debit positive), after the balance carried in. */
export async function accountLedger(tx: Sql, tenantId: string, accountId: string, range: DateRange): Promise<{ opening_cents: number; lines: LedgerLine[]; closing_cents: number }> {
  const [open] = await tx<{ cents: string | number }[]>`
    select coalesce(sum(l.debit_cents - l.credit_cents), 0) as cents from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
    where l.tenant_id = ${tenantId} and l.gl_account_id = ${accountId} and e.posted_on < ${range.from}`;
  const rows = await tx<(Omit<LedgerLine, "debit_cents" | "credit_cents" | "balance_cents"> & { debit_cents: string | number; credit_cents: string | number })[]>`
    select e.id as entry_id, e.number, e.posted_on, e.source_type, e.memo, l.debit_cents, l.credit_cents, a.number as agreement_number, l.jurisdiction
    from public.journal_lines l join public.journal_entries e on e.id = l.entry_id left join public.agreements a on a.id = l.agreement_id
    where l.tenant_id = ${tenantId} and l.gl_account_id = ${accountId} and e.posted_on >= ${range.from} and e.posted_on <= ${range.to}
    order by e.posted_on, e.number, l.position`;
  let balance = Number(open?.cents ?? 0);
  const opening_cents = balance;
  const lines = rows.map((r) => {
    balance += Number(r.debit_cents) - Number(r.credit_cents);
    return { ...r, debit_cents: Number(r.debit_cents), credit_cents: Number(r.credit_cents), balance_cents: balance };
  });
  return { opening_cents, lines, closing_cents: balance };
}

async function reportInputs(tx: Sql, tenantId: string, through: string): Promise<{ accounts: ReportAccount[]; lines: ReportLine[] }> {
  const accts = await tx<ReportAccount[]>`select id, key, number, name, type, subtype, active from public.gl_accounts where tenant_id = ${tenantId} order by number`;
  const lines = await tx<(Omit<ReportLine, "debit_cents" | "credit_cents"> & { debit_cents: string | number; credit_cents: string | number })[]>`
    select l.gl_account_id as account_id, e.posted_on, l.debit_cents, l.credit_cents from public.journal_lines l join public.journal_entries e on e.id = l.entry_id
    where l.tenant_id = ${tenantId} and e.posted_on <= ${through}`;
  return { accounts: accts, lines: lines.map((l) => ({ ...l, debit_cents: Number(l.debit_cents), credit_cents: Number(l.credit_cents) })) };
}

export async function trialBalanceFor(tx: Sql, tenantId: string, range: DateRange): Promise<TrialBalance> {
  const input = await reportInputs(tx, tenantId, range.to);
  return trialBalance(input.accounts, input.lines, range);
}

export async function incomeStatementFor(tx: Sql, tenantId: string, range: DateRange): Promise<IncomeStatement> {
  const input = await reportInputs(tx, tenantId, range.to);
  return incomeStatement(input.accounts, input.lines, range);
}

export async function balanceSheetFor(tx: Sql, tenantId: string, asOf: string): Promise<BalanceSheet> {
  const input = await reportInputs(tx, tenantId, asOf);
  return balanceSheet(input.accounts, input.lines, asOf);
}

export type RollForwardWithNames = RollForward & { names: Map<string, { number: number; account_name: string; billing_mode: string; status: string }> };

export async function rollForwardFor(tx: Sql, tenantId: string, range: DateRange): Promise<RollForwardWithNames> {
  const lines = await contractLines(tx, tenantId);
  const report = rollForward(lines, range);
  const ids = report.rows.map((r) => r.agreement_id);
  const rows = ids.length
    ? await tx<{ id: string; number: number; account_name: string; billing_mode: string; status: string }[]>`
        select a.id, a.number, c.name as account_name, a.billing_mode, a.status from public.agreements a join public.accounts c on c.id = a.account_id where a.tenant_id = ${tenantId} and a.id = any(${ids}::uuid[])`
    : [];
  return { ...report, names: new Map(rows.map((r) => [r.id, r])) };
}

/** The cash-basis view: receipts by their business date, allocated across invoice lines to the line's income account. */
export async function cashBasisFor(tx: Sql, tenantId: string, range: DateRange, timeZone: string): Promise<CashBasisIncome> {
  const receipts = await tx<{ payment_id: string; received_at: Date | string; amount_cents: string | number; kind: "payment" | "refund" }[]>`
    select id as payment_id, received_at, amount_cents, kind from public.payments where tenant_id = ${tenantId} and status in ('succeeded', 'refunded')`;
  const allocations = await tx<{ payment_id: string; invoice_id: string; amount_cents: string | number }[]>`
    select payment_id, invoice_id, amount_cents from public.payment_allocations where tenant_id = ${tenantId}`;
  const lines = await tx<{ invoice_id: string; amount_cents: string | number; tax_cents: string | number; service_line: string | null; agreement_id: string | null; kind: "service" | "fee" | "late_fee"; source: string }[]>`
    select l.invoice_id, l.amount_cents, l.tax_cents, l.service_line, coalesce(l.agreement_id, i.agreement_id) as agreement_id, l.kind, i.source
    from public.invoice_lines l join public.invoices i on i.id = l.invoice_id where l.tenant_id = ${tenantId} and i.status not in ('draft', 'void')`;
  const fees = await tx<{ arrived_on: string; fee_cents: string | number }[]>`select arrived_on, fee_cents from public.payouts where tenant_id = ${tenantId} and status = 'paid'`;
  return cashBasisIncome(
    {
      receipts: receipts.map((r) => ({ payment_id: r.payment_id, received_on: dateInZone(r.received_at, timeZone), amount_cents: Number(r.amount_cents), kind: r.kind })),
      allocations: allocations.map((a) => ({ ...a, amount_cents: Number(a.amount_cents) })),
      lines: lines.map((l) => {
        const account = invoiceLineAccount({ kind: l.kind, agreement_id: l.agreement_id, service_line: l.service_line }, l.source);
        // On a cash basis the contract balance is not a thing: money on an agreement's invoice is that service line's income.
        const income = account === "contract_liability" ? invoiceLineAccount({ kind: l.kind, agreement_id: null, service_line: l.service_line }, l.source) : account;
        return { invoice_id: l.invoice_id, amount_cents: Number(l.amount_cents), tax_cents: Number(l.tax_cents), account: income };
      }),
      fees: fees.map((f) => ({ paid_on: f.arrived_on, fee_cents: Number(f.fee_cents) })),
    },
    range,
  );
}

