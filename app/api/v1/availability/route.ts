import { UUID, apiCall, need } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

/** GET /api/v1/availability?property_id= (availability.read): open days in the next 14; it books nothing. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  return apiCall(request, async (tx, key) => {
    const property = need(url.searchParams.get("property_id"), UUID, "property_id");
    const [{ r }] = await tx<{ r: unknown }[]>`select app.api_availability(${key.key_id}, ${property}::uuid) as r`;
    return { days: r };
  });
}
