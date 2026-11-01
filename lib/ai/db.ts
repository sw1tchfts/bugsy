// AI settings, the monthly limit and the usage log (spec 21 rules 1 and 2), on the caller's connection: a member's
// session or a portal login's. `runAi` wraps every model call so each one is allowed, timed and logged without its text.
import type postgres from "postgres";
import { aiProvider } from "./provider";
import { type AiProvider, AiUnavailable, type Usage } from "./types";

type Sql = postgres.Sql | postgres.TransactionSql;

export type AiFeature = "summary" | "label" | "portal_answer";
export type AiSettings = { enabled: boolean; summaries: boolean; label_reading: boolean; portal_answers: boolean; churn: boolean; monthly_limit: number };

export const DEFAULT_AI: AiSettings = { enabled: true, summaries: true, label_reading: true, portal_answers: true, churn: true, monthly_limit: 2000 };

export async function aiSettings(tx: Sql, tenantId: string): Promise<AiSettings> {
  const [s] = await tx<AiSettings[]>`select enabled, summaries, label_reading, portal_answers, churn, monthly_limit from public.ai_settings where tenant_id = ${tenantId}`;
  return s ?? DEFAULT_AI;
}

export type AiOutcome<T> = { ok: true; value: T; provider: AiProvider["kind"] } | { ok: false; reason: "off" | "limited" | "refused" | "failed"; message: string };

const MESSAGES = {
  off: "AI is turned off for this; write it yourself.",
  limited: "The company has used this month's AI calls; write it yourself, or raise the limit under Settings, AI.",
  refused: "The assistant would not answer that; write it yourself.",
  failed: "The assistant did not answer; write it yourself.",
} as const;

/**
 * Rule 2: allowed (AI on, the feature on, under the month's limit), timed and logged. With AI off for the company the
 * local provider still answers the portal (rule 8); other features say they are off.
 */
export async function runAi<T>(tx: Sql, tenantId: string, feature: AiFeature, subjectId: string | null, call: (p: AiProvider) => Promise<T & { usage: Usage }>): Promise<AiOutcome<T>> {
  const [{ allowed }] = await tx<{ allowed: string }[]>`select app.ai_allowed(${tenantId}, ${feature}) as allowed`;
  const provider = aiProvider();
  if (allowed !== "ok" && !(feature === "portal_answer" && allowed === "off")) {
    if (allowed === "limited") await log(tx, tenantId, feature, provider.kind, "none", "limited", null, 0, subjectId);
    return { ok: false, reason: allowed === "limited" ? "limited" : "off", message: MESSAGES[allowed === "limited" ? "limited" : "off"] };
  }
  const chosen = allowed === "off" ? (await import("./local")).localAi : provider;
  const started = Date.now();
  try {
    const value = await call(chosen);
    await log(tx, tenantId, feature, chosen.kind, value.usage.model, "ok", value.usage, Date.now() - started, subjectId);
    return { ok: true, value, provider: chosen.kind };
  } catch (err) {
    const outcome = err instanceof AiUnavailable ? err.outcome : "failed";
    if (!(err instanceof AiUnavailable)) console.error("ai call failed", feature, (err as Error).message);
    await log(tx, tenantId, feature, chosen.kind, chosen.kind === "local" ? "local" : "claude", outcome, null, Date.now() - started, subjectId);
    return { ok: false, reason: outcome, message: MESSAGES[outcome] };
  }
}

async function log(tx: Sql, tenantId: string, feature: AiFeature, provider: string, model: string, status: string, usage: Usage | null, ms: number, subject: string | null) {
  await tx`select app.log_ai_run(${tenantId}, ${feature}, ${provider}, ${model}, ${status}, ${usage?.input_tokens ?? 0}, ${usage?.output_tokens ?? 0}, ${Math.round(ms)}, ${subject})`;
}

export async function aiUsage(tx: Sql, tenantId: string): Promise<{ feature: string; calls: number; input_tokens: number; output_tokens: number }[]> {
  return tx`
    select feature, count(*)::int as calls, coalesce(sum(input_tokens), 0)::int as input_tokens, coalesce(sum(output_tokens), 0)::int as output_tokens
    from public.ai_runs where tenant_id = ${tenantId} and provider = 'claude' and status <> 'limited' and created_at > date_trunc('month', now())
    group by feature order by feature`;
}
