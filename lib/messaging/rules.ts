// The pure rules of messaging (spec 11 rules 2 to 5 and 7): keywords, segments, quiet hours, channel choice, address
// normalization. Strings in, strings out; no database and no clock.
import { phoneDigits } from "@/lib/geo/normalize";

export type Channel = "email" | "sms" | "mail";
export type Keyword = "stop" | "start" | "help";

const STOP = ["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "revoke", "optout", "opt out"];
const START = ["start", "unstop", "yes", "subscribe"];
const HELP = ["help", "info"];

/** A carrier keyword when the whole message is one, case and spacing aside (rule 3). */
export function keyword(body: string): Keyword | null {
  const v = body.trim().toLowerCase().replace(/[\s.!]+/g, " ").trim();
  if (STOP.includes(v)) return "stop";
  if (START.includes(v)) return "start";
  if (HELP.includes(v)) return "help";
  return null;
}

// GSM 03.38 basic set plus its extension table (which costs two septets).
const GSM = new Set("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà".split(""));
const GSM_EXT = new Set("^{}\\[~]|€".split(""));

/** Carrier segments for an SMS body: 160 GSM characters in one, 153 per part when longer; 70 and 67 for Unicode. */
export function smsSegments(body: string): number {
  const chars = [...body];
  const gsm = chars.every((c) => GSM.has(c) || GSM_EXT.has(c));
  if (gsm) {
    const septets = chars.reduce((n, c) => n + (GSM_EXT.has(c) ? 2 : 1), 0);
    return septets <= 160 ? 1 : Math.ceil(septets / 153);
  }
  return chars.length <= 70 ? 1 : Math.ceil(chars.length / 67);
}

function minutesOf(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + (m || 0);
}

/** The wall-clock minute of an instant in a zone, and that zone's date. */
function localClock(at: Date, timeZone: string): { date: string; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, minute: Number(get("hour")) * 60 + Number(get("minute")) };
}

/** True when texts may go out at this instant: between quiet_start and quiet_end in the company's zone (rule 4). An
 *  end before the start wraps midnight; equal times mean texts may go at any hour. */
export function withinQuietHours(at: Date, timeZone: string, window: { start: string; end: string }): boolean {
  const start = minutesOf(window.start);
  const end = minutesOf(window.end);
  if (start === end) return true;
  const { minute } = localClock(at, timeZone);
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}

/** The first instant at or after `at` when a text may go out. */
export function nextAllowed(at: Date, timeZone: string, window: { start: string; end: string }): Date {
  if (withinQuietHours(at, timeZone, window)) return at;
  // Step forward a minute at a time from the next whole minute; at most a day's worth of steps.
  let t = new Date(Math.ceil(at.getTime() / 60_000) * 60_000);
  for (let i = 0; i < 1441; i += 1) {
    if (withinQuietHours(t, timeZone, window)) return t;
    t = new Date(t.getTime() + 60_000);
  }
  return at;
}

export type ContactChannels = { email: string | null; phone: string | null; sms_opt_in: boolean; preferred_channel: string | null };

/** The channel for a visit message (rule 7): the preferred one when usable, else SMS with opt-in, else email. */
export function chooseChannel(contact: ContactChannels, optedOut: { sms: boolean; email: boolean } = { sms: false, email: false }): "sms" | "email" | null {
  const smsOk = Boolean(contact.phone && phoneDigits(contact.phone) && contact.sms_opt_in && !optedOut.sms);
  const emailOk = Boolean(contact.email && !optedOut.email);
  if (contact.preferred_channel === "email" && emailOk) return "email";
  if (contact.preferred_channel === "sms" && smsOk) return "sms";
  if (smsOk) return "sms";
  if (emailOk) return "email";
  return null;
}

/** The form an address is suppressed and matched under: the last ten digits of a phone, or a lower-case email. */
export function normalizeAddress(channel: Channel, address: string): string {
  if (channel === "sms") {
    const d = (phoneDigits(address) ?? address.replace(/\D/g, "")).replace(/\D/g, "");
    return d.length > 10 ? d.slice(-10) : d;
  }
  return address.trim().toLowerCase();
}

/** E.164 for a US number typed any way; null when it is not ten digits (eleven with a leading 1). */
export function e164(phone: string | null | undefined): string | null {
  const d = (phone ?? "").replace(/\D/g, "");
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  return null;
}
