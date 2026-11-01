// Lob for printed and mailed letters (spec 11): paper notices for customers without electronic consent.
import { providerSignal } from "./http";
import type { LetterOut, MessagingProvider, SendResult } from "./providers";

/** Splits "line1, city ST 12345" into Lob's fields; the last comma separates the city line. */
export function lobAddress(name: string, address: string): Record<string, string> {
  const parts = address.split(",").map((p) => p.trim()).filter(Boolean);
  const cityLine = parts.pop() ?? "";
  const m = /^(.*?)\s+([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/.exec(cityLine);
  return { name, address_line1: parts[0] ?? address, address_line2: parts.slice(1).join(", "), address_city: m?.[1] ?? cityLine, address_state: m?.[2] ?? "", address_zip: m?.[3] ?? "", address_country: "US" };
}

export function lobProvider(apiKey: string): MessagingProvider {
  return {
    name: "lob",
    async sendLetter(letter: LetterOut): Promise<SendResult> {
      const prefix = (o: Record<string, string>, p: string) => Object.fromEntries(Object.entries(o).map(([k, v]) => [`${p}[${k}]`, v]));
      const body = new URLSearchParams({ ...prefix(lobAddress(letter.to.name, letter.to.address), "to"), ...prefix(lobAddress(letter.from.name, letter.from.address ?? ""), "from"), file: `<html><body>${letter.html}</body></html>`, color: "false", use_type: "operational" });
      const res = await fetch("https://api.lob.com/v1/letters", {
        method: "POST",
        signal: providerSignal(),
        headers: { authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded", "idempotency-key": letter.message_id },
        body,
      });
      const json = (await res.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
      if (!res.ok || !json.id) return { provider_message_id: null, status: "failed", error: json.error?.message ?? `lob ${res.status}` };
      return { provider_message_id: json.id, status: "sent", error: null };
    },
  };
}
