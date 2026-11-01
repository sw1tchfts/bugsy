import { afterEach, describe, expect, it, vi } from "vitest";
import { postmarkProvider } from "@/lib/messaging/postmark";
import { attempt } from "@/lib/messaging/providers";
import { twilioProvider } from "@/lib/messaging/twilio";

const email = { message_id: "m1", to: "a@example.com", from: "Co <no-reply@example.com>", reply_to: null, subject: "s", text: "t", html: null };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a provider call never throws into the send loop (spec 11 rule 1)", () => {
  it("records a network failure as a failed send", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const result = await attempt(() => postmarkProvider("token").sendEmail!(email));
    expect(result).toEqual({ provider_message_id: null, status: "failed", error: "provider call failed: fetch failed" });
  });

  it("records a provider that does not answer in time as a failed send, and gives every call a deadline", async () => {
    const fetchMock = vi.fn().mockRejectedValue(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await attempt(() => twilioProvider("AC1", "tok").sendSms!({ message_id: "m2", to: "+16145550100", from: "+16145550000", body: "hi", status_callback: null }));
    expect(result.status).toBe("failed");
    expect(result.error).toBe("the provider did not answer in time");
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal);
  });

  it("passes a provider's own answer through", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ MessageID: "pm-1" }), { status: 200 })));
    expect(await attempt(() => postmarkProvider("token").sendEmail!(email))).toEqual({ provider_message_id: "pm-1", status: "sent", error: null });
  });
});
