// Accounting periods are calendar months in the company's time zone (spec 09 rule 9). Pure.
import { addMonths, endOfMonth } from "@/lib/dates";

const PERIOD = /^[0-9]{4}-(0[1-9]|1[0-2])$/;

export function isPeriod(value: string): boolean {
  return PERIOD.test(value);
}

/** The period of a business date. */
export function periodOf(date: string): string {
  return date.slice(0, 7);
}

export function periodStart(period: string): string {
  return `${period}-01`;
}

export function periodEnd(period: string): string {
  return endOfMonth(periodStart(period));
}

export function nextPeriod(period: string): string {
  return periodOf(addMonths(periodStart(period), 1));
}

export function prevPeriod(period: string): string {
  return periodOf(addMonths(periodStart(period), -1));
}

/** Every period from `from` to `to`, inclusive, oldest first. */
export function periodsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let p = from; p <= to; p = nextPeriod(p)) out.push(p);
  return out;
}

/** The last period that has fully ended on the given day. */
export function lastEndedPeriod(today: string): string {
  return prevPeriod(periodOf(today));
}

/** The first day on or after `date` that is not in a closed period: an event in a closed month posts there (rule 9). */
export function firstOpenDay(date: string, closed: ReadonlySet<string>): string {
  let day = date;
  while (closed.has(periodOf(day))) day = periodStart(nextPeriod(periodOf(day)));
  return day;
}

export function formatPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}
