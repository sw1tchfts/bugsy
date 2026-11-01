import { apiCall, body } from "@/lib/api/auth";

export const dynamic = "force-dynamic";

/** POST /api/v1/device-events (devices.write): a smart trap's catch or alert, as a sensor check on its device. */
export async function POST(request: Request) {
  return apiCall(request, async (tx, key) => {
    const payload = await body(request);
    const [{ r }] = await tx<{ r: unknown }[]>`select app.api_device_event(${key.key_id}, ${tx.json(payload as never)}) as r`;
    return r;
  }, 201);
}
