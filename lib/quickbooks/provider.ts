// QuickBooks Online (spec 20 rule 7): OAuth and JournalEntry create through Intuit's API when keys are set, and a local
// provider otherwise (development and tests), the way payments use a local gateway.
import type { SummaryLine } from "./summary";

export type QboTokens = { access_token: string; refresh_token: string; expires_at: number; realm_id: string };
export type QboAccount = { id: string; name: string; type: string };

export interface QuickBooksProvider {
  readonly kind: "intuit" | "local";
  authorizeUrl(state: string, redirectUri: string): string;
  exchange(code: string, realmId: string, redirectUri: string): Promise<QboTokens>;
  refresh(tokens: QboTokens): Promise<QboTokens>;
  accounts(tokens: QboTokens): Promise<QboAccount[]>;
  /** `requestId` makes a repeat of the same day's entry a no-op at Intuit (rule 7: a day is sent once). */
  createEntry(tokens: QboTokens, day: string, memo: string, lines: readonly SummaryLine[], requestId: string): Promise<string>;
}

const LOCAL_ACCOUNTS: QboAccount[] = [
  ["10", "Checking", "Bank"], ["11", "Undeposited Funds", "Other Current Asset"], ["12", "Accounts Receivable (A/R)", "Accounts receivable"],
  ["13", "Unbilled Receivables", "Other Current Asset"], ["14", "Inventory Asset", "Other Current Asset"], ["20", "Accounts Payable (A/P)", "Accounts payable"],
  ["21", "Deferred Revenue", "Other Current Liability"], ["22", "Sales Tax Payable", "Other Current Liability"], ["23", "Payroll Liabilities", "Other Current Liability"],
  ["24", "Commissions Payable", "Other Current Liability"], ["30", "Opening Balance Equity", "Equity"], ["31", "Retained Earnings", "Equity"],
  ["40", "Services", "Income"], ["41", "Other Income", "Other Income"], ["50", "Cost of Goods Sold", "Cost of Goods Sold"], ["51", "Wages", "Cost of Goods Sold"],
  ["60", "Commissions", "Expense"], ["61", "Merchant Fees", "Expense"], ["62", "Licenses and Permits", "Expense"], ["63", "Vehicle Expenses", "Expense"],
].map(([id, name, type]) => ({ id, name, type }));

export const localQuickBooks: QuickBooksProvider = {
  kind: "local",
  authorizeUrl: (state, redirectUri) => `${redirectUri}?code=local&realmId=local-realm&state=${encodeURIComponent(state)}`,
  exchange: async (_code, realmId) => ({ access_token: "local", refresh_token: "local", expires_at: Date.now() + 3_600_000, realm_id: realmId }),
  refresh: async (t) => ({ ...t, expires_at: Date.now() + 3_600_000 }),
  accounts: async () => LOCAL_ACCOUNTS,
  createEntry: async (_t, day) => `local-${day}`,
};

const INTUIT_AUTH = "https://appcenter.intuit.com/connect/oauth2";
const INTUIT_TOKEN = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const apiBase = () => (process.env.QBO_SANDBOX === "1" ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com");

async function token(body: Record<string, string>): Promise<{ access_token: string; refresh_token: string; expires_in: number }> {
  const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(INTUIT_TOKEN, { method: "POST", headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: new URLSearchParams(body) });
  if (!res.ok) throw Object.assign(new Error(`QuickBooks refused the token (${res.status})`), { code: "QBO_AUTH" });
  return (await res.json()) as { access_token: string; refresh_token: string; expires_in: number };
}

export const intuitQuickBooks: QuickBooksProvider = {
  kind: "intuit",
  authorizeUrl: (state, redirectUri) =>
    `${INTUIT_AUTH}?${new URLSearchParams({ client_id: process.env.QBO_CLIENT_ID ?? "", response_type: "code", scope: "com.intuit.quickbooks.accounting", redirect_uri: redirectUri, state })}`,
  exchange: async (code, realmId, redirectUri) => {
    const t = await token({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
    return { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000, realm_id: realmId };
  },
  refresh: async (tokens) => {
    const t = await token({ grant_type: "refresh_token", refresh_token: tokens.refresh_token });
    return { ...tokens, access_token: t.access_token, refresh_token: t.refresh_token, expires_at: Date.now() + t.expires_in * 1000 };
  },
  accounts: async (t) => {
    const q = encodeURIComponent("select Id, Name, AccountType from Account where Active = true maxresults 500");
    const res = await fetch(`${apiBase()}/v3/company/${t.realm_id}/query?query=${q}`, { headers: { authorization: `Bearer ${t.access_token}`, accept: "application/json" } });
    if (!res.ok) throw Object.assign(new Error(`QuickBooks refused the account list (${res.status})`), { code: res.status === 401 ? "QBO_AUTH" : "QBO" });
    const data = (await res.json()) as { QueryResponse?: { Account?: { Id: string; Name: string; AccountType: string }[] } };
    return (data.QueryResponse?.Account ?? []).map((a) => ({ id: a.Id, name: a.Name, type: a.AccountType }));
  },
  createEntry: async (t, day, memo, lines, requestId) => {
    const body = {
      TxnDate: day,
      PrivateNote: memo,
      Line: lines.map((l, i) => ({
        Id: String(i),
        Description: memo,
        Amount: Number((l.amount_cents / 100).toFixed(2)),
        DetailType: "JournalEntryLineDetail",
        JournalEntryLineDetail: { PostingType: l.posting, AccountRef: { value: l.qbo_account_id, name: l.qbo_account_name } },
      })),
    };
    const res = await fetch(`${apiBase()}/v3/company/${t.realm_id}/journalentry?requestid=${encodeURIComponent(requestId.slice(0, 50))}`, {
      method: "POST",
      headers: { authorization: `Bearer ${t.access_token}`, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw Object.assign(new Error(`QuickBooks refused the entry (${res.status}): ${(await res.text()).slice(0, 200)}`), { code: res.status === 401 ? "QBO_AUTH" : "QBO" });
    return ((await res.json()) as { JournalEntry: { Id: string } }).JournalEntry.Id;
  },
};

export function quickBooks(): QuickBooksProvider {
  return process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET ? intuitQuickBooks : localQuickBooks;
}
