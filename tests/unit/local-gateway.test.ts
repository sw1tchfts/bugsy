import { describe, expect, it } from "vitest";
import { localGateway } from "@/lib/payments/local";

describe("the local gateway (rule 13, decisions)", () => {
  it("keeps only the brand, last four and expiry of a card, never the number", async () => {
    const saved = await localGateway.savePaymentMethod({ account_id: null, customer_id: "local_cus_1", token: "card:4242 4242 4242 4242:12:2030" });
    expect(saved).toEqual({ gateway_payment_method_id: expect.stringMatching(/^local_pm_[0-9a-f]{20}$/), kind: "card", brand: "Visa", last4: "4242", exp_month: 12, exp_year: 2030 });
    expect(JSON.stringify(saved)).not.toContain("4242424242424242");
    const bank = await localGateway.savePaymentMethod({ account_id: null, customer_id: "local_cus_1", token: "bank:000123456789" });
    expect(bank.kind).toBe("us_bank_account");
    expect(bank.last4).toBe("6789");
    await expect(localGateway.savePaymentMethod({ account_id: null, customer_id: "local_cus_1", token: "card:12" })).rejects.toThrow(/too short/);
  });

  it("gives the same method id for the same card on the same customer, so a re-add does not duplicate", async () => {
    const a = await localGateway.savePaymentMethod({ account_id: null, customer_id: "c", token: "card:4242424242424242:1:2031" });
    const b = await localGateway.savePaymentMethod({ account_id: null, customer_id: "c", token: "card:4242-4242-4242-4242:2:2032" });
    expect(a.gateway_payment_method_id).toBe(b.gateway_payment_method_id);
  });

  it("declines ...0002, fails the first autopay attempt on ...0341 and succeeds on the retry, and approves the rest", async () => {
    const base = { account_id: null, customer_id: "c", payment_method_id: "local_pm_x", amount_cents: 1000, description: "test" };
    expect((await localGateway.charge({ ...base, method_last4: "0002", idempotency_key: "charge:1" })).status).toBe("failed");
    expect((await localGateway.charge({ ...base, method_last4: "0341", idempotency_key: "autopay:inv:1" })).status).toBe("failed");
    expect((await localGateway.charge({ ...base, method_last4: "0341", idempotency_key: "autopay:inv:2" })).status).toBe("succeeded");
    expect((await localGateway.charge({ ...base, method_last4: "4242", idempotency_key: "autopay:inv:1" })).status).toBe("succeeded");
  });

  it("answers the same payment id for the same idempotency key", async () => {
    const base = { account_id: null, customer_id: "c", payment_method_id: "local_pm_x", method_last4: "4242", amount_cents: 1000, description: "test", idempotency_key: "charge:same" };
    expect((await localGateway.charge(base)).gateway_payment_id).toBe((await localGateway.charge(base)).gateway_payment_id);
    expect((await localGateway.refund({ account_id: null, gateway_payment_id: "local_pi_1", amount_cents: 500, idempotency_key: "refund:1" })).status).toBe("succeeded");
    expect(await localGateway.parseWebhook("", null)).toBeNull();
  });
});
