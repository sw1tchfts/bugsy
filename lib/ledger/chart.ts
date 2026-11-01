// The pest chart of accounts template (spec 09, pest-accounting skill). Keys are what the fixtures and the posting
// rules name; numbers and names are the company's to change, keys and types are not.

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";
export type AccountSubtype =
  | "bank"
  | "clearing"
  | "receivable"
  | "contract_asset"
  | "inventory"
  | "fixed_asset"
  | "contract_liability"
  | "tax_payable"
  | "payable"
  | "service_revenue"
  | "other_income"
  | "cost_of_service"
  | "operating_expense"
  | "equity";

export type TemplateAccount = { key: string; number: string; name: string; type: AccountType; subtype: AccountSubtype };

export const CHART_TEMPLATE = [
  { key: "operating_bank", number: "1000", name: "Operating bank account", type: "asset", subtype: "bank" },
  { key: "stripe_clearing", number: "1050", name: "Payment gateway clearing", type: "asset", subtype: "clearing" },
  { key: "accounts_receivable", number: "1200", name: "Accounts receivable", type: "asset", subtype: "receivable" },
  { key: "contract_asset", number: "1250", name: "Unbilled receivables (contract asset)", type: "asset", subtype: "contract_asset" },
  { key: "chemical_inventory", number: "1300", name: "Chemical inventory", type: "asset", subtype: "inventory" },
  { key: "vehicles", number: "1500", name: "Vehicles", type: "asset", subtype: "fixed_asset" },
  { key: "contract_liability", number: "2100", name: "Deferred revenue (contract liability)", type: "liability", subtype: "contract_liability" },
  { key: "sales_tax_payable", number: "2200", name: "Sales tax payable", type: "liability", subtype: "tax_payable" },
  { key: "commissions_payable", number: "2300", name: "Commissions payable", type: "liability", subtype: "payable" },
  { key: "payroll_liabilities", number: "2400", name: "Payroll liabilities", type: "liability", subtype: "payable" },
  { key: "opening_balance_equity", number: "3000", name: "Opening balance equity", type: "equity", subtype: "equity" },
  { key: "retained_earnings", number: "3900", name: "Retained earnings", type: "equity", subtype: "equity" },
  { key: "revenue_general_pest", number: "4100", name: "General pest revenue", type: "revenue", subtype: "service_revenue" },
  { key: "revenue_rodent", number: "4200", name: "Rodent revenue", type: "revenue", subtype: "service_revenue" },
  { key: "revenue_termite", number: "4300", name: "Termite revenue", type: "revenue", subtype: "service_revenue" },
  { key: "revenue_mosquito", number: "4400", name: "Mosquito and tick revenue", type: "revenue", subtype: "service_revenue" },
  { key: "revenue_bed_bug", number: "4500", name: "Bed bug revenue", type: "revenue", subtype: "service_revenue" },
  { key: "revenue_wildlife", number: "4600", name: "Wildlife revenue", type: "revenue", subtype: "service_revenue" },
  { key: "revenue_other", number: "4800", name: "Other service revenue", type: "revenue", subtype: "service_revenue" },
  { key: "cancellation_fee_income", number: "4900", name: "Cancellation fee income", type: "revenue", subtype: "other_income" },
  { key: "late_fee_income", number: "4950", name: "Late fee income", type: "revenue", subtype: "other_income" },
  { key: "chemical_cost", number: "5100", name: "Chemical cost", type: "expense", subtype: "cost_of_service" },
  { key: "technician_labor", number: "5200", name: "Technician labor", type: "expense", subtype: "cost_of_service" },
  { key: "commissions_expense", number: "6100", name: "Commissions expense", type: "expense", subtype: "operating_expense" },
  { key: "processing_fees", number: "6200", name: "Payment processing fees", type: "expense", subtype: "operating_expense" },
  { key: "licenses_and_permits", number: "6300", name: "Licenses and permits", type: "expense", subtype: "operating_expense" },
  { key: "vehicle_expense", number: "6400", name: "Vehicle expense", type: "expense", subtype: "operating_expense" },
] as const satisfies readonly TemplateAccount[];

export type AccountKey = (typeof CHART_TEMPLATE)[number]["key"];

export const ACCOUNT_KEYS: readonly AccountKey[] = CHART_TEMPLATE.map((a) => a.key);

const REVENUE_BY_LINE: Record<string, AccountKey> = {
  general_pest: "revenue_general_pest",
  rodent: "revenue_rodent",
  termite: "revenue_termite",
  mosquito: "revenue_mosquito",
  bed_bug: "revenue_bed_bug",
  wildlife: "revenue_wildlife",
};

/** The revenue account for a service line; work with no line is other service revenue. */
export function revenueAccountFor(serviceLine: string | null | undefined): AccountKey {
  return (serviceLine && REVENUE_BY_LINE[serviceLine]) || "revenue_other";
}

/** Which side carries an account's balance; a debit-normal account shows debits as positive. */
export function normalBalance(type: AccountType): "debit" | "credit" {
  return type === "asset" || type === "expense" ? "debit" : "credit";
}

export function isAccountKey(value: string): value is AccountKey {
  return (ACCOUNT_KEYS as readonly string[]).includes(value);
}
