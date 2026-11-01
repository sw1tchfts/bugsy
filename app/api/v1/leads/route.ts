import { apiCall, body } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

/** POST /api/v1/leads (leads.write): a lead with its source; possible matches come back, nothing is refused for them. */
export async function POST(request: Request) {
  return apiCall(request, async (tx, key) => {
    const payload = await body(request);
    const [{ r }] = await tx<{ r: unknown }[]>`select app.api_create_lead(${key.key_id}, ${tx.json(payload as never)}) as r`;
    return r;
  }, 201);
}
