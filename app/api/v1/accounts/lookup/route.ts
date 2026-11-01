import { apiCall } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

/** GET /api/v1/accounts/lookup?phone=&email= (accounts.read): the caller's accounts, properties and open leads. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  return apiCall(request, async (tx, key) => {
    const [{ r }] = await tx<{ r: unknown }[]>`select app.api_lookup(${key.key_id}, ${url.searchParams.get("phone")}, ${url.searchParams.get("email")}) as r`;
    return r;
  });
}
