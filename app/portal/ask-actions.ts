"use server";

import { revalidatePath } from "next/cache";
import { runAi } from "@/lib/ai/db";
import { contextIds, loadPortalContext } from "@/lib/ai/portal";
import { portalDb, requirePortal } from "@/lib/portal/session";

export type AskState = { answer?: string; waiting?: boolean; error?: string };

/**
 * Spec 21 rule 7: the customer's question answered from their own records only. A question the records cannot answer,
 * or a refused or failed call, goes to the office as waiting; the customer sees the office's answer when it comes.
 */
export async function askQuestion(_prev: AskState, formData: FormData): Promise<AskState> {
  const { session, identity } = await requirePortal();
  const question = String(formData.get("question") ?? "").trim().slice(0, 1000);
  if (!question) return { error: "Type your question." };
  try {
    const db = <R,>(fn: (tx: Parameters<Parameters<typeof portalDb>[2]>[0]) => Promise<R>) => portalDb(session, identity, fn);
    // The question takes its place in the login's day first (at most 20, under a lock); the model is asked outside
    // any transaction; the answer is written after (rule 7).
    const questionId = await db(async (tx) => (await tx<{ id: string }[]>`select app.portal_ask_begin(${identity.tenant_id}, ${question}) as id`)[0].id);
    const context = await db((tx) => loadPortalContext(tx, identity));
    const outcome = await runAi(db, identity.tenant_id, "portal_answer", questionId, (p) => p.answerQuestion(question, context));
    const allowed = contextIds(context);
    const answer = outcome.ok
      ? { answer: outcome.value.answer, needs_office: outcome.value.needs_office, sources: outcome.value.sources.filter((s) => allowed.has(s)) }
      : { answer: "I can't answer that right now. I've sent your question to the office, and their answer will show here.", needs_office: true, sources: [] as string[] };
    await db((tx) => tx`select app.portal_ask_finish(${questionId}, ${answer.answer}, ${answer.needs_office}, ${tx.json(answer.sources)})`);
    revalidatePath("/portal");
    return { answer: answer.answer, waiting: answer.needs_office };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { error: e.code === "23514" ? (e.message ?? "Try again later.") : "That did not work. Try again, or call the office." };
  }
}
