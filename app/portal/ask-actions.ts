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
    const result = await portalDb(session, identity, async (tx) => {
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from public.portal_questions where portal_user_id = ${identity.id} and created_at > now() - interval '1 day'`;
      if (n >= 20) return { error: "You have asked 20 questions today; call the office and we will help." } as AskState;
      const context = await loadPortalContext(tx, identity);
      const outcome = await runAi(tx, identity.tenant_id, "portal_answer", null, (p) => p.answerQuestion(question, context));
      const allowed = contextIds(context);
      const answer = outcome.ok
        ? { answer: outcome.value.answer, needs_office: outcome.value.needs_office, sources: outcome.value.sources.filter((s) => allowed.has(s)) }
        : { answer: "I can't answer that right now. I've sent your question to the office, and their answer will show here.", needs_office: true, sources: [] as string[] };
      await tx`select app.portal_ask(${identity.tenant_id}, ${question}, ${answer.answer}, ${answer.needs_office}, ${tx.json(answer.sources)})`;
      return { answer: answer.answer, waiting: answer.needs_office } as AskState;
    });
    revalidatePath("/portal");
    return result;
  } catch (err) {
    const e = err as { code?: string; message?: string };
    return { error: e.code === "23514" ? (e.message ?? "Try again later.") : "That did not work. Try again, or call the office." };
  }
}
