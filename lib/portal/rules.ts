// The customer portal's rules that need no database (spec 16), pure: the self-service reschedule (rule 5, all but the
// dispatch check) and the days a customer may pick.
import { addDays, startOfDayInZone, todayInZone } from "@/lib/dates";

export type RescheduleSettings = { allow_reschedule: boolean; reschedule_notice_hours: number; max_stops_per_day: number };
export type RescheduleVisit = { status: string; scheduled_for: string | null; due_start: string; due_end: string; technician_id: string | null };

/** Why a move to `date` is refused, before the dispatch check; empty when the office's rules allow it. */
export function rescheduleProblems(input: { visit: RescheduleVisit; date: string; settings: RescheduleSettings | null; stops: Readonly<Record<string, number>>; now: Date; timeZone: string }): string[] {
  const { visit, date, settings, stops, now, timeZone } = input;
  if (!settings?.allow_reschedule) return ["The company takes reschedules by request."];
  if (visit.status !== "scheduled" || !visit.scheduled_for || !visit.technician_id) return ["Only a scheduled visit can be moved."];
  const problems: string[] = [];
  if (date === visit.scheduled_for) problems.push("That is already the visit's day.");
  if (date < visit.due_start || date > visit.due_end) problems.push(`Pick a day from ${visit.due_start} to ${visit.due_end}.`);
  const notice = now.getTime() + settings.reschedule_notice_hours * 3_600_000;
  if (Date.parse(startOfDayInZone(visit.scheduled_for, timeZone)) < notice || Date.parse(startOfDayInZone(date, timeZone)) < notice) {
    problems.push(`Moves need ${settings.reschedule_notice_hours} hours notice.`);
  }
  if ((stops[date] ?? 0) >= settings.max_stops_per_day) problems.push("That day is full.");
  return problems;
}

/** Every day of the visit's window from today on, with whether the rules allow it, for the date picker. */
export function rescheduleDays(input: Omit<Parameters<typeof rescheduleProblems>[0], "date">): { date: string; problems: string[] }[] {
  const out: { date: string; problems: string[] }[] = [];
  const today = todayInZone(input.timeZone);
  for (let d = input.visit.due_start > today ? input.visit.due_start : today; d <= input.visit.due_end; d = addDays(d, 1)) {
    if (d === input.visit.scheduled_for) continue;
    out.push({ date: d, problems: rescheduleProblems({ ...input, date: d }) });
  }
  return out;
}
