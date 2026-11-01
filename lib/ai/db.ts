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

/** Runs a short transaction on the caller's session (a member's or a portal login's). */
export type AiDb = <R>(fn: (tx: Sql) => Promise<R>) => Promise<R>;

/**
 * Rule 2: the call reserves its place in the month (under a lock, so parallel calls cannot all pass the limit), the
 * model is asked outside any transaction, and the outcome is recorded without its text. With AI off for the company
 * the local provider answers (rule 8); a feature turned off says so.
 */
export async function runAi<T>(db: AiDb, tenantId: string, feature: AiFeature, subjectId: string | null, call: (p: AiProvider) => Promise<T & { usage: Usage }>): Promise<AiOutcome<T>> {
  let provider = aiProvider();
  let [r] = await db((tx) => tx<{ run_id: string | null; allowed: string }[]>`select run_id, allowed from app.ai_reserve(${tenantId}, ${feature}, ${provider.kind}, ${subjectId})`);
  if (r.allowed === "disabled") {
    provider = (await import("./local")).localAi;
    [r] = await db((tx) => tx<{ run_id: string | null; allowed: string }[]>`select run_id, allowed from app.ai_reserve(${tenantId}, ${feature}, 'local', ${subjectId})`);
  }
  if (r.allowed === "off") return { ok: false, reason: "off", message: MESSAGES.off };
  if (r.allowed === "limited") return { ok: false, reason: "limited", message: MESSAGES.limited };
  const started = Date.now();
  const finish = (model: string, status: string, usage: Usage | null) =>
    db((tx) => tx`select app.ai_finish(${r.run_id}, ${model}, ${status}, ${usage?.input_tokens ?? 0}, ${usage?.output_tokens ?? 0}, ${Math.round(Date.now() - started)})`);
  try {
    const value = await call(provider);
    await finish(value.usage.model, "ok", value.usage);
    return { ok: true, value, provider: provider.kind };
  } catch (err) {
    const outcome = err instanceof AiUnavailable ? err.outcome : "failed";
    if (!(err instanceof AiUnavailable)) console.error("ai call failed", feature, (err as Error).message);
    await finish(provider.kind, outcome, null);
    return { ok: false, reason: outcome, message: MESSAGES[outcome] };
  }
}

export async function aiUsage(tx: Sql, tenantId: string): Promise<{ feature: string; calls: number; input_tokens: number; output_tokens: number }[]> {
  return tx`
    select feature, count(*)::int as calls, coalesce(sum(input_tokens), 0)::int as input_tokens, coalesce(sum(output_tokens), 0)::int as output_tokens
    from public.ai_runs where tenant_id = ${tenantId} and provider = 'claude' and status <> 'limited' and created_at >= app.ai_month_start(${tenantId})
    group by feature order by feature`;
}
