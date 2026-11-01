"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { opt, str } from "@/lib/customers/forms";
import { fromTenantLocal, todayInZone } from "@/lib/dates";
import { errorCode } from "@/lib/db";
import { type Audience, launchCampaign, queueMessage, reply, runMessaging, sendQueued } from "@/lib/messaging/db";
import { e164 } from "@/lib/messaging/rules";
import { TEMPLATE_KEYS, type TemplateKey, checkTemplate } from "@/lib/messaging/templates";

function go(path: string, params: Record<string, string | null | undefined>): never {
  revalidatePath(path.split("?")[0]);
  revalidatePath("/messages");
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  redirect(`${path}${q.toString() ? `?${q}` : ""}`);
}

const back = (formData: FormData, fallback: string) => opt(formData, "return_to") ?? fallback;

/** The messaging job for this company now: reminders, due notices, scheduled campaigns, everything due. */
export async function runMessagingNow(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session, membership } = await requirePermission(tenantId, "messages.send");
  let note: string | null = null;
  let error: string | null = null;
  try {
    const c = await dbAs(session, (tx) => runMessaging(tx, tenantId, membership.tenantTimezone));
    note = `${c.reminders} reminder(s) and ${c.notices} notice(s) queued; ${c.delivered + c.sent} sent, ${c.failed} failed, ${c.suppressed} not sent, ${c.deferred} held for quiet hours.`;
  } catch (err) {
    error = errorCode(err);
  }
  go(back(formData, "/messages"), { note, error });
}

export async function replyAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const inboundId = str(formData, "message_id");
  const body = str(formData, "body");
  const { session, membership } = await requirePermission(tenantId, "messages.send");
  let error: string | null = null;
  if (!body) error = "Type a reply.";
  else {
    try {
      await dbAs(session, (tx) => reply(tx, tenantId, inboundId, body, membership.tenantTimezone));
    } catch (err) {
      error = errorCode(err);
    }
  }
  go(back(formData, "/messages"), { error, note: error ? null : "Reply sent." });
}

export async function markReadAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "messages.send");
  const ids = formData.getAll("message_id").map(String);
  await dbAs(session, (tx) => tx`select app.mark_messages_read(${tenantId}, ${ids}::uuid[])`);
  go(back(formData, "/messages"), {});
}

/** A one-off text or email to a contact from the account page; consent applies as for any message. */
export async function sendMessageAction(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const accountId = str(formData, "account_id");
  const contactId = str(formData, "contact_id");
  const channel = str(formData, "channel") === "email" ? "email" : "sms";
  const body = str(formData, "body");
  const subject = opt(formData, "subject");
  const { session, membership } = await requirePermission(tenantId, "messages.send");
  let error: string | null = null;
  if (!body) error = "Type the message.";
  else {
    try {
      await dbAs(session, async (tx) => {
        const [c] = await tx<{ name: string; email: string | null; phone: string | null; property_id: string | null }[]>`
          select name, email, phone, property_id from public.contacts where id = ${contactId} and tenant_id = ${tenantId} and (account_id = ${accountId} or property_id in (select id from public.properties where account_id = ${accountId}))`;
        if (!c) throw Object.assign(new Error("pick a contact on this account"), { code: "23514" });
        const to = channel === "sms" ? (e164(c.phone) ?? "") : (c.email ?? "");
        const id = await queueMessage(tx, tenantId, { channel, purpose: "other", to_address: to, recipient_name: c.name, subject: channel === "email" ? (subject ?? "A message from us") : null, body, account_id: accountId, property_id: c.property_id, contact_id: contactId });
        await sendQueued(tx, tenantId, new Date(), membership.tenantTimezone, [id]);
      });
    } catch (err) {
      error = errorCode(err);
    }
  }
  go(back(formData, `/customers/${accountId}`), { error, note: error ? null : "Message sent." });
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export async function saveMessagingSettings(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "messages.manage");
  const quietStart = str(formData, "quiet_start") || "08:00";
  const quietEnd = str(formData, "quiet_end") || "21:00";
  const smsNumber = opt(formData, "sms_number");
  let error: string | null = null;
  if (!TIME.test(quietStart) || !TIME.test(quietEnd)) error = "Quiet hours are times like 08:00.";
  else if (smsNumber && !e164(smsNumber)) error = "The texting number is a ten-digit US number.";
  else {
    const bool = (k: string) => formData.get(k) === "true";
    const int = (k: string, d: number) => {
      const n = Number(str(formData, k));
      return Number.isInteger(n) ? n : d;
    };
    try {
      await dbAs(session, async (tx) => {
        await tx`select app.ensure_messaging_settings(${tenantId})`;
        await tx`update public.messaging_settings set ${tx({
          sender_name: opt(formData, "sender_name"),
          reply_to_email: opt(formData, "reply_to_email")?.toLowerCase() ?? null,
          company_phone: opt(formData, "company_phone"),
          sms_number: smsNumber ? e164(smsNumber) : null,
          quiet_start: quietStart,
          quiet_end: quietEnd,
          reminders_enabled: bool("reminders_enabled"),
          reminder_days: int("reminder_days", 1),
          on_the_way_enabled: bool("on_the_way_enabled"),
          summary_enabled: bool("summary_enabled"),
          review_enabled: bool("review_enabled"),
          review_url: opt(formData, "review_url"),
          review_delay_hours: int("review_delay_hours", 2),
          review_every_days: int("review_every_days", 180),
          invoice_email_enabled: bool("invoice_email_enabled"),
          email_provider: str(formData, "email_provider") === "postmark" ? "postmark" : "local",
          sms_provider: str(formData, "sms_provider") === "twilio" ? "twilio" : "local",
          mail_provider: str(formData, "mail_provider") === "lob" ? "lob" : "local",
        })} where tenant_id = ${tenantId}`;
      });
    } catch (err) {
      error = errorCode(err);
    }
  }
  go("/settings/messaging", { error, note: error ? null : "Messaging settings saved." });
}

export async function saveTemplate(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const key = str(formData, "key") as TemplateKey;
  const channel = str(formData, "channel");
  const subject = opt(formData, "subject");
  const body = str(formData, "body");
  const { session } = await requirePermission(tenantId, "messages.manage");
  let error: string | null = null;
  if (!TEMPLATE_KEYS.includes(key) || !["email", "sms", "mail"].includes(channel)) error = "Unknown template.";
  else if (!body) error = "A template needs a body.";
  else {
    const unknown = checkTemplate(key, { subject, body });
    if (unknown.length) error = `Unknown variable${unknown.length > 1 ? "s" : ""}: ${unknown.map((u) => `{{${u}}}`).join(", ")}.`;
  }
  if (!error) {
    try {
      await dbAs(session, (tx) => tx`
        insert into public.message_templates (tenant_id, key, channel, subject, body) values (${tenantId}, ${key}, ${channel}, ${channel === "sms" ? null : subject}, ${body})
        on conflict (tenant_id, key, channel) do update set subject = excluded.subject, body = excluded.body, updated_by = auth.uid()`);
    } catch (err) {
      error = errorCode(err);
    }
  }
  go("/settings/messaging", { error, note: error ? null : "Template saved.", template: `${key}:${channel}` });
}

export async function resetTemplate(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "messages.manage");
  await dbAs(session, (tx) => tx`delete from public.message_templates where tenant_id = ${tenantId} and key = ${str(formData, "key")} and channel = ${str(formData, "channel")}`);
  go("/settings/messaging", { note: "Back to the built-in template." });
}

function audienceFrom(formData: FormData): Audience {
  const n = (k: string) => {
    const v = opt(formData, k);
    return v && /^\d+$/.test(v) ? Number(v) : null;
  };
  return { account_type: opt(formData, "account_type"), state_code: opt(formData, "state_code")?.toUpperCase() ?? null, service_line: opt(formData, "service_line"), no_visit_days: n("no_visit_days"), ending_within_days: n("ending_within_days") };
}

export async function createCampaign(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "messages.manage");
  const channel = str(formData, "channel") === "email" ? "email" : "sms";
  const name = str(formData, "name");
  const subject = opt(formData, "subject");
  const body = str(formData, "body");
  let error: string | null = null;
  let id: string | null = null;
  const unknown = checkTemplate("campaign", { subject, body });
  if (!name || !body) error = "A campaign needs a name and a message.";
  else if (unknown.length) error = `Unknown variable${unknown.length > 1 ? "s" : ""}: ${unknown.map((u) => `{{${u}}}`).join(", ")}.`;
  else {
    try {
      const [row] = await dbAs(session, (tx) => tx<{ id: string }[]>`
        insert into public.campaigns (tenant_id, name, channel, subject, body, audience) values (${tenantId}, ${name}, ${channel}, ${channel === "email" ? (subject ?? name) : null}, ${body}, ${tx.json(audienceFrom(formData))}) returning id`);
      id = row.id;
    } catch (err) {
      error = errorCode(err);
    }
  }
  go(id ? `/messages/campaigns/${id}` : "/messages/campaigns", { error });
}

export async function sendCampaignNow(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const campaignId = str(formData, "campaign_id");
  const { session, membership } = await requirePermission(tenantId, "messages.manage");
  let error: string | null = null;
  let note: string | null = null;
  try {
    const r = await dbAs(session, async (tx) => {
      const launched = await launchCampaign(tx, tenantId, campaignId, todayInZone(membership.tenantTimezone));
      const sent = await sendQueued(tx, tenantId, new Date(), membership.tenantTimezone, launched.ids);
      return { launched, sent };
    });
    note = `${r.launched.queued} queued of ${r.launched.audience} in the audience (${r.launched.skipped} with no address); ${r.sent.delivered + r.sent.sent} sent, ${r.sent.suppressed} not sent, ${r.sent.deferred} held for quiet hours.`;
  } catch (err) {
    error = errorCode(err);
  }
  go(`/messages/campaigns/${campaignId}`, { error, note });
}

export async function scheduleCampaign(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const campaignId = str(formData, "campaign_id");
  const { session, membership } = await requirePermission(tenantId, "messages.manage");
  const at = fromTenantLocal(str(formData, "scheduled_for"), membership.tenantTimezone);
  let error: string | null = null;
  if (!at) error = "Pick a day and time.";
  else {
    try {
      await dbAs(session, (tx) => tx`update public.campaigns set status = 'scheduled', scheduled_for = ${at} where id = ${campaignId} and tenant_id = ${tenantId} and status in ('draft', 'scheduled')`);
    } catch (err) {
      error = errorCode(err);
    }
  }
  go(`/messages/campaigns/${campaignId}`, { error, note: error ? null : "Scheduled." });
}

export async function cancelCampaign(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const campaignId = str(formData, "campaign_id");
  const { session } = await requirePermission(tenantId, "messages.manage");
  await dbAs(session, (tx) => tx`update public.campaigns set status = 'cancelled' where id = ${campaignId} and tenant_id = ${tenantId} and status in ('draft', 'scheduled')`);
  go(`/messages/campaigns/${campaignId}`, { note: "Cancelled." });
}
