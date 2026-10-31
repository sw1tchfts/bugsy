/** Formats a business date held as "yyyy-mm-dd" for display without routing it through a time zone. */
export function formatBusinessDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso;
  const [, year, month, day] = match;
  return `${Number(month)}/${Number(day)}/${year}`;
}

/** Formats an instant (timestamptz) as a short US date in the given time zone. */
export function formatInstantDate(value: string | Date, timeZone: string): string {
  return new Date(value).toLocaleDateString("en-US", { timeZone });
}

/** Formats an instant (timestamptz) as a short US date and time in the given time zone. */
export function formatInstant(value: string | Date, timeZone: string): string {
  return new Date(value).toLocaleString("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" });
}
