"use client";

import { useActionState } from "react";
import { type LabelReadState, readLabelAction } from "@/app/(office)/catalog/products/actions";
import { Button, Notice } from "@/components/ui";

/**
 * Spec 21 rule 4: paste the label's directions, read the rate rows, check them, and put them into the product form's
 * label rates; the product's own Save stores them.
 */
export function LabelReader({ tenantId, productId, target }: { tenantId: string; productId: string | null; target: string }) {
  const [state, run, pending] = useActionState<LabelReadState, FormData>(readLabelAction, {});
  const rows = state.rows ? (JSON.parse(state.rows) as { site: string; min_rate: number | null; max_rate: number | null; rate_unit: string }[]) : [];
  return (
    <details className="sm:col-span-2 rounded border border-stone-200 p-3 text-sm" data-testid="label-reader">
      <summary className="cursor-pointer font-medium">Read the label</summary>
      <form action={run} className="mt-2 grid gap-2">
        <input type="hidden" name="tenant_id" value={tenantId} />
        {productId ? <input type="hidden" name="product_id" value={productId} /> : null}
        <textarea name="label_text" rows={5} aria-label="Label directions for use" placeholder="Paste the label's directions for use, with its rates" className="rounded border border-stone-300 px-2 py-1 font-mono text-xs" />
        <div>
          <Button type="submit" variant="secondary" disabled={pending}>
            {pending ? "Reading..." : "Read the rates"}
          </Button>
        </div>
      </form>
      {state.error ? <Notice kind="error">{state.error}</Notice> : null}
      {state.rows !== undefined ? (
        <div className="mt-2 grid gap-2">
          {rows.length ? (
            <ul className="grid gap-1" data-testid="label-rows">
              {rows.map((r, i) => (
                <li key={i} className="font-mono text-xs">
                  {r.site}: {r.min_rate ?? "?"} to {r.max_rate ?? "?"} {r.rate_unit}
                </li>
              ))}
            </ul>
          ) : null}
          {state.note ? <p className="text-xs text-stone-600">{state.note}</p> : null}
          {rows.length ? (
            <div>
              <p className="text-xs text-stone-600">Check each row against the label. They are only kept when you save the product.</p>
              <button
                type="button"
                className="mt-1 rounded border border-emerald-800 px-2 py-1 text-xs text-emerald-900"
                onClick={() => {
                  const el = document.getElementById(target) as HTMLTextAreaElement | null;
                  if (el) el.value = state.rows ?? "";
                }}
              >
                Use these rates in the form
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </details>
  );
}
