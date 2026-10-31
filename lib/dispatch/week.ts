// Week arithmetic on business dates. Weeks run Monday to Sunday.
import { addDays } from "@/lib/dates";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function weekday(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** The Monday on or before the date. */
export function weekOf(iso: string): string {
  const offset = (weekday(iso) + 6) % 7;
  return addDays(iso, -offset);
}

/** The seven days starting on `start`. */
export function weekDays(start: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function dayLabel(iso: string): string {
  return `${DAY_NAMES[weekday(iso)]} ${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
}

export function isWeekend(iso: string): boolean {
  const day = weekday(iso);
  return day === 0 || day === 6;
}
