// The messaging providers (spec 11): one interface per channel, a local provider that delivers in the database with no
// keys, and Postmark, Twilio and Lob when their keys are set. Like the payment gateway, every flow runs locally.
import { lobProvider } from "./lob";
import { localProvider } from "./local";
import { postmarkProvider } from "./postmark";
import type { Channel } from "./rules";
import { twilioProvider } from "./twilio";

export type SendResult = { provider_message_id: string | null; status: "sent" | "delivered" | "failed"; error: string | null };

export type EmailOut = { message_id: string; to: string; from: string; reply_to: string | null; subject: string; text: string; html: string | null };
export type SmsOut = { message_id: string; to: string; from: string | null; body: string; status_callback: string | null };
export type LetterOut = { message_id: string; to: { name: string; address: string }; from: { name: string; address: string | null }; html: string };

export interface MessagingProvider {
  readonly name: "local" | "postmark" | "twilio" | "lob";
  sendEmail?(email: EmailOut): Promise<SendResult>;
  sendSms?(sms: SmsOut): Promise<SendResult>;
  sendLetter?(letter: LetterOut): Promise<SendResult>;
}

export type ProviderSettings = { email_provider: string; sms_provider: string; mail_provider: string };

/** The provider for a channel: the company's choice when its keys are set, else the local one. */
export function providerFor(settings: ProviderSettings, channel: Channel): MessagingProvider {
  if (channel === "email" && settings.email_provider === "postmark" && process.env.POSTMARK_SERVER_TOKEN) return postmarkProvider(process.env.POSTMARK_SERVER_TOKEN);
  if (channel === "sms" && settings.sms_provider === "twilio" && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) return twilioProvider(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  if (channel === "mail" && settings.mail_provider === "lob" && process.env.LOB_API_KEY) return lobProvider(process.env.LOB_API_KEY);
  return localProvider;
}
