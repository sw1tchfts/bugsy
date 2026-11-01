// Straight-line recognition (spec 15 rule 2), pure. A warranty's fee for a term is earned evenly by day over that term,
// from the term's start to the next term's start, whatever the billing mode; its visits earn nothing on completion.
// The ledger posts, for each ended month, what was earned through the month's end less what is already posted, so a
// price change or a cancellation's true-up never leaves the contract balance off.
import { addMonths, daysBetween, endOfMonth } from "@/lib/dates";

/** One term: [start, end) and the fee sold for it. */
export type Term = { start: string; end: string; cents: number };

/**
 * The agreement's terms: term k runs from starts_on plus k terms to the next term's start, one per term so far
 * (renewals plus one). A term's fee is the price of the initial and recurring visits the plan put in it, cancelled and
 * skipped ones included: the term was sold at that price.
 */
export function warrantyTerms(startsOn: string, termMonths: number, renewals: number, visits: readonly { kind: string; due_start: string; price_cents: number | string | bigint }[]): Term[] {
  const terms: Term[] = [];
  for (let k = 0; k <= renewals; k += 1) {
    const start = addMonths(startsOn, k * termMonths);
    const end = addMonths(startsOn, (k + 1) * termMonths);
    const cents = visits
      .filter((v) => (v.kind === "initial" || v.kind === "recurring") && v.due_start >= start && v.due_start < end)
      .reduce((sum, v) => sum + Number(v.price_cents), 0);
    terms.push({ start, end, cents });
  }
  return terms;
}

/** Cents earned through `through` (inclusive), each term rounded half up on its own so a finished term is exact. */
export function straightLineRecognized(terms: readonly Term[], through: string): number {
  let total = 0;
  for (const t of terms) {
    if (t.start > through || t.cents === 0) continue;
    const span = daysBetween(t.start, t.end);
    const elapsed = Math.min(span, daysBetween(t.start, through) + 1);
    total += elapsed >= span ? t.cents : Math.round((t.cents * elapsed) / span);
  }
  return total;
}

export type MonthRecognition = { month: string; through: string; earned: number };

/** The running total earned through the end of each month from `fromMonth` to `toMonth`, stopping at `stopAfter`. */
export function earnedByMonth(terms: readonly Term[], fromMonth: string, toMonth: string, stopAfter: string | null = null): MonthRecognition[] {
  const out: MonthRecognition[] = [];
  for (let m = fromMonth; m <= toMonth; m = addMonths(`${m}-01`, 1).slice(0, 7)) {
    const monthEnd = endOfMonth(`${m}-01`);
    const through = stopAfter && stopAfter < monthEnd ? stopAfter : monthEnd;
    out.push({ month: m, through, earned: straightLineRecognized(terms, through) });
    if (stopAfter && stopAfter <= monthEnd) break;
  }
  return out;
}
