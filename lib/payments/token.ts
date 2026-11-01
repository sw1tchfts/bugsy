// What a card form hands the server (spec 08, spec 16 rule 3), pure. With Stripe the browser turns the card into a
// payment method id with Stripe.js and the number never reaches this server; the local test gateway takes the typed
// digits as its token instead. Card numbers are never logged or stored either way.
import type { GatewayKind } from "./gateway";

export type TokenFields = { kind?: string | null; number?: string | null; month?: string | null; year?: string | null; token?: string | null };
export type TokenResult = { ok: true; token: string | null } | { ok: false; error: string };

const clean = (v: string | null | undefined) => (v ?? "").replace(/[\s-]+/g, "");

/** The gateway token for the form's fields; `token: null` when nothing was entered (an optional card). */
export function paymentToken(gateway: GatewayKind, f: TokenFields): TokenResult {
  if (gateway === "stripe") {
    const token = (f.token ?? "").trim();
    if (clean(f.number)) return { ok: false, error: "Card numbers are entered in the secure card field only." };
    if (!token) return { ok: true, token: null };
    return /^pm_[A-Za-z0-9]{8,}$/.test(token) ? { ok: true, token } : { ok: false, error: "The card could not be read; enter it again." };
  }
  const number = clean(f.number);
  if (!number) return { ok: true, token: null };
  if (f.kind === "bank") return /^\d{4,17}$/.test(number) ? { ok: true, token: `bank:${number}` } : { ok: false, error: "Enter the bank account number." };
  const month = Number(clean(f.month));
  const year = clean(f.year);
  if (!/^\d{12,19}$/.test(number)) return { ok: false, error: "That card number does not look right." };
  if (!Number.isInteger(month) || month < 1 || month > 12 || !/^\d{4}$/.test(year)) return { ok: false, error: "Enter the card's expiry month and year." };
  return { ok: true, token: `card:${number}:${month}:${year}` };
}
