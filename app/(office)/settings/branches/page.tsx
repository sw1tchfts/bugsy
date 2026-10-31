import type { Metadata } from "next";
import { Button, Card, Empty, Field, Input, Notice, Table, errorMessage } from "@/components/ui";
import { can } from "@/lib/auth/permissions";
import { dbAs } from "@/lib/auth/session";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";
import { createBranch, setBranchArchived } from "./actions";

export const metadata: Metadata = { title: "Branches" };

type Branch = {
  id: string;
  name: string;
  address: string;
  state_code: string;
  business_license_number: string | null;
  license_year: number | null;
  archived_at: string | null;
};

export default async function BranchesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { session, active } = await requireActiveTenant();
  const { error } = await searchParams;
  const canWrite = can(active.permissions, "settings.write");

  const branches = await dbAs(session, (tx) =>
    tx<Branch[]>`select id, name, address, state_code, business_license_number, license_year, archived_at
                 from public.branches where tenant_id = ${active.tenantId} order by archived_at nulls first, name`,
  );

  return (
    <>
      <h1 className="text-2xl font-semibold">Branches</h1>
      {error ? <Notice kind="error">{errorMessage(error)}</Notice> : null}

      <Card title="Locations" description="Each branch is a business location. Whether it needs its own pesticide business license depends on its state.">
        {branches.length === 0 ? (
          <Empty>No branches yet.</Empty>
        ) : (
          <Table headers={["Name", "Address", "State", "Business license", "License year", "Status", ""]}>
            {branches.map((b) => (
              <tr key={b.id} className={b.archived_at ? "text-stone-400" : ""}>
                <td className="py-2 pr-4 font-medium">{b.name}</td>
                <td className="py-2 pr-4">{b.address}</td>
                <td className="py-2 pr-4">{b.state_code}</td>
                <td className="py-2 pr-4">{b.business_license_number ?? ""}</td>
                <td className="py-2 pr-4 tabular-nums">{b.license_year ?? ""}</td>
                <td className="py-2 pr-4">{b.archived_at ? "Archived" : "Active"}</td>
                <td className="py-2 text-right">
                  {canWrite ? (
                    <form action={setBranchArchived}>
                      <input type="hidden" name="tenant_id" value={active.tenantId} />
                      <input type="hidden" name="branch_id" value={b.id} />
                      <input type="hidden" name="archive" value={b.archived_at ? "false" : "true"} />
                      <Button type="submit" variant="secondary">
                        {b.archived_at ? "Restore" : "Archive"}
                      </Button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>

      {canWrite ? (
        <Card title="Add a branch">
          <form action={createBranch} className="grid gap-4 sm:grid-cols-2">
            <input type="hidden" name="tenant_id" value={active.tenantId} />
            <Field label="Name" htmlFor="name">
              <Input id="name" name="name" required maxLength={80} />
            </Field>
            <Field label="Address" htmlFor="address">
              <Input id="address" name="address" required maxLength={200} />
            </Field>
            <Field label="State" htmlFor="state_code" hint="Two-letter code, for example OH">
              <Input id="state_code" name="state_code" required pattern="[A-Za-z]{2}" maxLength={2} />
            </Field>
            <Field label="Business license number" htmlFor="business_license_number">
              <Input id="business_license_number" name="business_license_number" maxLength={60} />
            </Field>
            <Field label="License year" htmlFor="license_year">
              <Input id="license_year" name="license_year" type="number" min={2000} max={2100} />
            </Field>
            <div className="flex items-end">
              <Button type="submit">Add branch</Button>
            </div>
          </form>
        </Card>
      ) : null}
    </>
  );
}
