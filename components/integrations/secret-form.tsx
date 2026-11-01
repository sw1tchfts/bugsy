"use client";

import { type ReactNode, useActionState } from "react";
import { Button, Notice } from "@/components/ui";
import type { SecretState } from "@/app/(office)/settings/integrations/actions";

/** A form whose action returns a secret: shown here once, never stored or shown again (spec 20 rules 1 and 5). */
export function SecretForm({ action, submit, children }: { action: (prev: SecretState, formData: FormData) => Promise<SecretState>; submit: string; children: ReactNode }) {
  const [state, run, pending] = useActionState(action, {});
  return (
    <form action={run} className="grid gap-3">
      {state.error ? <Notice kind="error">{state.error}</Notice> : null}
      {state.secret ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm" data-testid="secret-once">
          <p className="font-medium text-amber-950">{state.label}: copy it now. It is not shown again.</p>
          <code className="mt-2 block break-all rounded bg-white px-2 py-1 font-mono text-xs" data-testid="secret-value">
            {state.secret}
          </code>
        </div>
      ) : null}
      {children}
      <div>
        <Button type="submit" disabled={pending}>
          {submit}
        </Button>
      </div>
    </form>
  );
}
