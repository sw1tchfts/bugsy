// The local provider: delivers at once in the database, with test addresses that fail, so the flows run with no keys.
// An email to a domain ending in .bounce.test bounces; an SMS to a number ending 0000 fails. Nothing leaves the machine.
import { createHash } from "node:crypto";
import type { EmailOut, LetterOut, MessagingProvider, SendResult, SmsOut } from "./providers";

const id = (prefix: string, key: string) => `${prefix}_${createHash("sha256").update(key).digest("hex").slice(0, 20)}`;

export const localProvider: MessagingProvider = {
  name: "local",
  async sendEmail(email: EmailOut): Promise<SendResult> {
    if (/\.bounce\.test$/i.test(email.to.trim())) return { provider_message_id: id("local_em", email.message_id), status: "failed", error: "bounced" };
    return { provider_message_id: id("local_em", email.message_id), status: "delivered", error: null };
  },
  async sendSms(sms: SmsOut): Promise<SendResult> {
    if (/0000$/.test(sms.to.replace(/\D/g, ""))) return { provider_message_id: id("local_sm", sms.message_id), status: "failed", error: "unreachable" };
    return { provider_message_id: id("local_sm", sms.message_id), status: "delivered", error: null };
  },
  async sendLetter(letter: LetterOut): Promise<SendResult> {
    return { provider_message_id: id("local_ltr", letter.message_id), status: "sent", error: null };
  },
};
