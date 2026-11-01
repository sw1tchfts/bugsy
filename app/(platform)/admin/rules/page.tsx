import type { Metadata } from "next";
import { PlatformShell } from "@/components/platform-shell";
import { Badge, Card, Empty, Table } from "@/components/ui";
import { dbAs, requirePlatformAdmin } from "@/lib/auth/session";
import { PACKS } from "@/lib/compliance/rules";
import { stateCoverage } from "@/lib/platform/db";
import { coverage, packRules } from "@/lib/platform/rules";

export const metadata: Metadata = { title: "State rule packs" };

/** The state rule packs and where the companies work without one (spec 13 rule 12). Packs change in code, by review. */
export default async function RulesPage() {
  const session = await requirePlatformAdmin();
  const served = await dbAs(session, (tx) => stateCoverage(tx));
  const rows = coverage(served, PACKS);
  const packs = Object.values(PACKS).sort((a, b) => a.stateCode.localeCompare(b.stateCode));

  return (
    <PlatformShell email={session.email}>
      <h1 className="text-2xl font-semibold">State rule packs</h1>
      <p className="text-sm text-stone-600">
        Each state&apos;s pesticide rules are data in one pack per state, with a source and an effective date on every value. Packs change in code, through review, never in this console. Where a state has no pack, the
        product applies the conservative default from the pesticide-compliance skill, and records are kept until a pack sets a retention period.
      </p>
      <Card title="States the companies serve">
        {rows.length === 0 ? (
          <Empty>No company has properties yet.</Empty>
        ) : (
          <Table headers={["State", "Companies", "Properties", "Pack"]}>
            {rows.map((r) => (
              <tr key={r.state_code} data-testid="coverage-row">
                <td className="py-2 pr-4 font-medium">{r.state_code}</td>
                <td className="py-2 pr-4 tabular-nums">{r.companies}</td>
                <td className="py-2 pr-4 tabular-nums">{r.properties}</td>
                <td className="py-2 pr-4">{r.pack ? `version ${r.pack.version}, effective ${r.pack.effectiveOn}` : <Badge tone="warn">no pack: conservative default</Badge>}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {packs.length === 0 ? (
        <Card title="Packs">
          <Empty>No state is researched yet. Add one with the pesticide-compliance skill&apos;s steps.</Empty>
        </Card>
      ) : (
        packs.map((p) => (
          <Card key={p.stateCode} title={`${p.stateCode}, version ${p.version}`} description={`Effective ${p.effectiveOn}.`}>
            <Table headers={["Rule", "Value", "Source", "Effective"]}>
              {packRules(p).map((r) => (
                <tr key={r.key}>
                  <td className="py-1 pr-4 font-mono text-xs">{r.key}</td>
                  <td className="py-1 pr-4 font-mono text-xs">{r.value}</td>
                  <td className="py-1 pr-4 text-xs">{r.source}</td>
                  <td className="py-1 pr-4 text-xs">{r.effectiveOn}</td>
                </tr>
              ))}
            </Table>
          </Card>
        ))
      )}
    </PlatformShell>
  );
}
