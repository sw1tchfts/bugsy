import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Button, Card, Empty, Input, Table } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { phoneDigits } from "@/lib/geo/normalize";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

export const metadata: Metadata = { title: "Customers" };

type Row = {
  id: string;
  name: string;
  type: string;
  email: string | null;
  phone: string | null;
  status: string;
  properties: number;
  first_address: string | null;
};

const TYPE_LABEL: Record<string, string> = { residential: "Residential", commercial: "Commercial", property_manager: "Property manager" };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { session, active } = await requireActiveTenant();
  const { q = "" } = await searchParams;
  const term = q.trim();
  const like = `%${term}%`;
  const digits = phoneDigits(term);
  // Quote numbers are small integers; anything longer is a phone number and must not reach the int cast.
  const quoteNumber = /^\d{1,9}$/.test(term) ? Number(term) : null;

  const rows = await dbAs(session, (tx) =>
    tx<Row[]>`
      select a.id, a.name, a.type, a.email, a.phone, a.status,
             (select count(*)::int from public.properties p where p.account_id = a.id and p.archived_at is null) as properties,
             (select p.normalized_address from public.properties p where p.account_id = a.id and p.archived_at is null order by p.created_at limit 1) as first_address
      from public.accounts a
      where a.tenant_id = ${active.tenantId} and a.archived_at is null
        and (${term} = ''
          or a.name ilike ${like}
          or a.email ilike ${like}
          or (${digits}::text is not null and a.phone_digits = ${digits})
          or exists (select 1 from public.properties p where p.account_id = a.id and (p.line1 ilike ${like} or p.city ilike ${like} or p.normalized_address ilike ${like}))
          or exists (select 1 from public.contacts c where c.account_id = a.id and (c.name ilike ${like} or c.email ilike ${like} or (${digits}::text is not null and c.phone_digits = ${digits})))
          or (${quoteNumber}::int is not null and exists (select 1 from public.quotes qq where qq.account_id = a.id and qq.number = ${quoteNumber})))
      order by a.name
      limit 200`,
  );

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Customers</h1>
        {can(active.permissions, "customers.write") ? (
          <Link href="/customers/new">
            <Button type="button">New account</Button>
          </Link>
        ) : null}
      </div>

      <form method="get" className="flex max-w-xl gap-2">
        <label htmlFor="q" className="sr-only">
          Search
        </label>
        <Input id="q" name="q" type="search" defaultValue={term} placeholder="Name, address, phone, email or quote number" />
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      <Card title={term ? `Results for "${term}"` : "Accounts"}>
        {rows.length === 0 ? (
          <Empty>{term ? "Nothing matches." : "No customers yet."}</Empty>
        ) : (
          <Table headers={["Account", "Type", "Service address", "Phone", "Email", "Properties"]}>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="py-2 pr-4 font-medium">
                  <Link href={`/customers/${r.id}`} className="hover:underline">
                    {r.name}
                  </Link>{" "}
                  {r.status === "inactive" ? <Badge>Inactive</Badge> : null}
                </td>
                <td className="py-2 pr-4">{TYPE_LABEL[r.type] ?? r.type}</td>
                <td className="py-2 pr-4 text-stone-600">{r.first_address ?? ""}</td>
                <td className="py-2 pr-4">{r.phone ?? ""}</td>
                <td className="py-2 pr-4">{r.email ?? ""}</td>
                <td className="py-2 pr-4 tabular-nums">{r.properties}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
