// Twilio for SMS (spec 11): send with a status callback, verify webhook signatures, read inbound messages and statuses.
import { createHmac, timingSafeEqual } from "node:crypto";
import { providerSignal } from "./http";
import type { MessagingProvider, SendResult, SmsOut } from "./providers";

/** Twilio's request signature: HMAC-SHA1 of the full URL followed by each POST parameter's name and value, sorted by
 *  name, keyed with the auth token, Base64 (Twilio's security documentation). */
export function twilioSignature(authToken: string, url: string, params: Readonly<Record<string, string>>): string {
  const data = url + Object.keys(params).sort().map((k) => `${k}${params[k]}`).join("");
  return createHmac("sha1", authToken).update(data, "utf8").digest("base64");
}

export function validTwilioSignature(authToken: string, url: string, params: Readonly<Record<string, string>>, header: string | null): boolean {
  if (!header) return false;
  const expected = Buffer.from(twilioSignature(authToken, url, params));
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Twilio's message statuses, as the outbox records them. */
export function twilioStatus(status: string): "sent" | "delivered" | "failed" | null {
  if (status === "delivered" || status === "read") return "delivered";
  if (status === "sent" || status === "queued" || status === "accepted" || status === "sending") return "sent";
  if (status === "failed" || status === "undelivered") return "failed";
  return null;
}

export function twilioProvider(accountSid: string, authToken: string): MessagingProvider {
  return {
    name: "twilio",
    async sendSms(sms: SmsOut): Promise<SendResult> {
      if (!sms.from) return { provider_message_id: null, status: "failed", error: "the company has no texting number" };
      const body = new URLSearchParams({ To: sms.to, From: sms.from, Body: sms.body });
      if (sms.status_callback) body.set("StatusCallback", sms.status_callback);
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: "POST",
        signal: providerSignal(),
        headers: { authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
        body,
      });
      const json = (await res.json().catch(() => ({}))) as { sid?: string; status?: string; message?: string; code?: number };
      if (!res.ok || !json.sid) return { provider_message_id: null, status: "failed", error: json.message ?? `twilio ${res.status}` };
      return { provider_message_id: json.sid, status: twilioStatus(json.status ?? "queued") ?? "sent", error: null };
    },
  };
}
