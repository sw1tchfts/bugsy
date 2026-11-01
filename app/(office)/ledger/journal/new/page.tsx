import type { Metadata } from "next";
import Link from "next/link";
import { Button, Card, Field, Input, Notice, Select, Textarea, errorMessage } from "@/components/ui";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { todayInZone } from "@/lib/dates";
import { accounts } from "@/lib/ledger/db";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { postManualEntry } from "../../actions";

export const metadata: Metadata = { title: "New journal entry" };

const LINES = [0, 1, 2, 3, 4, 5];

export default async function NewEntryPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  await requirePermission(active.tenantId, "gl.write");
  const { error } = await searchParams;
  const list = (await dbAs(session, (tx) => accounts(tx, active.tenantId))).filter((a) => a.active);

  return (
    <>
      <p className="text-sm text-stone-500">
        <Link href="/ledger" className="hover:underline">
          Ledger
        </Link>{" "}
        /{" "}
        <Link href="/ledger/journal" className="hover:underline">
          Journal
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">New manual entry</h1>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}
      <Card title="Entry" description="Debits equal credits to the cent; the period must be open. A line on deferred revenue names its agreement.">
        <form action={postManualEntry} className="grid gap-4">
          <input type="hidden" name="tenant_id" value={active.tenantId} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Date" htmlFor="je-date">
              <Input id="je-date" name="posted_on" type="date" defaultValue={todayInZone(active.tenantTimezone)} required />
            </Field>
            <div className="sm:col-span-2">
              <Field label="Memo" htmlFor="je-memo">
                <Textarea id="je-memo" name="memo" rows={2} required />
              </Field>
            </div>
          </div>
          <div className="grid gap-2">
            <div className="hidden text-xs font-medium text-stone-500 sm:grid sm:grid-cols-12 sm:gap-2">
              <span className="col-span-5">Account</span>
              <span className="col-span-2">Debit ($)</span>
              <span className="col-span-2">Credit ($)</span>
              <span className="col-span-1">Agreement #</span>
              <span className="col-span-2">Line memo</span>
            </div>
            {LINES.map((i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-12" data-testid="je-line">
                <div className="sm:col-span-5">
                  <Select name="line_account" aria-label={`Account for line ${i + 1}`} defaultValue="">
                    <option value="">(blank)</option>
                    {list.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.number} {a.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="sm:col-span-2">
                  <Input name="line_debit" inputMode="decimal" aria-label={`Debit for line ${i + 1}`} />
                </div>
                <div className="sm:col-span-2">
                  <Input name="line_credit" inputMode="decimal" aria-label={`Credit for line ${i + 1}`} />
                </div>
                <div className="sm:col-span-1">
                  <Input name="line_agreement" inputMode="numeric" aria-label={`Agreement for line ${i + 1}`} />
                </div>
                <div className="sm:col-span-2">
                  <Input name="line_memo" aria-label={`Memo for line ${i + 1}`} />
                </div>
              </div>
            ))}
          </div>
          <div>
            <Button type="submit">Post entry</Button>
          </div>
        </form>
      </Card>
    </>
  );
}
