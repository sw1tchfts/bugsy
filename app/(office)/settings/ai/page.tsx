import type { Metadata } from "next";
import { Button, Card, Field, Input, Notice, Table, errorMessage } from "@/components/ui";
import { aiSettings, aiUsage } from "@/lib/ai/db";
import { aiProvider } from "@/lib/ai/provider";
import { can } from "@/lib/auth/permissions";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { saveAiSettings } from "./actions";

export const metadata: Metadata = { title: "AI" };

const FEATURES = [
  { key: "summaries", label: "Draft the customer's note from the technician's notes", hint: "The technician edits it; only what they save goes to the customer." },
  { key: "label_reading", label: "Read a label's rates into a product", hint: "Rows go into the product form; they count only when someone saves the product." },
  { key: "portal_answers", label: "Answer portal questions from the customer's own records", hint: "Anything the records do not answer goes to the office." },
  { key: "churn", label: "Score churn risk on every active plan", hint: "A daily score with its reasons; it changes nothing." },
] as const;

/** Spec 21 rules 1 and 2: what AI does for the company, its monthly limit, and this month's use. */
export default async function AiSettingsPage({ searchParams }: { searchParams: Promise<{ note?: string; error?: string }> }) {
  const q = await searchParams;
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "settings.read");
  const write = can(active.permissions, "settings.write");
  const [settings, usage] = await dbAs(session, (tx) => Promise.all([aiSettings(tx, active.tenantId), aiUsage(tx, active.tenantId)]));
  const provider = aiProvider().kind;
  const used = usage.reduce((s, u) => s + u.calls, 0);
  return (
    <>
      <h1 className="text-2xl font-semibold">AI</h1>
      <p className="max-w-prose text-sm text-stone-600">
        AI drafts and flags; people decide. It never writes an application record, a notice, a product&apos;s saved label rates or an invoice.
        {provider === "local" ? " No AI key is set, so drafts and answers come from Bugsy's built-in templates." : ""}
      </p>
      {q.note ? <Notice kind="success">{q.note}</Notice> : null}
      {errorMessage(q.error) ? <Notice kind="error">{errorMessage(q.error)}</Notice> : null}
      <Card title="Features">
        <form action={saveAiSettings} className="grid gap-3 text-sm">
          <input type="hidden" name="tenant_id" value={active.tenantId} />
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" name="enabled" defaultChecked={settings.enabled} disabled={!write} /> Use AI
          </label>
          {FEATURES.map((f) => (
            <label key={f.key} className="flex items-start gap-2 pl-5">
              <input type="checkbox" name={f.key} defaultChecked={settings[f.key]} disabled={!write} className="mt-1" />
              <span>
                {f.label}
                <span className="block text-xs text-stone-500">{f.hint}</span>
              </span>
            </label>
          ))}
          <Field label="AI calls a month" htmlFor="monthly_limit" hint="Past the limit, people write it themselves until next month.">
            <Input id="monthly_limit" name="monthly_limit" type="number" min={0} max={100000} defaultValue={settings.monthly_limit} disabled={!write} />
          </Field>
          {write ? (
            <div>
              <Button type="submit">Save</Button>
            </div>
          ) : null}
        </form>
      </Card>
      <Card title="This month" description={`${used} of ${settings.monthly_limit} calls used.`}>
        <Table headers={["Feature", "Calls", "Tokens in", "Tokens out"]}>
          {usage.map((u) => (
            <tr key={u.feature} data-testid="ai-usage">
              <td className="py-1 pr-4 text-sm">{u.feature.replace(/_/g, " ")}</td>
              <td className="py-1 pr-4 text-sm tabular-nums">{u.calls}</td>
              <td className="py-1 pr-4 text-sm tabular-nums">{u.input_tokens}</td>
              <td className="py-1 pr-4 text-sm tabular-nums">{u.output_tokens}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
