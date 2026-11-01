import { describe, expect, it } from "vitest";
import { cleanScopes, hasScope, hashKey, newKey, parseKey, sameHash } from "@/lib/api/keys";
import { balanced, summarizeDay } from "@/lib/quickbooks/summary";
import { deliverable, post, privateAddress } from "@/lib/webhooks/db";
import { RETRY_MINUTES, nextAttempt, sign, verify } from "@/lib/webhooks/events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

describe("API keys (spec 20 rule 1)", () => {
  it("makes a key that parses back to its prefix and is stored only as a hash", () => {
    const k = newKey();
    expect(k.key.startsWith(`bgy_${k.prefix}_`)).toBe(true);
    expect(parseKey(`Bearer ${k.key}`)).toEqual({ prefix: k.prefix, key: k.key });
    expect(sameHash(hashKey(k.key), k.hash)).toBe(true);
    expect(parseKey("bgy_short_x")).toBeNull();
  });

  it("keeps only known scopes and checks them", () => {
    expect(cleanScopes(["leads.write", "root", "availability.read"])).toEqual(["leads.write", "availability.read"]);
    expect(hasScope(["leads.write"], "visits.read")).toBe(false);
  });
});

describe("webhooks (spec 20 rules 5 and 6)", () => {
  it("signs the timestamp and body so the receiver can check them, and refuses old or altered ones", () => {
    const at = new Date("2026-11-01T12:00:00Z");
    const header = sign("whsec_test", '{"a":1}', at);
    expect(verify("whsec_test", '{"a":1}', header, at)).toBe(true);
    expect(verify("whsec_test", '{"a":2}', header, at)).toBe(false);
    expect(verify("whsec_other", '{"a":1}', header, at)).toBe(false);
    expect(verify("whsec_test", '{"a":1}', header, new Date(at.getTime() + 10 * 60_000))).toBe(false);
  });

  it("retries on the schedule and then gives up", () => {
    const t = new Date("2026-11-01T12:00:00Z");
    expect(nextAttempt(1, t)?.toISOString()).toBe("2026-11-01T12:01:00.000Z");
    expect(nextAttempt(RETRY_MINUTES.length, t)?.toISOString()).toBe("2026-11-02T00:00:00.000Z");
    expect(nextAttempt(RETRY_MINUTES.length + 1, t)).toBeNull();
  });

  it("sends only to https on public hosts (review fix)", async () => {
    const resolve = (ips: string[]) => async () => ips;
    expect(await deliverable("https://hooks.example.com/x", resolve(["93.184.216.34"]), true)).toBe(true);
    expect(await deliverable("http://hooks.example.com/x", resolve(["93.184.216.34"]), true)).toBe(false);
    expect(await deliverable("https://inside.example.com/x", resolve(["10.0.0.5"]), true)).toBe(false);
    expect(await deliverable("https://169.254.169.254/latest/meta-data", resolve([]), true)).toBe(false);
    expect(await deliverable("http://127.0.0.1:4000/hook", resolve([]), true)).toBe(false);
    expect(await deliverable("http://127.0.0.1:4000/hook", resolve([]), false)).toBe(true);
    expect(["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.1.1", "100.64.0.1", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"].every(privateAddress)).toBe(true);
    expect(["93.184.216.34", "8.8.8.8", "2606:4700::1111"].some(privateAddress)).toBe(false);
  });

  it("counts a receiver that does not answer in time as a failure (edge case)", async () => {
    const server = createServer(() => undefined);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const r = await post(`http://127.0.0.1:${(server.address() as AddressInfo).port}/slow`, "s", "{}", 300);
    server.closeAllConnections();
    server.close();
    expect(r.status).toBe(0);
  });
});

describe("the QuickBooks day (spec 20 rule 7)", () => {
  const mapping = [
    { gl_account_id: "ar", qbo_account_id: "1", qbo_account_name: "Accounts Receivable" },
    { gl_account_id: "rev", qbo_account_id: "2", qbo_account_name: "Service Income" },
    { gl_account_id: "def", qbo_account_id: "3", qbo_account_name: "Deferred Revenue" },
  ];
  it("sums the day per mapped account into one balanced entry", () => {
    const r = summarizeDay(
      [
        { gl_account_id: "ar", account_name: "AR", debit_cents: 12900, credit_cents: 0 },
        { gl_account_id: "def", account_name: "Deferred", debit_cents: 0, credit_cents: 12900 },
        { gl_account_id: "def", account_name: "Deferred", debit_cents: 12900, credit_cents: 0 },
        { gl_account_id: "rev", account_name: "Revenue", debit_cents: 0, credit_cents: 12900 },
      ],
      mapping,
    );
    expect(r).toEqual({ ok: true, lines: [
      { qbo_account_id: "1", qbo_account_name: "Accounts Receivable", posting: "Debit", amount_cents: 12900 },
      { qbo_account_id: "2", qbo_account_name: "Service Income", posting: "Credit", amount_cents: 12900 },
    ] });
    if (r.ok) expect(balanced(r.lines)).toBe(true);
  });

  it("refuses a day that moves an unmapped account", () => {
    expect(summarizeDay([{ gl_account_id: "cash", account_name: "Operating bank", debit_cents: 500, credit_cents: 0 }], mapping)).toEqual({ ok: false, unmapped: ["Operating bank"] });
  });
});
