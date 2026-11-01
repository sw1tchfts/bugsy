"use client";

import { useActionState } from "react";
import { type AskState, askQuestion } from "@/app/portal/ask-actions";
import { Button, Notice } from "@/components/ui";

/** Spec 21 rule 7: ask about your visits, what was applied, your bill or your plan. */
export function AskBox() {
  const [state, run, pending] = useActionState<AskState, FormData>(askQuestion, {});
  return (
    <form action={run} className="grid gap-2" data-testid="ask-box">
      <textarea name="question" rows={2} maxLength={1000} aria-label="Your question" placeholder="For example: when is my next visit? What did you spray last time?" className="rounded border border-stone-300 px-2 py-1 text-sm" />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Looking..." : "Ask"}
        </Button>
      </div>
      {state.error ? <Notice kind="error">{state.error}</Notice> : null}
      {state.answer ? (
        <p className="rounded border border-emerald-200 bg-emerald-50 p-2 text-sm" data-testid="ask-answer">
          {state.answer}
        </p>
      ) : null}
    </form>
  );
}
