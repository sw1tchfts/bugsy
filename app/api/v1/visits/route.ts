import { DAY, UUID, apiCall, need } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

/** GET /api/v1/visits?account_id=&from=&to= (visits.read): the account's visits in the range. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  return apiCall(request, async (tx, key) => {
    const account = need(url.searchParams.get("account_id"), UUID, "account_id");
    const from = need(url.searchParams.get("from"), DAY, "from");
    const to = need(url.searchParams.get("to"), DAY, "to");
    const [{ r }] = await tx<{ r: unknown }[]>`select app.api_visits(${key.key_id}, ${account}::uuid, ${from}::date, ${to}::date) as r`;
    return { visits: r };
  });
}
