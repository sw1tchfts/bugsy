// Autopay timing (spec 08 rule 8): the first charge on the due date, then one retry per configured interval after
// each failure, never two tries on one plan date and never more tries than the plan allows. Pure and tested.
import { addDays } from "@/lib/dates";

/** One try so far; attempted_at is the business date (or instant) of the try, in the company's zone. */
export type AttemptRow = { attempt: number; scheduled_for: string; attempted_at: string | null; result: "succeeded" | "failed" | "skipped" | null };

export type NextAttempt = { attempt: number; scheduled_for: string };

/** The plan's dates: due date, then each retry interval added to the previous failure's date. */
export function attemptsPlan(dueOn: string, retryDays: readonly number[]): string[] {
  const dates = [dueOn];
  let last = dueOn;
  for (const days of retryDays) {
    last = addDays(last, Math.max(1, Math.floor(days)));
    dates.push(last);
  }
  return dates;
}

/**
 * The attempt to make today, if any: none while an attempt succeeded, is pending, or the plan is spent; the first on or
 * after the due date; a retry the configured days after the last failure (so a late job catches up without stacking).
 */
export function nextAttempt(attempts: readonly AttemptRow[], dueOn: string, retryDays: readonly number[], today: string): NextAttempt | null {
  const done = [...attempts].sort((a, b) => a.attempt - b.attempt);
  if (done.some((a) => a.result === "succeeded" || (a.attempted_at !== null && a.result === null))) return null;
  const tries = done.filter((a) => a.result === "failed" || a.result === "skipped");
  if (tries.length === 0) return today >= dueOn ? { attempt: 1, scheduled_for: dueOn } : null;
  if (tries.length > retryDays.length) return null;
  const last = tries[tries.length - 1];
  const failedOn = (last.attempted_at ?? last.scheduled_for).slice(0, 10);
  const scheduled = addDays(failedOn, Math.max(1, Math.floor(retryDays[tries.length - 1])));
  if (today < scheduled) return null;
  return { attempt: last.attempt + 1, scheduled_for: scheduled };
}

/** Attempts a plan allows in all: the first try plus one per retry interval. */
export function maxAttempts(retryDays: readonly number[]): number {
  return 1 + retryDays.length;
}
