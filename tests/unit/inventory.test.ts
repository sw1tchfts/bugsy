import { describe, expect, it } from "vitest";
import { countDifference, levels, movementProblems, movingAverage, stockFlag, usageInStockUnit, valueCents } from "@/lib/inventory/stock";
import { type PostingLine, stockAdjustmentLines, stockReceiptLines } from "@/lib/ledger/post";

const plain = (lines: PostingLine[]) => lines.map(({ account, debit_cents, credit_cents }) => ({ account, debit_cents, credit_cents }));

describe("stock (spec 18 rules 1 to 4)", () => {
  it("converts an application into the product's stock unit, and refuses units that do not convert", () => {
    expect(usageInStockUnit("8", "fl_oz", "gal")).toBe(0.0625);
    expect(usageInStockUnit("2", "lb", "oz")).toBe(32);
    expect(usageInStockUnit("4", "fl_oz", "lb")).toBeNull();
    expect(usageInStockUnit("0", "fl_oz", "gal")).toBe(0);
  });

  it("averages the cost over what is on hand and what came in, half up, and starts fresh from nothing", () => {
    // 2 gal at $60.00 on hand, 3 gal received at $70.00: (120 + 210) / 5 = $66.00.
    expect(movingAverage(2, 6000, 3, 7000)).toBe(6600);
    // 1 gal at $10.00 and 2 gal at $10.01: 30.02 / 3 = 10.00666, half up to $10.01.
    expect(movingAverage(1, 1000, 2, 1001)).toBe(1001);
    expect(movingAverage(0, 6000, 3, 7000)).toBe(7000);
    expect(movingAverage(-1, 6000, 3, 7000)).toBe(7000);
    expect(valueCents(0.0625, 6400)).toBe(400);
  });

  it("keeps each location's level from its movements and flags negative and low stock", () => {
    const m = [
      { product_id: "p", from_location_id: null, to_location_id: "w", quantity: "5" },
      { product_id: "p", from_location_id: "w", to_location_id: "t", quantity: "2" },
      { product_id: "p", from_location_id: "t", to_location_id: null, quantity: "2.5" },
    ];
    const l = levels(m);
    expect(l.get("w:p")).toBe(3);
    expect(l.get("t:p")).toBe(-0.5);
    expect(stockFlag(-0.5, "truck", { truck_minimum: 1, warehouse_minimum: 4 })).toBe("negative");
    expect(stockFlag(3, "warehouse", { truck_minimum: 1, warehouse_minimum: 4 })).toBe("low");
    expect(stockFlag(3, "truck", { truck_minimum: 1, warehouse_minimum: null })).toBeNull();
    expect(countDifference(3, 2.75)).toBe(-0.25);
  });

  it("checks each movement's ends and quantity", () => {
    expect(movementProblems({ kind: "transfer", from: "a", to: "a", quantity: 1 })).toHaveLength(1);
    expect(movementProblems({ kind: "receipt", from: null, to: "a", quantity: 0 })).toHaveLength(1);
    expect(movementProblems({ kind: "receipt", from: null, to: "a", quantity: 2 })).toEqual([]);
  });

  it("posts receipts to inventory against the bank or payables, and counts against chemical cost", () => {
    expect(plain(stockReceiptLines(21000, "on_account"))).toEqual([
      { account: "chemical_inventory", debit_cents: 21000, credit_cents: 0 },
      { account: "accounts_payable", debit_cents: 0, credit_cents: 21000 },
    ]);
    expect(stockReceiptLines(21000, "now").map((l) => l.account)).toEqual(["chemical_inventory", "operating_bank"]);
    expect(plain(stockAdjustmentLines(-1650))).toEqual([
      { account: "chemical_cost", debit_cents: 1650, credit_cents: 0 },
      { account: "chemical_inventory", debit_cents: 0, credit_cents: 1650 },
    ]);
  });
});
