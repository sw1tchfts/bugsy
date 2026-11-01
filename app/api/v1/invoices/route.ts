import { UUID, apiCall, need } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

/** GET /api/v1/invoices?account_id= (invoices.read): the account's issued invoices with what is paid. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  return apiCall(request, async (tx, key) => {
    const account = need(url.searchParams.get("account_id"), UUID, "account_id");
    const [{ r }] = await tx<{ r: unknown }[]>`select app.api_invoices(${key.key_id}, ${account}::uuid) as r`;
    return { invoices: r };
  });
}
