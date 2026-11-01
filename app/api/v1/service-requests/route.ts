import { apiCall, body } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

/** POST /api/v1/service-requests (requests.write): a booking or re-service request for the office to confirm. */
export async function POST(request: Request) {
  return apiCall(request, async (tx, key) => {
    const payload = await body(request);
    const [{ r }] = await tx<{ r: unknown }[]>`select app.api_create_request(${key.key_id}, ${tx.json(payload as never)}) as r`;
    return r;
  }, 201);
}
