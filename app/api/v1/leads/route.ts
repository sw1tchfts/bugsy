import { apiCall, body } from "@/lib/api/auth";
import { normalizeAddress } from "@/lib/geo/normalize";

export const dynamic = "force-dynamic";

/** POST /api/v1/leads (leads.write): a lead with its source; possible matches come back, nothing is refused for them. */
export async function POST(request: Request) {
  return apiCall(request, async (tx, key) => {
    const payload = await body(request);
    // Rule 3: the office's duplicate rule matches on the normalized address too.
    const text = (k: string) => (typeof payload[k] === "string" ? (payload[k] as string).trim() : "");
    if (text("line1") && text("city") && text("state_code") && text("postal_code")) {
      payload.normalized_address = normalizeAddress({ line1: text("line1"), city: text("city"), stateCode: text("state_code"), postalCode: text("postal_code") });
    } else delete payload.normalized_address;
    const [{ r }] = await tx<{ r: unknown }[]>`select app.api_create_lead(${key.key_id}, ${tx.json(payload as never)}) as r`;
    return r;
  }, 201);
}
