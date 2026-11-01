import { describe, expect, it } from "vitest";
import { type AttemptRow, attemptsPlan, maxAttempts, nextAttempt } from "@/lib/billing/autopay";

const failed = (attempt: number, on: string): AttemptRow => ({ attempt, scheduled_for: on, attempted_at: `${on}T15:00:00Z`, result: "failed" });

describe("autopay timing (rule 8)", () => {
  it("plans the due date and one retry per configured interval", () => {
    expect(attemptsPlan("2026-11-01", [3, 7])).toEqual(["2026-11-01", "2026-11-04", "2026-11-11"]);
    expect(maxAttempts([3, 7])).toBe(3);
    expect(attemptsPlan("2026-11-01", [])).toEqual(["2026-11-01"]);
  });

  it("makes the first attempt on or after the due date and never before", () => {
    expect(nextAttempt([], "2026-11-05", [3, 7], "2026-11-04")).toBeNull();
    expect(nextAttempt([], "2026-11-05", [3, 7], "2026-11-05")).toEqual({ attempt: 1, scheduled_for: "2026-11-05" });
    expect(nextAttempt([], "2026-11-05", [3, 7], "2026-11-20")).toEqual({ attempt: 1, scheduled_for: "2026-11-05" });
  });

  it("retries the configured days after each failure, once per plan date, and stops when the plan is spent", () => {
    const one = [failed(1, "2026-11-05")];
    expect(nextAttempt(one, "2026-11-05", [3, 7], "2026-11-07")).toBeNull();
    expect(nextAttempt(one, "2026-11-05", [3, 7], "2026-11-08")).toEqual({ attempt: 2, scheduled_for: "2026-11-08" });
    const two = [...one, failed(2, "2026-11-08")];
    expect(nextAttempt(two, "2026-11-05", [3, 7], "2026-11-14")).toBeNull();
    expect(nextAttempt(two, "2026-11-05", [3, 7], "2026-11-15")).toEqual({ attempt: 3, scheduled_for: "2026-11-15" });
    const three = [...two, failed(3, "2026-11-15")];
    expect(nextAttempt(three, "2026-11-05", [3, 7], "2026-12-31")).toBeNull();
  });

  it("counts a late job from the real failure date, so retries do not stack", () => {
    const late = [{ attempt: 1, scheduled_for: "2026-11-05", attempted_at: "2026-11-09T10:00:00Z", result: "failed" as const }];
    expect(nextAttempt(late, "2026-11-05", [3, 7], "2026-11-11")).toBeNull();
    expect(nextAttempt(late, "2026-11-05", [3, 7], "2026-11-12")).toEqual({ attempt: 2, scheduled_for: "2026-11-12" });
  });

  it("never charges again after a success or while an attempt is pending, and treats a skip like a failure", () => {
    expect(nextAttempt([{ attempt: 1, scheduled_for: "2026-11-05", attempted_at: "2026-11-05T10:00:00Z", result: "succeeded" }], "2026-11-05", [3, 7], "2026-12-01")).toBeNull();
    expect(nextAttempt([{ attempt: 1, scheduled_for: "2026-11-05", attempted_at: "2026-11-05T10:00:00Z", result: null }], "2026-11-05", [3, 7], "2026-12-01")).toBeNull();
    expect(nextAttempt([{ attempt: 1, scheduled_for: "2026-11-05", attempted_at: "2026-11-05T10:00:00Z", result: "skipped" }], "2026-11-05", [3, 7], "2026-11-08")).toEqual({ attempt: 2, scheduled_for: "2026-11-08" });
  });
});
