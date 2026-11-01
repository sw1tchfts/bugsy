// Financial statements read straight from the journal (spec 09 rule 16). Pure and tested. Amounts are signed with the
// account's normal balance: a debit-normal account reports debits as positive, a credit-normal account credits.
import type { AccountType } from "./chart";
import { normalBalance } from "./chart";
import type { ContractLine } from "./post";
import { contractPositions } from "./post";

export type ReportAccount = { id: string; key: string | null; number: string; name: string; type: AccountType; subtype: string; active: boolean };
export type ReportLine = { account_id: string; posted_on: string; debit_cents: number; credit_cents: number };
export type DateRange = { from: string; to: string };

export type TrialBalanceRow = { account: ReportAccount; opening_cents: number; debit_cents: number; credit_cents: number; closing_cents: number };
export type TrialBalance = { rows: TrialBalanceRow[]; debit_total_cents: number; credit_total_cents: number; closing_debit_cents: number; closing_credit_cents: number; balanced: boolean };

function byNumber(a: ReportAccount, b: ReportAccount): number {
  return a.number.localeCompare(b.number);
}

/** Per account: the balance carried in, the period's debits and credits, and the balance carried out (debit positive). */
export function trialBalance(accounts: readonly ReportAccount[], lines: readonly ReportLine[], range: DateRange): TrialBalance {
  const rows = new Map<string, TrialBalanceRow>();
  for (const a of accounts) rows.set(a.id, { account: a, opening_cents: 0, debit_cents: 0, credit_cents: 0, closing_cents: 0 });
  for (const l of lines) {
    const row = rows.get(l.account_id);
    if (!row || l.posted_on > range.to) continue;
    if (l.posted_on < range.from) row.opening_cents += l.debit_cents - l.credit_cents;
    else {
      row.debit_cents += l.debit_cents;
      row.credit_cents += l.credit_cents;
    }
  }
  const out = [...rows.values()].filter((r) => r.account.active || r.opening_cents !== 0 || r.debit_cents !== 0 || r.credit_cents !== 0).sort((a, b) => byNumber(a.account, b.account));
  let debit_total_cents = 0;
  let credit_total_cents = 0;
  let closing_debit_cents = 0;
  let closing_credit_cents = 0;
  for (const r of out) {
    r.closing_cents = r.opening_cents + r.debit_cents - r.credit_cents;
    debit_total_cents += r.debit_cents;
    credit_total_cents += r.credit_cents;
    if (r.closing_cents > 0) closing_debit_cents += r.closing_cents;
    else closing_credit_cents -= r.closing_cents;
  }
  return { rows: out, debit_total_cents, credit_total_cents, closing_debit_cents, closing_credit_cents, balanced: debit_total_cents === credit_total_cents && closing_debit_cents === closing_credit_cents };
}

export type StatementRow = { account: ReportAccount; amount_cents: number };

/** Signed activity per account over the lines given, in the account's normal balance. */
function activity(accounts: readonly ReportAccount[], lines: readonly ReportLine[], keep: (l: ReportLine) => boolean): Map<string, number> {
  const sums = new Map<string, number>();
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const l of lines) {
    if (!keep(l)) continue;
    const a = byId.get(l.account_id);
    if (!a) continue;
    const signed = normalBalance(a.type) === "debit" ? l.debit_cents - l.credit_cents : l.credit_cents - l.debit_cents;
    sums.set(a.id, (sums.get(a.id) ?? 0) + signed);
  }
  return sums;
}

function rowsFor(accounts: readonly ReportAccount[], sums: Map<string, number>, type: AccountType): StatementRow[] {
  return accounts
    .filter((a) => a.type === type && (a.active || (sums.get(a.id) ?? 0) !== 0))
    .sort(byNumber)
    .map((a) => ({ account: a, amount_cents: sums.get(a.id) ?? 0 }));
}

export type IncomeStatement = { revenue: StatementRow[]; expenses: StatementRow[]; revenue_cents: number; expenses_cents: number; net_income_cents: number };

export function incomeStatement(accounts: readonly ReportAccount[], lines: readonly ReportLine[], range: DateRange): IncomeStatement {
  const sums = activity(accounts, lines, (l) => l.posted_on >= range.from && l.posted_on <= range.to);
  const revenue = rowsFor(accounts, sums, "revenue");
  const expenses = rowsFor(accounts, sums, "expense");
  const revenue_cents = revenue.reduce((s, r) => s + r.amount_cents, 0);
  const expenses_cents = expenses.reduce((s, r) => s + r.amount_cents, 0);
  return { revenue, expenses, revenue_cents, expenses_cents, net_income_cents: revenue_cents - expenses_cents };
}

export type BalanceSheet = {
  assets: StatementRow[];
  liabilities: StatementRow[];
  equity: StatementRow[];
  assets_cents: number;
  liabilities_cents: number;
  equity_cents: number;
  net_income_cents: number;
  total_equity_cents: number;
  balanced: boolean;
};

/** As of a day: assets against liabilities and equity, with income to date as equity (rule 16). */
export function balanceSheet(accounts: readonly ReportAccount[], lines: readonly ReportLine[], asOf: string): BalanceSheet {
  const sums = activity(accounts, lines, (l) => l.posted_on <= asOf);
  const assets = rowsFor(accounts, sums, "asset");
  const liabilities = rowsFor(accounts, sums, "liability");
  const equity = rowsFor(accounts, sums, "equity");
  const income = rowsFor(accounts, sums, "revenue").reduce((s, r) => s + r.amount_cents, 0) - rowsFor(accounts, sums, "expense").reduce((s, r) => s + r.amount_cents, 0);
  const assets_cents = assets.reduce((s, r) => s + r.amount_cents, 0);
  const liabilities_cents = liabilities.reduce((s, r) => s + r.amount_cents, 0);
  const equity_cents = equity.reduce((s, r) => s + r.amount_cents, 0);
  const total_equity_cents = equity_cents + income;
  return { assets, liabilities, equity, assets_cents, liabilities_cents, equity_cents, net_income_cents: income, total_equity_cents, balanced: assets_cents === liabilities_cents + total_equity_cents };
}

export type RollForwardRow = { agreement_id: string; opening_cents: number; billed_cents: number; recognized_cents: number; closing_cents: number; deferred_cents: number; asset_cents: number };
export type RollForward = { rows: RollForwardRow[]; opening_cents: number; billed_cents: number; recognized_cents: number; closing_cents: number; deferred_cents: number; asset_cents: number };

/** The deferred revenue roll-forward for a period: where each agreement's balance started, what moved it, where it ended. */
export function rollForward(lines: readonly ContractLine[], range: DateRange): RollForward {
  const before = new Map(contractPositions(lines.filter((l) => l.posted_on < range.from)).map((p) => [p.agreement_id, p.position_cents]));
  const through = contractPositions(lines, range.to);
  const ids = new Set<string>([...before.keys(), ...through.map((p) => p.agreement_id)]);
  const rows: RollForwardRow[] = [];
  for (const id of [...ids].sort()) {
    const opening = before.get(id) ?? 0;
    const end = through.find((p) => p.agreement_id === id);
    const closing = end?.position_cents ?? opening;
    let billed = 0;
    let recognized = 0;
    for (const l of lines) {
      if (l.agreement_id !== id || l.kind === "presentation" || l.posted_on < range.from || l.posted_on > range.to) continue;
      if (l.kind === "billing") billed += l.credit_cents - l.debit_cents;
      else recognized += l.debit_cents - l.credit_cents;
    }
    rows.push({ agreement_id: id, opening_cents: opening, billed_cents: billed, recognized_cents: recognized, closing_cents: closing, deferred_cents: Math.max(0, closing), asset_cents: Math.max(0, -closing) });
  }
  const sum = (pick: (r: RollForwardRow) => number) => rows.reduce((s, r) => s + pick(r), 0);
  return { rows, opening_cents: sum((r) => r.opening_cents), billed_cents: sum((r) => r.billed_cents), recognized_cents: sum((r) => r.recognized_cents), closing_cents: sum((r) => r.closing_cents), deferred_cents: sum((r) => r.deferred_cents), asset_cents: sum((r) => r.asset_cents) };
}
