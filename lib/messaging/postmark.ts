// Postmark for email (spec 11): send, and read its delivery, bounce and complaint webhooks.
import type { EmailOut, MessagingProvider, SendResult } from "./providers";

export type PostmarkEvent = { RecordType?: string; MessageID?: string; Email?: string; Recipient?: string; Type?: string; Description?: string };

/** What a Postmark webhook says happened, as the outbox records it, and whether the address must be suppressed. */
export function postmarkOutcome(event: PostmarkEvent): { status: "delivered" | "failed" | null; suppress: "bounce" | "complaint" | null; address: string | null } {
  const address = (event.Recipient ?? event.Email ?? null)?.toLowerCase() ?? null;
  switch (event.RecordType) {
    case "Delivery":
      return { status: "delivered", suppress: null, address };
    case "Bounce":
      return { status: "failed", suppress: event.Type === "HardBounce" || event.Type === "SpamNotification" ? "bounce" : null, address };
    case "SpamComplaint":
      return { status: null, suppress: "complaint", address };
    default:
      return { status: null, suppress: null, address };
  }
}

export function postmarkProvider(serverToken: string): MessagingProvider {
  return {
    name: "postmark",
    async sendEmail(email: EmailOut): Promise<SendResult> {
      const res = await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: { "x-postmark-server-token": serverToken, accept: "application/json", "content-type": "application/json" },
        body: JSON.stringify({ From: email.from, To: email.to, ReplyTo: email.reply_to ?? undefined, Subject: email.subject, TextBody: email.text, HtmlBody: email.html ?? undefined, MessageStream: "outbound", Metadata: { bugsy_message_id: email.message_id } }),
      });
      const json = (await res.json().catch(() => ({}))) as { MessageID?: string; ErrorCode?: number; Message?: string };
      if (!res.ok || json.ErrorCode) return { provider_message_id: json.MessageID ?? null, status: "failed", error: json.Message ?? `postmark ${res.status}` };
      return { provider_message_id: json.MessageID ?? null, status: "sent", error: null };
    },
  };
}
