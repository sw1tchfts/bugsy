/** Formats a business date held as "yyyy-mm-dd" for display without routing it through a time zone. */
export function formatBusinessDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const [, year, month, day] = match;
  return `${Number(month)}/${Number(day)}/${year}`;
}

/**
 * Converts a wall-clock value typed by someone in the tenant's zone ("yyyy-mm-dd" or "yyyy-mm-ddThh:mm[:ss]")
 * into the instant it names there. Returns null when the input does not parse.
 */
export function fromTenantLocal(wall: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(wall.trim());
  if (!match) return null;
  const [year, month, day, hour = "0", minute = "0", second = "0"] = match.slice(1);
  const asIfUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  if (Number.isNaN(asIfUtc)) return null;
  // Two passes settle the answer when the zone's offset changes between the first guess and the real instant.
  let instant = asIfUtc - zoneOffsetMs(asIfUtc, timeZone);
  instant = asIfUtc - zoneOffsetMs(instant, timeZone);
  return new Date(instant);
}

/** The zone's offset from UTC at the given instant, in milliseconds (positive east of UTC). */
function zoneOffsetMs(at: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const local = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return local - Math.floor(at / 1000) * 1000;
}

/** Today's business date ("yyyy-mm-dd") in the given time zone. */
export function todayInZone(timeZone: string): string {
  return dateInZone(new Date(), timeZone);
}

/** The business date ("yyyy-mm-dd") an instant falls on in the given time zone. */
export function dateInZone(value: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

/** The last instant of a business date in the given time zone, as an ISO string. */
export function endOfDayInZone(iso: string, timeZone: string): string {
  const end = fromTenantLocal(`${iso}T23:59:59`, timeZone);
  if (!end) throw new Error(`not a business date: ${iso}`);
  return end.toISOString();
}

/** The first instant of a business date in the given time zone, as an ISO string. */
export function startOfDayInZone(iso: string, timeZone: string): string {
  const start = fromTenantLocal(`${iso}T00:00:00`, timeZone);
  if (!start) throw new Error(`not a business date: ${iso}`);
  return start.toISOString();
}

/** Moves a business date by Monday-to-Friday business days; holidays are a state pack question. */
export function addBusinessDays(iso: string, days: number): string {
  let current = iso;
  let left = Math.abs(days);
  const step = days < 0 ? -1 : 1;
  while (left > 0) {
    current = addDays(current, step);
    const weekday = new Date(toUtc(current)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return current;
}

// Civil-date arithmetic on "yyyy-mm-dd" strings. Business dates never become JavaScript Dates in local time;
// the UTC calendar is used only as a calculator and the result is a string again.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date written yyyy-mm-dd: February 30 is not one. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))));
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function toUtc(iso: string): number {
  const match = ISO_DATE.exec(iso);
  if (!match) throw new Error(`not a business date: ${iso}`);
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return fromUtc(toUtc(iso) + days * 86_400_000);
}

/** Adds calendar months, clamping the day to the end of a shorter month (Jan 31 plus 1 month is Feb 28 or 29). */
export function addMonths(iso: string, months: number): string {
  const d = new Date(toUtc(iso));
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return fromUtc(target.getTime());
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: string): string {
  const d = new Date(toUtc(iso));
  return fromUtc(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

/** Calendar month number, 1 to 12. */
export function monthOf(iso: string): number {
  return Number(iso.slice(5, 7));
}

/** Whole days from a to b; negative when b is earlier. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export function minIso(a: string, b: string): string {
  return a <= b ? a : b;
}

export function maxIso(a: string, b: string): string {
  return a >= b ? a : b;
}

/** Formats an instant (timestamptz) as a short US date in the given time zone. */
export function formatInstantDate(value: string | Date, timeZone: string): string {
  return new Date(value).toLocaleDateString("en-US", { timeZone });
}

/** Formats an instant (timestamptz) as a short US date and time in the given time zone. */
export function formatInstant(value: string | Date, timeZone: string): string {
  return new Date(value).toLocaleString("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" });
}
