// Messaging in the database (spec 11): settings, queueing through app.queue_message, sending with consent, opt-outs
// and quiet hours checked at send time, inbound texts and carrier keywords, the automations, notices, campaigns and
// the reads the pages need. Writes go through the definer functions, so a technician's on-the-way text and the
// office's reply follow the same rules as the job.
import { randomBytes } from "node:crypto";
import type postgres from "postgres";
import type { NoticeKind } from "@/lib/compliance/notices";
import { addDays, todayInZone } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { loadRouteVisit } from "@/lib/tech/route-db";
import { type CompanyFacts, noticeHtml, noticeText, summaryHtml, summaryText } from "./content";
import { providerFor } from "./providers";
import { type Channel, chooseChannel, e164, keyword, nextAllowed, normalizeAddress, smsSegments, withinQuietHours } from "./rules";
import { type TemplateKey, checkTemplate, render, templateFor, textToHtml } from "./templates";

type Sql = postgres.Sql | postgres.TransactionSql;

export const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const fromEmail = () => process.env.MESSAGING_FROM_EMAIL ?? "messages@bugsy.local";

export type MessagingSettings = {
  tenant_id: string;
  sender_name: string | null;
  reply_to_email: string | null;
  company_phone: string | null;
  sms_number: string | null;
  sms_registration: string;
  quiet_start: string;
  quiet_end: string;
  reminders_enabled: boolean;
  reminder_days: number;
  on_the_way_enabled: boolean;
  summary_enabled: boolean;
  review_enabled: boolean;
  review_url: string | null;
  review_delay_hours: number;
  review_every_days: number;
  invoice_email_enabled: boolean;
  email_provider: string;
  sms_provider: string;
  mail_provider: string;
};

export async function messagingSettings(tx: Sql, tenantId: string): Promise<MessagingSettings> {
  await tx`select app.ensure_messaging_settings(${tenantId})`;
  const [row] = await tx<MessagingSettings[]>`select * from public.messaging_settings where tenant_id = ${tenantId}`;
  return { ...row, quiet_start: String(row.quiet_start).slice(0, 5), quiet_end: String(row.quiet_end).slice(0, 5) };
}

async function companyFacts(tx: Sql, tenantId: string, settings: MessagingSettings): Promise<CompanyFacts> {
  const [t] = await tx<{ name: string; address: string | null; license: string | null }[]>`
    select t.name, b.address, b.business_license_number as license from public.tenants t
    left join lateral (select address, business_license_number from public.branches where tenant_id = t.id and archived_at is null order by created_at limit 1) b on true
    where t.id = ${tenantId}`;
  return { name: settings.sender_name ?? t?.name ?? "", phone: settings.company_phone, license: t?.license ?? null, address: t?.address ?? null };
}

type Override = { key: string; channel: string; subject: string | null; body: string };
async function overrides(tx: Sql, tenantId: string): Promise<Override[]> {
  return tx<Override[]>`select key, channel, subject, body from public.message_templates where tenant_id = ${tenantId}`;
}

async function optedOut(tx: Sql, tenantId: string, channel: "sms" | "email", address: string | null): Promise<{ out: boolean; reason: string | null }> {
  if (!address) return { out: false, reason: null };
  const [row] = await tx<{ reason: string }[]>`select reason from public.message_opt_outs where tenant_id = ${tenantId} and channel = ${channel} and address = ${normalizeAddress(channel, address)}`;
  return { out: Boolean(row), reason: row?.reason ?? null };
}

export type QueueInput = {
  channel: Channel;
  purpose: "reminder" | "on_the_way" | "summary" | "review" | "invoice" | "notice" | "campaign" | "reply" | "keyword" | "other";
  to_address: string;
  body: string;
  subject?: string | null;
  body_html?: string | null;
  recipient_name?: string | null;
  account_id?: string | null;
  property_id?: string | null;
  contact_id?: string | null;
  visit_id?: string | null;
  notice_id?: string | null;
  invoice_id?: string | null;
  campaign_id?: string | null;
  dedupe_key?: string | null;
  send_after?: Date | null;
  token?: string | null;
  status?: "queued" | "suppressed";
  suppressed_reason?: string | null;
};

/** Queues one outbound message through app.queue_message (rule 14); idempotent by dedupe key. */
export async function queueMessage(tx: Sql, tenantId: string, input: QueueInput): Promise<string> {
  const payload = {
    ...input,
    segments: input.channel === "sms" ? smsSegments(input.body) : null,
    // One clock for queueing and sending: the database may start the transaction after the caller read its own.
    send_after: (input.send_after ?? new Date()).toISOString(),
  };
  const [row] = await tx<{ id: string }[]>`select app.queue_message(${tenantId}, ${tx.json(payload as unknown as postgres.JSONValue)}) as id`;
  return row.id;
}

export type Recipient = { contact_id: string | null; name: string; email: string | null; phone: string | null; address: string | null; sms_opt_in: boolean; preferred_channel: string | null; account_id: string | null; property_id: string | null };

/** Who hears about a visit (rule 7): the property's primary or site contact, else the account's primary contact. */
export async function visitRecipient(tx: Sql, tenantId: string, visitId: string): Promise<Recipient | null> {
  const [r] = await tx<Recipient[]>`
    select c.id as contact_id, c.name, c.email, c.phone, null::text as address, c.sms_opt_in, c.preferred_channel, v.account_id, v.property_id
    from public.visits v
    join lateral (
      select * from public.contacts c
      where c.tenant_id = v.tenant_id and c.archived_at is null
        and ((c.property_id = v.property_id and c.role in ('primary', 'site_contact')) or (c.account_id = v.account_id and c.role = 'primary'))
      order by (c.property_id = v.property_id) desc nulls last, (c.role = 'primary') desc, c.created_at
      limit 1
    ) c on true
    where v.id = ${visitId} and v.tenant_id = ${tenantId}`;
  return r ?? null;
}

const token = () => randomBytes(24).toString("hex");

function commonVars(company: CompanyFacts, recipient: Pick<Recipient, "name">, propertyAddress: string | null): Record<string, string> {
  return { company_name: company.name, company_phone: company.phone ?? "", customer_name: recipient.name, property_address: propertyAddress ?? "" };
}

function addressFor(channel: Channel, recipient: Recipient): string {
  if (channel === "sms") return e164(recipient.phone) ?? "";
  if (channel === "email") return (recipient.email ?? "").toLowerCase();
  return recipient.address ?? "";
}

type Compose = {
  key: TemplateKey;
  purpose: QueueInput["purpose"];
  recipient: Recipient;
  vars: Record<string, string>;
  dedupe_key: string;
  channel?: Channel;
  ids?: Pick<QueueInput, "visit_id" | "notice_id" | "invoice_id" | "campaign_id">;
  /** The content page for the message: the summary or the notice, shown at /m/<token>. */
  pageHtml?: string | null;
  send_after?: Date | null;
  tokenValue?: string;
};

/** Renders the template for the recipient's channel and queues it; null when no channel or template fits (rule 7). */
async function composeAndQueue(tx: Sql, tenantId: string, settings: MessagingSettings, c: Compose): Promise<string | null> {
  let channel: Channel | null = c.channel ?? null;
  if (!channel) {
    const sms = await optedOut(tx, tenantId, "sms", c.recipient.phone);
    const email = await optedOut(tx, tenantId, "email", c.recipient.email);
    channel = chooseChannel(c.recipient, { sms: sms.out, email: email.out && email.reason !== "unsubscribe" });
  }
  if (!channel) return null;
  const template = templateFor(c.key, channel, await overrides(tx, tenantId));
  if (!template) return null;
  const subject = template.subject ? render(template.subject, c.vars) : null;
  const body = render(template.body, c.vars);
  const html = channel === "email" ? `${textToHtml(body)}${c.pageHtml ? `\n<hr>\n${c.pageHtml}` : ""}` : (c.pageHtml ?? (channel === "mail" ? textToHtml(body) : null));
  return queueMessage(tx, tenantId, {
    channel,
    purpose: c.purpose,
    to_address: addressFor(channel, c.recipient),
    recipient_name: c.recipient.name,
    subject,
    body,
    body_html: html,
    account_id: c.recipient.account_id,
    property_id: c.recipient.property_id,
    contact_id: c.recipient.contact_id,
    ...c.ids,
    dedupe_key: c.dedupe_key,
    send_after: c.send_after ?? null,
    token: c.tokenValue ?? null,
  });
}

// ---------------------------------------------------------------------------
// Sending (rules 1, 2, 4 and 5)
// ---------------------------------------------------------------------------

type QueuedRow = {
  id: string;
  channel: Channel;
  purpose: string;
  to_address: string;
  recipient_name: string | null;
  subject: string | null;
  body: string;
  body_html: string | null;
  contact_id: string | null;
  contact_opt_in: boolean | null;
  visit_id: string | null;
  dedupe_key: string | null;
  segments: number | null;
  created_at: Date;
  visit_status: string | null;
  visit_scheduled_for: string | null;
};

/** Why a queued message must not go, checked at send time; null when it may go. */
async function suppression(tx: Sql, tenantId: string, m: QueuedRow, now: Date): Promise<string | null> {
  if (!m.to_address) return m.channel === "sms" ? "no mobile number" : m.channel === "email" ? "no email address" : "no mailing address";
  const system = m.purpose === "keyword";
  if (m.channel === "sms" && !system) {
    if (m.contact_id && !m.contact_opt_in) return "no SMS consent";
    if ((await optedOut(tx, tenantId, "sms", m.to_address)).out) return "opted out by text";
  }
  if (m.channel === "email") {
    const out = await optedOut(tx, tenantId, "email", m.to_address);
    if (out.out && (out.reason === "bounce" || out.reason === "complaint")) return out.reason === "bounce" ? "address bounced" : "address complained";
    if (out.out && m.purpose === "campaign") return "unsubscribed";
  }
  if (m.purpose === "on_the_way" && now.getTime() - m.created_at.getTime() > 2 * 3_600_000) return "stale: the technician tapped On my way more than two hours ago";
  if (m.purpose === "reminder" && m.dedupe_key) {
    const forDate = m.dedupe_key.split(":")[2];
    if (m.visit_status !== "scheduled" || m.visit_scheduled_for !== forDate) return "stale: the visit moved or is no longer scheduled";
  }
  return null;
}

export type SendCounts = { sent: number; delivered: number; failed: number; suppressed: number; deferred: number };

/** Sends what is due, or the given messages: claim, check, defer for quiet hours, call the provider, record. */
export async function sendQueued(tx: Sql, tenantId: string, now: Date, timeZone: string, ids: readonly string[] | null = null): Promise<SendCounts> {
  const counts: SendCounts = { sent: 0, delivered: 0, failed: 0, suppressed: 0, deferred: 0 };
  const settings = await messagingSettings(tx, tenantId);
  const rows = await tx<QueuedRow[]>`
    select m.id, m.channel, m.purpose, m.to_address, m.recipient_name, m.subject, m.body, m.body_html, m.contact_id, c.sms_opt_in as contact_opt_in,
           m.visit_id, m.dedupe_key, m.segments, m.created_at, v.status as visit_status, v.scheduled_for::text as visit_scheduled_for
    from public.messages m left join public.contacts c on c.id = m.contact_id left join public.visits v on v.id = m.visit_id
    where m.tenant_id = ${tenantId} and m.status = 'queued' and m.send_after <= greatest(${now}::timestamptz, clock_timestamp())
      and (${ids ? ids : null}::uuid[] is null or m.id = any(${ids ? ids : null}::uuid[]))
    order by m.send_after, m.created_at limit 500`;
  const window = { start: settings.quiet_start, end: settings.quiet_end };
  for (const m of rows) {
    const [{ claimed }] = await tx<{ claimed: boolean }[]>`select app.claim_message(${tenantId}, ${m.id}) as claimed`;
    if (!claimed) continue;
    const reason = await suppression(tx, tenantId, m, now);
    if (reason) {
      await tx`select app.record_message_status(${tenantId}, ${m.id}, 'suppressed', null, null, ${reason}, null)`;
      counts.suppressed += 1;
      continue;
    }
    if (m.channel === "sms" && !["keyword", "reply"].includes(m.purpose) && !withinQuietHours(now, timeZone, window)) {
      await tx`select app.defer_message(${tenantId}, ${m.id}, ${nextAllowed(now, timeZone, window)})`;
      counts.deferred += 1;
      continue;
    }
    const provider = providerFor(settings, m.channel);
    const result =
      m.channel === "email"
        ? await provider.sendEmail!({ message_id: m.id, to: m.to_address, from: `${settings.sender_name ?? "Bugsy"} <${fromEmail()}>`, reply_to: settings.reply_to_email, subject: m.subject ?? "", text: m.body, html: m.body_html })
        : m.channel === "sms"
          ? await provider.sendSms!({ message_id: m.id, to: m.to_address, from: settings.sms_number, body: m.body, status_callback: `${appUrl()}/api/messaging/twilio` })
          : await provider.sendLetter!({ message_id: m.id, to: { name: m.recipient_name ?? "", address: m.to_address }, from: { name: settings.sender_name ?? "", address: null }, html: m.body_html ?? textToHtml(m.body) });
    await tx`select app.record_message_status(${tenantId}, ${m.id}, ${result.status}, ${provider.name}, ${result.provider_message_id}, ${result.error}, ${m.segments})`;
    counts[result.status] += 1;
  }
  return counts;
}

/** A provider's later word on a message, by its id (webhooks; idempotent). */
export async function recordProviderStatus(tx: Sql, provider: string, providerMessageId: string, status: "sent" | "delivered" | "failed", error: string | null): Promise<string | null> {
  const [m] = await tx<{ id: string; tenant_id: string }[]>`select id, tenant_id from public.messages where provider = ${provider} and provider_message_id = ${providerMessageId}`;
  if (!m) return null;
  await tx`select app.record_message_status(${m.tenant_id}, ${m.id}, ${status}, ${provider}, ${providerMessageId}, ${error}, null)`;
  return m.tenant_id;
}

// ---------------------------------------------------------------------------
// Inbound (rules 3 and 12)
// ---------------------------------------------------------------------------

export type InboundInput = { tenant_id: string; from: string; to: string | null; body: string; provider: string; provider_message_id: string | null };

/** An inbound text: matched to a contact, a keyword handled with one confirmation, anything else on the timeline. */
export async function handleInbound(tx: Sql, input: InboundInput, timeZone: string): Promise<{ message_id: string; keyword: string | null }> {
  const digits = normalizeAddress("sms", input.from);
  const [match] = await tx<{ contact_id: string | null; account_id: string | null; property_id: string | null }[]>`
    select contact_id, account_id, property_id from (
      select m.contact_id, m.account_id, m.property_id, m.created_at as at from public.messages m
      where m.tenant_id = ${input.tenant_id} and m.channel = 'sms' and m.direction = 'outbound' and right(regexp_replace(m.to_address, '\\D', '', 'g'), 10) = ${digits}
      union all
      select c.id, c.account_id, c.property_id, c.created_at - interval '100 years' from public.contacts c
      where c.tenant_id = ${input.tenant_id} and c.archived_at is null and c.phone_digits = ${digits}
    ) x order by at desc limit 1`;
  const kw = keyword(input.body);
  const [inbound] = await tx<{ id: string }[]>`
    insert into public.messages ${tx({
      tenant_id: input.tenant_id,
      direction: "inbound",
      channel: "sms",
      purpose: kw ? "keyword" : "inbound",
      account_id: match?.account_id ?? null,
      property_id: match?.property_id ?? null,
      contact_id: match?.contact_id ?? null,
      to_address: input.to ?? "",
      from_address: e164(input.from) ?? input.from,
      body: input.body,
      status: "received",
      provider: input.provider,
      provider_message_id: input.provider_message_id,
      created_by: null,
    })}
    on conflict (provider, provider_message_id) where provider_message_id is not null do nothing returning id`;
  if (!inbound) {
    const [again] = await tx<{ id: string }[]>`select id from public.messages where provider = ${input.provider} and provider_message_id = ${input.provider_message_id}`;
    return { message_id: again.id, keyword: kw };
  }
  if (kw) {
    if (kw === "stop") {
      await tx`insert into public.message_opt_outs (tenant_id, channel, address, reason, message_id, created_by) values (${input.tenant_id}, 'sms', ${digits}, 'stop', ${inbound.id}, null) on conflict (tenant_id, channel, address) do nothing`;
    } else if (kw === "start") {
      await tx`delete from public.message_opt_outs where tenant_id = ${input.tenant_id} and channel = 'sms' and address = ${digits} and reason in ('stop', 'manual')`;
    }
    const settings = await messagingSettings(tx, input.tenant_id);
    const company = await companyFacts(tx, input.tenant_id, settings);
    const template = templateFor(`keyword.${kw}` as TemplateKey, "sms", await overrides(tx, input.tenant_id));
    if (template) {
      const id = await queueMessage(tx, input.tenant_id, {
        channel: "sms",
        purpose: "keyword",
        to_address: e164(input.from) ?? input.from,
        body: render(template.body, { company_name: company.name, company_phone: company.phone ?? "" }),
        account_id: match?.account_id ?? null,
        property_id: match?.property_id ?? null,
        contact_id: match?.contact_id ?? null,
        dedupe_key: `keyword:${inbound.id}`,
      });
      await sendQueued(tx, input.tenant_id, new Date(), timeZone, [id]);
    }
  }
  return { message_id: inbound.id, keyword: kw };
}

// ---------------------------------------------------------------------------
// Automations (rules 6 to 9)
// ---------------------------------------------------------------------------

const WINDOW_TEXT: Record<string, string> = { any: "", morning: " in the morning", afternoon: " in the afternoon", evening: " in the evening" };

function longDate(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
}

/** Reminders for visits scheduled the set number of days ahead, once per visit and date. */
export async function queueReminders(tx: Sql, tenantId: string, settings: MessagingSettings, timeZone: string, now: Date): Promise<number> {
  if (!settings.reminders_enabled) return 0;
  const target = addDays(todayInZone(timeZone), settings.reminder_days);
  const visits = await tx<{ id: string; scheduled_for: string; arrival_window: string; service_name: string; address: string }[]>`
    select v.id, v.scheduled_for::text, v.arrival_window, st.name as service_name, p.normalized_address as address
    from public.visits v join public.service_types st on st.id = v.service_type_id join public.properties p on p.id = v.property_id
    where v.tenant_id = ${tenantId} and v.status = 'scheduled' and v.scheduled_for = ${target}
      and not exists (select 1 from public.messages m where m.tenant_id = v.tenant_id and m.dedupe_key = 'reminder:' || v.id || ':' || v.scheduled_for::text)`;
  const company = await companyFacts(tx, tenantId, settings);
  let queued = 0;
  for (const v of visits) {
    const recipient = await visitRecipient(tx, tenantId, v.id);
    if (!recipient) continue;
    const id = await composeAndQueue(tx, tenantId, settings, {
      key: "reminder",
      purpose: "reminder",
      recipient,
      vars: { ...commonVars(company, recipient, v.address), visit_date: longDate(v.scheduled_for), arrival_window: WINDOW_TEXT[v.arrival_window] ?? "", service_name: v.service_name },
      dedupe_key: `reminder:${v.id}:${v.scheduled_for}`,
      ids: { visit_id: v.id },
      send_after: now,
    });
    if (id) queued += 1;
  }
  return queued;
}

/** The on-the-way text when the technician taps On my way; a tap synced more than two hours late is suppressed. */
export async function queueOnTheWay(tx: Sql, tenantId: string, visitId: string, tappedAt: Date, timeZone: string): Promise<string | null> {
  const settings = await messagingSettings(tx, tenantId);
  if (!settings.on_the_way_enabled) return null;
  const visit = await loadRouteVisit(tx, tenantId, visitId);
  const recipient = await visitRecipient(tx, tenantId, visitId);
  if (!visit || !recipient) return null;
  const company = await companyFacts(tx, tenantId, settings);
  const lead = visit.crew.find((c) => c.role === "lead") ?? visit.crew[0];
  const id = await composeAndQueue(tx, tenantId, settings, {
    key: "on_the_way",
    purpose: "on_the_way",
    recipient,
    vars: { ...commonVars(company, recipient, visit.property.address), technician_name: lead?.name.split(" ")[0] ?? "Your technician", service_name: visit.service_type.name },
    dedupe_key: `on_the_way:${visitId}`,
    ids: { visit_id: visitId },
  });
  if (!id) return null;
  if (Date.now() - tappedAt.getTime() > 2 * 3_600_000) {
    await tx`select app.record_message_status(${tenantId}, ${id}, 'suppressed', null, null, 'stale: the technician tapped On my way more than two hours ago', null)`;
    return id;
  }
  await sendQueued(tx, tenantId, new Date(), timeZone, [id]);
  return id;
}

/** The visit summary at completion (rule 8), carrying the post-application notice when channel and person match, and
 *  the review request after the set delay. */
export async function queueVisitSummary(tx: Sql, tenantId: string, visitId: string, timeZone: string): Promise<string | null> {
  const settings = await messagingSettings(tx, tenantId);
  const visit = await loadRouteVisit(tx, tenantId, visitId);
  if (!visit || visit.status !== "completed") return null;
  const company = await companyFacts(tx, tenantId, settings);
  const lead = visit.crew.find((c) => c.role === "lead") ?? visit.crew[0];
  let summaryId: string | null = null;
  if (settings.summary_enabled) {
    const [notice] = await tx<{ id: string; channel: Channel; contact_id: string }[]>`
      select n.id, n.channel, n.recipient_contact_id as contact_id from public.notices n
      where n.tenant_id = ${tenantId} and n.visit_id = ${visitId} and n.kind = 'post_application' and n.status = 'due' and n.channel in ('email', 'sms') and n.recipient_contact_id is not null
        and not exists (select 1 from public.messages m where m.notice_id = n.id)
      limit 1`;
    let recipient = await visitRecipient(tx, tenantId, visitId);
    let channel: Channel | undefined;
    if (notice) {
      const [c] = await tx<Recipient[]>`
        select c.id as contact_id, c.name, c.email, c.phone, null::text as address, c.sms_opt_in, c.preferred_channel, ${visit.account.id}::uuid as account_id, ${visit.property.id}::uuid as property_id
        from public.contacts c where c.id = ${notice.contact_id}`;
      if (c) {
        recipient = c;
        channel = notice.channel;
      }
    }
    if (recipient) {
      const t = token();
      const day = (visit.captured.departed_at ?? visit.captured.completed_at ?? new Date().toISOString()).slice(0, 10);
      summaryId = await composeAndQueue(tx, tenantId, settings, {
        key: "summary",
        purpose: "summary",
        recipient,
        channel,
        vars: {
          ...commonVars(company, recipient, visit.property.address),
          service_name: visit.service_type.name,
          visit_date: longDate(day),
          technician_name: lead?.name ?? "Your technician",
          summary_url: `${appUrl()}/m/${t}`,
          summary_text: summaryText(visit, timeZone),
        },
        dedupe_key: `summary:${visitId}`,
        ids: { visit_id: visitId, notice_id: notice && channel ? notice.id : null },
        pageHtml: summaryHtml(visit, timeZone, company),
        tokenValue: t,
      });
      if (summaryId) await sendQueued(tx, tenantId, new Date(), timeZone, [summaryId]);
    }
  }
  await queueReviewRequest(tx, tenantId, settings, visitId, company);
  return summaryId;
}

async function queueReviewRequest(tx: Sql, tenantId: string, settings: MessagingSettings, visitId: string, company: CompanyFacts): Promise<string | null> {
  if (!settings.review_enabled || !settings.review_url) return null;
  const recipient = await visitRecipient(tx, tenantId, visitId);
  if (!recipient?.account_id) return null;
  const [recent] = await tx<{ n: number }[]>`
    select count(*)::int as n from public.messages where tenant_id = ${tenantId} and account_id = ${recipient.account_id} and purpose = 'review'
      and created_at > now() - make_interval(days => ${settings.review_every_days})`;
  if (recent.n > 0) return null;
  const [v] = await tx<{ service_name: string; address: string; completed_at: Date | null }[]>`
    select st.name as service_name, p.normalized_address as address, v.completed_at from public.visits v join public.service_types st on st.id = v.service_type_id join public.properties p on p.id = v.property_id where v.id = ${visitId}`;
  return composeAndQueue(tx, tenantId, settings, {
    key: "review",
    purpose: "review",
    recipient,
    vars: { ...commonVars(company, recipient, v.address), review_url: settings.review_url, service_name: v.service_name },
    dedupe_key: `review:${visitId}`,
    ids: { visit_id: visitId },
    send_after: new Date((v.completed_at ?? new Date()).getTime() + settings.review_delay_hours * 3_600_000),
  });
}

/** The invoice email when an invoice is issued (rule 6); opening balances and credit memos are not emailed. */
export async function queueInvoiceEmail(tx: Sql, tenantId: string, invoiceId: string): Promise<string | null> {
  const settings = await messagingSettings(tx, tenantId);
  if (!settings.invoice_email_enabled) return null;
  const [inv] = await tx<{ id: string; number: number | null; kind: string; source: string; status: string; total_cents: string | number; due_on: string | null; account_id: string; property_id: string | null; account_name: string; email: string | null; contact_id: string | null; contact_name: string | null; address: string | null }[]>`
    select i.id, i.number, i.kind, i.source, i.status, i.total_cents, i.due_on::text, i.account_id, i.property_id, a.name as account_name,
           coalesce(c.email, a.email) as email, c.id as contact_id, c.name as contact_name, p.normalized_address as address
    from public.invoices i join public.accounts a on a.id = i.account_id left join public.properties p on p.id = i.property_id
    left join lateral (select id, name, email from public.contacts where account_id = a.id and archived_at is null and email is not null order by (role = 'billing') desc, (role = 'primary') desc, created_at limit 1) c on true
    where i.id = ${invoiceId} and i.tenant_id = ${tenantId}`;
  if (!inv || inv.kind !== "invoice" || inv.source === "opening" || inv.status === "draft" || !inv.email) return null;
  const company = await companyFacts(tx, tenantId, settings);
  const recipient: Recipient = { contact_id: inv.contact_id, name: inv.contact_name ?? inv.account_name, email: inv.email, phone: null, address: null, sms_opt_in: false, preferred_channel: "email", account_id: inv.account_id, property_id: inv.property_id };
  return composeAndQueue(tx, tenantId, settings, {
    key: "invoice",
    purpose: "invoice",
    recipient,
    channel: "email",
    vars: { ...commonVars(company, recipient, inv.address), invoice_number: String(inv.number ?? ""), invoice_total: formatCents(Number(inv.total_cents)), due_date: inv.due_on ? longDate(inv.due_on) : "on receipt" },
    dedupe_key: `invoice:${invoiceId}`,
    ids: { invoice_id: invoiceId },
  });
}

/** Due notices on email, SMS or mail that no message carries (rule 9). */
export async function queueDueNotices(tx: Sql, tenantId: string, settings: MessagingSettings, timeZone: string): Promise<number> {
  const due = await tx<{ id: string; kind: NoticeKind; channel: Channel; visit_id: string | null; property_id: string; account_id: string | null; for_scheduled_for: string | null; recipient_contact_id: string | null; recipient_name: string; recipient_email: string | null; recipient_phone: string | null; recipient_address: string | null; sms_opt_in: boolean | null; address: string }[]>`
    select n.id, n.kind, n.channel, n.visit_id, n.property_id, p.account_id, n.for_scheduled_for::text, n.recipient_contact_id, n.recipient_name,
           coalesce(n.recipient_email, c.email) as recipient_email, coalesce(n.recipient_phone, c.phone) as recipient_phone, n.recipient_address, c.sms_opt_in, p.normalized_address as address
    from public.notices n join public.properties p on p.id = n.property_id left join public.contacts c on c.id = n.recipient_contact_id
    where n.tenant_id = ${tenantId} and n.status = 'due' and n.channel in ('email', 'sms', 'mail')
      and not exists (select 1 from public.messages m where m.notice_id = n.id)
    order by n.due_by nulls last limit 200`;
  const company = await companyFacts(tx, tenantId, settings);
  let queued = 0;
  for (const n of due) {
    const visit = n.visit_id ? await loadRouteVisit(tx, tenantId, n.visit_id) : null;
    const text = noticeText(n.kind, { visit, timeZone, propertyAddress: n.address, forScheduledFor: n.for_scheduled_for });
    const t = token();
    const recipient: Recipient = {
      contact_id: n.recipient_contact_id,
      name: n.recipient_name,
      email: n.recipient_email,
      phone: n.recipient_phone,
      address: n.recipient_address,
      sms_opt_in: Boolean(n.sms_opt_in),
      preferred_channel: n.channel,
      account_id: n.account_id,
      property_id: n.property_id,
    };
    const key = (n.kind === "posting_sign" ? "notice.other" : `notice.${n.kind}`) as TemplateKey;
    const id = await composeAndQueue(tx, tenantId, settings, {
      key,
      purpose: "notice",
      recipient,
      channel: n.channel,
      vars: { ...commonVars(company, recipient, n.address), notice_url: `${appUrl()}/m/${t}`, notice_text: text, visit_date: n.for_scheduled_for ? longDate(n.for_scheduled_for) : visit?.scheduled_for ? longDate(visit.scheduled_for) : "", service_name: visit?.service_type.name ?? "" },
      dedupe_key: `notice:${n.id}`,
      ids: { notice_id: n.id, visit_id: n.visit_id },
      pageHtml: noticeHtml(text, company),
      tokenValue: t,
    });
    if (id) queued += 1;
  }
  return queued;
}

// ---------------------------------------------------------------------------
// Campaigns (rule 11)
// ---------------------------------------------------------------------------

export type Audience = { account_type?: string | null; state_code?: string | null; service_line?: string | null; no_visit_days?: number | null; ending_within_days?: number | null };
export type AudienceMember = { account_id: string; account_name: string; contact_id: string; name: string; email: string | null; phone: string | null; sms_opt_in: boolean; preferred_channel: string | null; address: string | null };

export async function audience(tx: Sql, tenantId: string, filters: Audience, today: string): Promise<AudienceMember[]> {
  return tx<AudienceMember[]>`
    select a.id as account_id, a.name as account_name, c.id as contact_id, c.name, c.email, c.phone, c.sms_opt_in, c.preferred_channel,
           (select p.normalized_address from public.properties p where p.account_id = a.id and p.archived_at is null order by p.created_at limit 1) as address
    from public.accounts a
    join lateral (select * from public.contacts c where c.account_id = a.id and c.role = 'primary' and c.archived_at is null order by c.created_at limit 1) c on true
    where a.tenant_id = ${tenantId} and a.archived_at is null and a.status = 'active'
      and (${filters.account_type ?? null}::text is null or a.type = ${filters.account_type ?? null}::text)
      and (${filters.state_code ?? null}::text is null or exists (select 1 from public.properties p where p.account_id = a.id and p.state_code = ${filters.state_code ?? null}::text))
      and (${filters.service_line ?? null}::text is null or exists (
            select 1 from public.agreements g join public.service_types st on st.id = g.service_type_id
            where g.account_id = a.id and g.status = 'active' and st.service_line = ${filters.service_line ?? null}::text))
      and (${filters.no_visit_days ?? null}::int is null or not exists (
            select 1 from public.visits v where v.account_id = a.id and v.status = 'completed' and coalesce(v.scheduled_for, v.due_start) >= ${today}::date - ${filters.no_visit_days ?? 0}::int))
      and (${filters.ending_within_days ?? null}::int is null or exists (
            select 1 from public.agreements g where g.account_id = a.id and g.status = 'active' and g.ends_on between ${today}::date and ${today}::date + ${filters.ending_within_days ?? 0}::int))
    order by a.name`;
}

/** Queues one message per account in the campaign's audience; consent and quiet hours apply when each is sent. */
export async function launchCampaign(tx: Sql, tenantId: string, campaignId: string, today: string): Promise<{ audience: number; queued: number; skipped: number; ids: string[] }> {
  const [c] = await tx<{ id: string; channel: "email" | "sms"; subject: string | null; body: string; audience: Audience; status: string }[]>`
    select id, channel, subject, body, audience, status from public.campaigns where id = ${campaignId} and tenant_id = ${tenantId}`;
  if (!c || !["draft", "scheduled"].includes(c.status)) throw Object.assign(new Error("this campaign was already sent or cancelled"), { code: "23514" });
  const unknown = checkTemplate("campaign", { subject: c.subject, body: c.body });
  if (unknown.length) throw Object.assign(new Error(`unknown variables: ${unknown.join(", ")}`), { code: "23514" });
  const settings = await messagingSettings(tx, tenantId);
  const company = await companyFacts(tx, tenantId, settings);
  await tx`update public.campaigns set status = 'sending' where id = ${campaignId}`;
  const members = await audience(tx, tenantId, c.audience ?? {}, today);
  const ids: string[] = [];
  let skipped = 0;
  for (const m of members) {
    const recipient: Recipient = { contact_id: m.contact_id, name: m.name, email: m.email, phone: m.phone, address: m.address, sms_opt_in: m.sms_opt_in, preferred_channel: c.channel, account_id: m.account_id, property_id: null };
    const to = addressFor(c.channel, recipient);
    if (!to) {
      skipped += 1;
      continue;
    }
    const t = token();
    const vars = { ...commonVars(company, recipient, m.address), unsubscribe_url: `${appUrl()}/u/${t}` };
    let body = render(c.body, vars);
    if (c.channel === "email" && !body.includes(vars.unsubscribe_url)) body = `${body}\n\nUnsubscribe: ${vars.unsubscribe_url}`;
    const id = await queueMessage(tx, tenantId, {
      channel: c.channel,
      purpose: "campaign",
      to_address: to,
      recipient_name: m.name,
      subject: c.subject ? render(c.subject, vars) : null,
      body,
      body_html: c.channel === "email" ? textToHtml(body) : null,
      account_id: m.account_id,
      contact_id: m.contact_id,
      campaign_id: campaignId,
      dedupe_key: `campaign:${campaignId}:${m.account_id}`,
      token: t,
    });
    ids.push(id);
  }
  await tx`update public.campaigns set status = 'sent', sent_at = now(), counts = ${tx.json({ audience: members.length, queued: ids.length, skipped })} where id = ${campaignId}`;
  return { audience: members.length, queued: ids.length, skipped, ids };
}

// ---------------------------------------------------------------------------
// The job and the reads
// ---------------------------------------------------------------------------

export type MessagingCounts = { reminders: number; notices: number; campaigns: number } & SendCounts;

/** The messaging job for one company: reminders, due notices, scheduled campaigns, then everything due goes out. */
export async function runMessaging(tx: Sql, tenantId: string, timeZone: string, now = new Date()): Promise<MessagingCounts> {
  const settings = await messagingSettings(tx, tenantId);
  const reminders = await queueReminders(tx, tenantId, settings, timeZone, now);
  const notices = await queueDueNotices(tx, tenantId, settings, timeZone);
  const scheduled = await tx<{ id: string }[]>`select id from public.campaigns where tenant_id = ${tenantId} and status = 'scheduled' and scheduled_for <= ${now}`;
  for (const c of scheduled) await launchCampaign(tx, tenantId, c.id, todayInZone(timeZone));
  const sent = await sendQueued(tx, tenantId, now, timeZone);
  return { reminders, notices, campaigns: scheduled.length, ...sent };
}

export type TimelineMessage = { id: string; direction: "outbound" | "inbound"; channel: Channel; purpose: string; to_address: string; from_address: string | null; subject: string | null; body: string; status: string; suppressed_reason: string | null; error: string | null; created_at: Date; sent_at: Date | null; delivered_at: Date | null; read_at: Date | null; token: string; notice_id: string | null };

export async function timeline(tx: Sql, tenantId: string, accountId: string): Promise<TimelineMessage[]> {
  return tx<TimelineMessage[]>`
    select id, direction, channel, purpose, to_address, from_address, subject, body, status, suppressed_reason, error, created_at, sent_at, delivered_at, read_at, token, notice_id
    from public.messages where tenant_id = ${tenantId} and account_id = ${accountId} order by created_at desc, id desc limit 200`;
}

export type InboxItem = { id: string; from_address: string | null; body: string; created_at: Date; read_at: Date | null; account_id: string | null; account_name: string | null; contact_name: string | null };

export async function inbox(tx: Sql, tenantId: string): Promise<InboxItem[]> {
  return tx<InboxItem[]>`
    select m.id, m.from_address, m.body, m.created_at, m.read_at, m.account_id, a.name as account_name, c.name as contact_name
    from public.messages m left join public.accounts a on a.id = m.account_id left join public.contacts c on c.id = m.contact_id
    where m.tenant_id = ${tenantId} and m.direction = 'inbound' and m.created_at > now() - interval '60 days'
    order by (m.read_at is null) desc, m.created_at desc limit 200`;
}

/** An office reply by text to an inbound message (rules 2 and 3 still apply), sent at once. */
export async function reply(tx: Sql, tenantId: string, inboundId: string, body: string, timeZone: string): Promise<string> {
  const [m] = await tx<{ from_address: string | null; account_id: string | null; property_id: string | null; contact_id: string | null }[]>`
    select from_address, account_id, property_id, contact_id from public.messages where id = ${inboundId} and tenant_id = ${tenantId} and direction = 'inbound'`;
  if (!m?.from_address) throw Object.assign(new Error("that message has no number to answer"), { code: "23514" });
  const id = await queueMessage(tx, tenantId, { channel: "sms", purpose: "reply", to_address: m.from_address, body, account_id: m.account_id, property_id: m.property_id, contact_id: m.contact_id });
  await tx`select app.mark_messages_read(${tenantId}, ${[inboundId]}::uuid[])`;
  await sendQueued(tx, tenantId, new Date(), timeZone, [id]);
  return id;
}

export async function usage(tx: Sql, tenantId: string, monthStart: string, nextMonthStart: string): Promise<{ channel: string; status: string; messages: number; segments: number }[]> {
  return tx<{ channel: string; status: string; messages: number; segments: number }[]>`
    select channel, status, count(*)::int as messages, coalesce(sum(segments), 0)::int as segments from public.messages
    where tenant_id = ${tenantId} and direction = 'outbound' and created_at >= ${monthStart}::date and created_at < ${nextMonthStart}::date
    group by channel, status order by channel, status`;
}
