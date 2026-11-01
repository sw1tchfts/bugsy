// Straight-line recognition (spec 15 rule 2), pure: each billed amount is earned evenly by day over the term it pays
// for, from that term's start to the next term's start. Warranties use it; their visits earn nothing on completion.
import { addMonths, daysBetween, endOfMonth } from "@/lib/dates";

export type Billed = { date: string; amount_cents: number };

/** Cents earned through `through` (inclusive), each amount rounded half up on its own so a finished term is exact. */
export function straightLineRecognized(billed: readonly Billed[], termMonths: number, through: string): number {
  let total = 0;
  for (const b of billed) {
    if (b.date > through) continue;
    const end = addMonths(b.date, termMonths);
    const span = daysBetween(b.date, end);
    const elapsed = Math.min(span, daysBetween(b.date, through) + 1);
    total += elapsed >= span ? b.amount_cents : Math.round((b.amount_cents * elapsed) / span);
  }
  return total;
}

export type MonthRecognition = { month: string; through: string; cents: number };

/** What each month from `fromMonth` to `toMonth` earns: the change in the cumulative amount over that month. */
export function recognitionByMonth(billed: readonly Billed[], termMonths: number, fromMonth: string, toMonth: string, stopAfter: string | null = null): MonthRecognition[] {
  const out: MonthRecognition[] = [];
  let before = straightLineRecognized(billed, termMonths, addDayBefore(`${fromMonth}-01`));
  for (let m = fromMonth; m <= toMonth; m = addMonths(`${m}-01`, 1).slice(0, 7)) {
    const monthEnd = endOfMonth(`${m}-01`);
    const through = stopAfter && stopAfter < monthEnd ? stopAfter : monthEnd;
    const now = straightLineRecognized(billed, termMonths, through);
    out.push({ month: m, through, cents: now - before });
    before = now;
    if (stopAfter && stopAfter <= monthEnd) break;
  }
  return out;
}

function addDayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
