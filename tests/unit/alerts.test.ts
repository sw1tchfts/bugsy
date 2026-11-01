import { describe, expect, it } from "vitest";
import { type ExpiringItem, alertTasks, expiryAlerts } from "@/lib/compliance/alerts";

const item = (id: string, expires_on: string, subject_table: ExpiringItem["subject_table"] = "applicator_credentials"): ExpiringItem => ({
  subject_table,
  subject_id: id,
  label: subject_table === "branches" ? `Branch ${id} (business license)` : `Sam Rivera (${id})`,
  expires_on,
});

describe("expiry alerts (rule 10)", () => {
  const today = "2026-11-01";

  it("raises one alert per item at its stage: 60 days, 30 days, expired, nothing beyond 60", () => {
    const alerts = expiryAlerts([item("sixty", "2026-12-31"), item("thirty", "2026-11-20"), item("gone", "2026-10-30"), item("far", "2027-03-01"), item("b1", "2026-12-15", "branches")], today);
    expect(alerts.map((a) => [a.subject_id, a.stage, a.due_on, a.kind])).toEqual([
      ["sixty", 60, "2026-11-01", "credential_expiring"],
      ["thirty", 30, "2026-10-21", "credential_expiring"],
      ["gone", 0, "2026-10-30", "credential_expiring"],
      ["b1", 60, "2026-10-16", "license_expiring"],
    ]);
    expect(alerts[0].title).toBe("Sam Rivera (sixty) expires in 60 days (2026-12-31)");
    expect(alerts[2].title).toBe("Sam Rivera (gone) expired on 2026-10-30");
  });

  it("moves to the next stage as days pass, with a new due date, so each stage is its own task", () => {
    const at60 = expiryAlerts([item("c", "2026-12-31")], "2026-11-01")[0];
    const at30 = expiryAlerts([item("c", "2026-12-31")], "2026-12-05")[0];
    const expired = expiryAlerts([item("c", "2026-12-31")], "2027-01-02")[0];
    expect([at60.due_on, at30.due_on, expired.due_on]).toEqual(["2026-11-01", "2026-12-01", "2026-12-31"]);
    expect(new Set([at60.due_on, at30.due_on, expired.due_on]).size).toBe(3);
  });

  it("raises nothing for a renewed credential", () => {
    expect(expiryAlerts([item("c", "2027-06-01")], today)).toEqual([]);
  });

  it("turns alerts into task rows keyed by kind, subject and due date", () => {
    const tasks = alertTasks(expiryAlerts([item("c", "2026-11-20")], today));
    expect(tasks).toEqual([{ kind: "credential_expiring", subject_table: "applicator_credentials", subject_id: "c", due_on: "2026-10-21", title: "Sam Rivera (c) expires in 19 days (2026-11-20)" }]);
  });
});
