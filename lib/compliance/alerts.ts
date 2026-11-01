// Credential and business license alerts (spec 07 rule 10): 60 and 30 days before an expiry, and once expired.
// The lead times are product policy, not state rules; what expires and when comes from the credential rows.
import { addDays, daysBetween } from "@/lib/dates";

export const ALERT_LEAD_DAYS = [60, 30] as const;

export type ExpiringItem = {
  subject_table: "applicator_credentials" | "branches";
  subject_id: string;
  /** Who or what this is about, for the task title: "Sam Rivera (OH certification)". */
  label: string;
  expires_on: string;
};

export type Alert = {
  kind: "credential_expiring" | "license_expiring";
  subject_table: ExpiringItem["subject_table"];
  subject_id: string;
  /** The alert's own date: the expiry minus the lead time, so each stage is its own task. */
  due_on: string;
  title: string;
  days_left: number;
  stage: 60 | 30 | 0;
};

/** The alerts that stand today: one per item at its current stage (60 days, 30 days, or expired). */
export function expiryAlerts(items: readonly ExpiringItem[], today: string): Alert[] {
  const alerts: Alert[] = [];
  for (const item of items) {
    const daysLeft = daysBetween(today, item.expires_on);
    const stage = daysLeft <= 0 ? 0 : daysLeft <= 30 ? 30 : daysLeft <= 60 ? 60 : null;
    if (stage === null) continue;
    const kind = item.subject_table === "branches" ? "license_expiring" : "credential_expiring";
    const title =
      stage === 0
        ? `${item.label} expired on ${item.expires_on}`
        : `${item.label} expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"} (${item.expires_on})`;
    alerts.push({ kind, subject_table: item.subject_table, subject_id: item.subject_id, due_on: addDays(item.expires_on, -stage), title, days_left: daysLeft, stage });
  }
  return alerts;
}

export type TaskRow = { kind: Alert["kind"]; subject_table: string; subject_id: string; due_on: string; title: string };

/** Task rows for the alerts; unique per (kind, subject, due date), so the job never duplicates one. */
export function alertTasks(alerts: readonly Alert[]): TaskRow[] {
  return alerts.map((a) => ({ kind: a.kind, subject_table: a.subject_table, subject_id: a.subject_id, due_on: a.due_on, title: a.title }));
}
