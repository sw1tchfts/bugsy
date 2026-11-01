import { describe, expect, it } from "vitest";
import { lobAddress } from "@/lib/messaging/lob";
import { postmarkOutcome } from "@/lib/messaging/postmark";
import { twilioSignature, twilioStatus, validTwilioSignature } from "@/lib/messaging/twilio";

describe("provider webhooks", () => {
  // The worked example in Twilio's security documentation (twilio.com/docs/usage/security).
  const url = "https://example.com/myapp.php?foo=1&bar=2";
  const params = { CallSid: "CA1234567890ABCDE", Caller: "+14158675310", Digits: "1234", From: "+14158675310", To: "+18005551212" };

  it("computes Twilio's documented signature and refuses a tampered request", () => {
    expect(twilioSignature("12345", url, params)).toBe("L/OH5YylLD5NRKLltdqwSvS0BnU=");
    expect(validTwilioSignature("12345", url, params, "L/OH5YylLD5NRKLltdqwSvS0BnU=")).toBe(true);
    expect(validTwilioSignature("12345", url, { ...params, Digits: "9999" }, "L/OH5YylLD5NRKLltdqwSvS0BnU=")).toBe(false);
    expect(validTwilioSignature("12345", url, params, null)).toBe(false);
  });

  it("maps Twilio statuses and Postmark events onto the outbox", () => {
    expect(twilioStatus("delivered")).toBe("delivered");
    expect(twilioStatus("undelivered")).toBe("failed");
    expect(twilioStatus("queued")).toBe("sent");
    expect(twilioStatus("receiving")).toBeNull();
    expect(postmarkOutcome({ RecordType: "Delivery", Recipient: "A@B.com" })).toEqual({ status: "delivered", suppress: null, address: "a@b.com" });
    expect(postmarkOutcome({ RecordType: "Bounce", Type: "HardBounce", Email: "x@y.com" })).toEqual({ status: "failed", suppress: "bounce", address: "x@y.com" });
    expect(postmarkOutcome({ RecordType: "Bounce", Type: "SoftBounce", Email: "x@y.com" }).suppress).toBeNull();
    expect(postmarkOutcome({ RecordType: "SpamComplaint", Email: "x@y.com" }).suppress).toBe("complaint");
  });

  it("splits an address into Lob's fields", () => {
    expect(lobAddress("Maria Lopez", "1234 Neil Ave, Columbus OH 43201")).toMatchObject({ address_line1: "1234 Neil Ave", address_city: "Columbus", address_state: "OH", address_zip: "43201" });
  });
});
