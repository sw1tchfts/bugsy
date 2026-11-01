import type { Metadata } from "next";
import { Button, Card, Field, Input, Notice, Select, Table, Textarea, errorMessage } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { todayInZone } from "@/lib/dates";
import { messagingSettings, usage } from "@/lib/messaging/db";
import { DEFAULT_TEMPLATES, TEMPLATE_KEYS, TEMPLATE_LABELS, TEMPLATE_VARIABLES } from "@/lib/messaging/templates";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { resetTemplate, saveMessagingSettings, saveTemplate } from "../../messages/actions";

export const metadata: Metadata = { title: "Messaging" };

export default async function MessagingSettingsPage({ searchParams }: { searchParams: Promise<{ error?: string; note?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "messages.manage");
  const { error, note } = await searchParams;
  const today = todayInZone(active.tenantTimezone);
  const monthStart = `${today.slice(0, 7)}-01`;
  const [y, m] = today.split("-").map(Number);
  const nextMonth = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const data = await dbAs(session, async (tx) => ({
    settings: await messagingSettings(tx, active.tenantId),
    overrides: await tx<{ key: string; channel: string; subject: string | null; body: string }[]>`select key, channel, subject, body from public.message_templates where tenant_id = ${active.tenantId}`,
    usage: await usage(tx, active.tenantId, monthStart, nextMonth, active.tenantTimezone),
  }));
  const s = data.settings;
  const own = new Map(data.overrides.map((o) => [`${o.key}:${o.channel}`, o]));
  const check = (name: keyof typeof s, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name={name} value="true" defaultChecked={Boolean(s[name])} /> {label}
    </label>
  );

  return (
    <>
      <h1 className="text-2xl font-semibold">Messaging</h1>
      <p className="text-sm text-stone-600">What customers hear from the company, when, and how. Texting is included; a text goes only to someone who agreed to texts, never in quiet hours, and STOP always works.</p>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      {note ? <Notice kind="success">{note}</Notice> : null}

      <Card title="Settings">
        <form action={saveMessagingSettings} className="grid gap-4">
          <input type="hidden" name="tenant_id" value={active.tenantId} />
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Sender name" htmlFor="ms-sender">
              <Input id="ms-sender" name="sender_name" defaultValue={s.sender_name ?? ""} />
            </Field>
            <Field label="Reply-to email" htmlFor="ms-reply">
              <Input id="ms-reply" name="reply_to_email" type="email" defaultValue={s.reply_to_email ?? ""} />
            </Field>
            <Field label="Company phone (in messages)" htmlFor="ms-phone">
              <Input id="ms-phone" name="company_phone" defaultValue={s.company_phone ?? ""} />
            </Field>
            <Field label="Texting number" htmlFor="ms-number" hint={`Registration: ${s.sms_registration}`}>
              <Input id="ms-number" name="sms_number" defaultValue={s.sms_number ?? ""} placeholder="+1 614 555 0100" />
            </Field>
            <Field label="Texts from" htmlFor="ms-quiet-start" hint="Company time zone">
              <Input id="ms-quiet-start" name="quiet_start" type="time" defaultValue={s.quiet_start} />
            </Field>
            <Field label="Texts until" htmlFor="ms-quiet-end">
              <Input id="ms-quiet-end" name="quiet_end" type="time" defaultValue={s.quiet_end} />
            </Field>
            <Field label="Remind days ahead" htmlFor="ms-remind-days">
              <Input id="ms-remind-days" name="reminder_days" inputMode="numeric" defaultValue={s.reminder_days} />
            </Field>
            <Field label="Review link" htmlFor="ms-review-url">
              <Input id="ms-review-url" name="review_url" type="url" defaultValue={s.review_url ?? ""} placeholder="https://g.page/r/..." />
            </Field>
            <Field label="Review request after (hours)" htmlFor="ms-review-delay">
              <Input id="ms-review-delay" name="review_delay_hours" inputMode="numeric" defaultValue={s.review_delay_hours} />
            </Field>
            <Field label="At most one review request per (days)" htmlFor="ms-review-every">
              <Input id="ms-review-every" name="review_every_days" inputMode="numeric" defaultValue={s.review_every_days} />
            </Field>
            <Field label="Email through" htmlFor="ms-email-provider">
              <Select id="ms-email-provider" name="email_provider" defaultValue={s.email_provider}>
                <option value="local">Local (no keys)</option>
                <option value="postmark">Postmark</option>
              </Select>
            </Field>
            <Field label="Texts through" htmlFor="ms-sms-provider">
              <Select id="ms-sms-provider" name="sms_provider" defaultValue={s.sms_provider}>
                <option value="local">Local (no keys)</option>
                <option value="twilio">Twilio</option>
              </Select>
            </Field>
            <Field label="Letters through" htmlFor="ms-mail-provider">
              <Select id="ms-mail-provider" name="mail_provider" defaultValue={s.mail_provider}>
                <option value="local">Local (no keys)</option>
                <option value="lob">Lob</option>
              </Select>
            </Field>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {check("reminders_enabled", "Visit reminders")}
            {check("on_the_way_enabled", "On-the-way texts")}
            {check("summary_enabled", "Visit summaries")}
            {check("review_enabled", "Review requests")}
            {check("invoice_email_enabled", "Invoice emails")}
          </div>
          <div>
            <Button type="submit">Save settings</Button>
          </div>
        </form>
      </Card>

      <Card title="This month" description="Outbound messages by channel and outcome.">
        <Table headers={["Channel", "Outcome", "Messages", "Text segments"]}>
          {data.usage.map((u) => (
            <tr key={`${u.channel}:${u.status}`} data-testid="usage-row">
              <td className="py-1 pr-4">{u.channel}</td>
              <td className="py-1 pr-4">{u.status}</td>
              <td className="py-1 pr-4 tabular-nums">{u.messages}</td>
              <td className="py-1 pr-4 tabular-nums">{u.channel === "sms" ? u.segments : ""}</td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Templates" description="The built-in wording, or the company's own. Each template may use only its listed variables.">
        <div className="grid gap-4">
          {TEMPLATE_KEYS.flatMap((key) =>
            (Object.keys(DEFAULT_TEMPLATES[key]) as ("email" | "sms" | "mail")[]).map((channel) => {
              const base = DEFAULT_TEMPLATES[key][channel]!;
              const mine = own.get(`${key}:${channel}`);
              return (
                <details key={`${key}:${channel}`} className="rounded-md border border-stone-200 p-3" data-testid={`template-${key}-${channel}`}>
                  <summary className="cursor-pointer text-sm font-medium">
                    {TEMPLATE_LABELS[key]} ({channel === "sms" ? "text" : channel}){mine ? " (customized)" : ""}
                  </summary>
                  <form action={saveTemplate} className="mt-3 grid gap-2">
                    <input type="hidden" name="tenant_id" value={active.tenantId} />
                    <input type="hidden" name="key" value={key} />
                    <input type="hidden" name="channel" value={channel} />
                    {channel !== "sms" ? <Input name="subject" defaultValue={mine?.subject ?? base.subject ?? ""} aria-label={`Subject for ${TEMPLATE_LABELS[key]} ${channel}`} /> : null}
                    <Textarea name="body" rows={4} defaultValue={mine?.body ?? base.body} aria-label={`Body for ${TEMPLATE_LABELS[key]} ${channel}`} />
                    <p className="text-xs text-stone-500">{TEMPLATE_VARIABLES[key].map((v) => `{{${v}}}`).join(" ")}</p>
                    <div className="flex gap-2">
                      <Button type="submit" variant="secondary">
                        Save template
                      </Button>
                    </div>
                  </form>
                  {mine ? (
                    <form action={resetTemplate} className="mt-2">
                      <input type="hidden" name="tenant_id" value={active.tenantId} />
                      <input type="hidden" name="key" value={key} />
                      <input type="hidden" name="channel" value={channel} />
                      <Button type="submit" variant="secondary">
                        Use the built-in wording
                      </Button>
                    </form>
                  ) : null}
                </details>
              );
            }),
          )}
        </div>
      </Card>
    </>
  );
}
