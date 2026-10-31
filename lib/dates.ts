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
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Formats an instant (timestamptz) as a short US date in the given time zone. */
export function formatInstantDate(value: string | Date, timeZone: string): string {
  return new Date(value).toLocaleDateString("en-US", { timeZone });
}

/** Formats an instant (timestamptz) as a short US date and time in the given time zone. */
export function formatInstant(value: string | Date, timeZone: string): string {
  return new Date(value).toLocaleString("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" });
}
