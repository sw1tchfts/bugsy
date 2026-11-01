import Link from "next/link";
import { Button, Field, Input } from "@/components/ui";
import { addDays, addMonths, isIsoDate } from "@/lib/dates";

/** A from/to range from the query, defaulting to the given number of days or months back from today. */
export function rangeOf(params: { from?: string; to?: string }, today: string, back: { days?: number; months?: number }): { from: string; to: string } {
  const to = params.to && isIsoDate(params.to) ? params.to : today;
  const fallback = back.months ? `${addMonths(`${to.slice(0, 7)}-01`, -back.months + 1).slice(0, 7)}-01` : addDays(to, -(back.days ?? 30));
  const from = params.from && isIsoDate(params.from) && params.from <= to ? params.from : fallback;
  return { from, to };
}

export function RangeForm({ from, to, csv }: { from: string; to: string; csv?: string }) {
  return (
    <form method="get" className="flex flex-wrap items-end gap-3">
      <Field label="From" htmlFor="from">
        <Input id="from" name="from" type="date" defaultValue={from} />
      </Field>
      <Field label="To" htmlFor="to">
        <Input id="to" name="to" type="date" defaultValue={to} />
      </Field>
      <Button type="submit" variant="secondary">
        Show
      </Button>
      {csv ? (
        <a href={`${csv}?from=${from}&to=${to}`} className="pb-2 text-sm text-emerald-800 underline" data-testid="report-csv">
          Download CSV
        </a>
      ) : null}
    </form>
  );
}

export function Back() {
  return (
    <p className="text-sm text-stone-500">
      <Link href="/reports" className="hover:underline">
        Reports
      </Link>
    </p>
  );
}

export const share = (v: number | null, digits = 1) => (v === null ? "no data" : `${(v * 100).toFixed(digits)}%`);
