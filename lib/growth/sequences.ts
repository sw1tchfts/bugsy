// Marketing sequences and surveys (spec 17 rules 8 and 9), pure.

export const TRIGGERS = ["quote_open", "renewal_due", "seasonal_upsell", "win_back"] as const;
export type Trigger = (typeof TRIGGERS)[number];
export const TRIGGER_LABELS: Record<Trigger, string> = {
  quote_open: "Open quotes",
  renewal_due: "Renewals coming due",
  seasonal_upsell: "Seasonal upsell",
  win_back: "Win back cancelled customers",
};

export type Step = { delay_days: number; channel: "email" | "sms"; subject: string | null; body: string };

export function stepProblems(steps: readonly Step[]): string[] {
  const problems: string[] = [];
  if (steps.length < 1 || steps.length > 10) problems.push("A sequence has 1 to 10 steps.");
  steps.forEach((s, i) => {
    if (!Number.isInteger(s.delay_days) || s.delay_days < 0 || s.delay_days > 365) problems.push(`Step ${i + 1}: wait 0 to 365 days.`);
    if (!["email", "sms"].includes(s.channel)) problems.push(`Step ${i + 1}: email or text.`);
    if (!s.body.trim()) problems.push(`Step ${i + 1}: write the message.`);
    if (s.channel === "email" && !(s.subject ?? "").trim()) problems.push(`Step ${i + 1}: an email needs a subject.`);
  });
  return problems;
}

/** When the step after `step` is due: its delay after the previous step was sent (or after enrollment for the first). */
export function nextAt(steps: readonly Step[], step: number, from: Date): Date | null {
  const s = steps[step];
  return s ? new Date(from.getTime() + s.delay_days * 86_400_000) : null;
}

/** Rule 9: promoters (9 and 10) minus detractors (0 to 6), as a whole percent of answers; null with no answers. */
export function nps(scores: readonly number[]): number | null {
  if (scores.length === 0) return null;
  const promoters = scores.filter((s) => s >= 9).length;
  const detractors = scores.filter((s) => s <= 6).length;
  return Math.round(((promoters - detractors) / scores.length) * 100);
}
