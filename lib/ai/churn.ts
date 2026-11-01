// Churn risk (spec 21 rule 6), pure: a plan's score is the sum of transparent signals, each with its points and the
// sentence the office reads. Nothing here decides anything; the score orders a call list.

export type ChurnSignals = {
  reservices_90: number;
  skipped_180: number;
  past_due: boolean;
  price_increase_60: boolean;
  low_survey_180: number | null;
  unhappy_message_60: boolean;
  months_active: number;
  overdue_visit: boolean;
};

export type ChurnReason = { code: string; points: number; text: string };
export type ChurnBand = "low" | "medium" | "high";
export type ChurnScore = { score: number; band: ChurnBand; reasons: ChurnReason[] };

export function bandFor(score: number): ChurnBand {
  return score >= 60 ? "high" : score >= 30 ? "medium" : "low";
}

export function churnScore(s: ChurnSignals): ChurnScore {
  const reasons: ChurnReason[] = [];
  if (s.reservices_90 > 0) reasons.push({ code: "reservices", points: Math.min(36, 12 * s.reservices_90), text: `${s.reservices_90} re-service${s.reservices_90 === 1 ? "" : "s"} in the last 90 days: pests keep coming back.` });
  if (s.skipped_180 > 0) reasons.push({ code: "skipped", points: Math.min(20, 10 * s.skipped_180), text: `${s.skipped_180} visit${s.skipped_180 === 1 ? "" : "s"} skipped or cancelled in the last 180 days.` });
  if (s.past_due) reasons.push({ code: "past_due", points: 20, text: "The account is past due." });
  if (s.price_increase_60) reasons.push({ code: "price_increase", points: 10, text: "The price went up in the last 60 days." });
  if (s.low_survey_180 !== null) reasons.push({ code: "low_survey", points: 15, text: `Rated a visit ${s.low_survey_180} out of 10 in a survey.` });
  if (s.unhappy_message_60) reasons.push({ code: "unhappy_message", points: 15, text: "Wrote in about cancelling or a problem in the last 60 days." });
  if (s.months_active < 12) reasons.push({ code: "first_year", points: 10, text: "In the first year of the plan." });
  if (s.overdue_visit) reasons.push({ code: "overdue_visit", points: 10, text: "A visit is past its due window without being done." });
  reasons.sort((a, b) => b.points - a.points);
  const score = Math.min(100, reasons.reduce((t, r) => t + r.points, 0));
  return { score, band: bandFor(score), reasons };
}

/** Words in an inbound message that suggest a customer may leave (rule 6). */
const UNHAPPY = /\b(cancel+(ing|ed|ation)?|unhappy|not happy|disappointed|still (seeing|have|getting)|refund|stop (service|coming)|switch(ing)? (companies|to)|waste of money|complain)/i;

export function soundsUnhappy(body: string): boolean {
  return UNHAPPY.test(body);
}
