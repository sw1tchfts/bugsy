"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Match = { kind: "account" | "lead"; id: string; name: string; contact_name: string | null };
type Ringing = { id: string; from_number: string; started_at: string; matches: Match[] };

/**
 * The caller pop (spec 20 rule 8): while a call from the phone system rings, the people its number belongs to, each a
 * click away (a number two accounts share pops both); an unknown caller starts nothing until someone makes a lead.
 */
export function CallerPop() {
  const [calls, setCalls] = useState<Ringing[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/calls/ringing", { cache: "no-store" });
        if (res.ok && !stop) setCalls(((await res.json()) as { calls: Ringing[] }).calls);
      } catch {
        // offline: try again on the next tick
      }
    };
    const first = setTimeout(poll, 0);
    const timer = setInterval(poll, 5000);
    return () => {
      stop = true;
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  const shown = calls.filter((c) => !dismissed.includes(c.id));
  if (shown.length === 0) return null;
  return (
    <div className="fixed right-4 bottom-4 z-50 grid w-80 gap-2" aria-live="polite">
      {shown.map((c) => (
        <div key={c.id} className="rounded-lg border border-emerald-300 bg-white p-3 text-sm shadow-lg" data-testid="caller-pop">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium">Incoming call from {c.from_number}</p>
            <button type="button" className="text-xs text-stone-500" onClick={() => setDismissed((d) => [...d, c.id])} aria-label="Dismiss">
              Close
            </button>
          </div>
          {c.matches.length ? (
            <ul className="mt-2 grid gap-1">
              {c.matches.map((m) => (
                <li key={`${m.kind}:${m.id}`}>
                  <Link href={m.kind === "account" ? `/customers/${m.id}` : `/leads/${m.id}`} className="text-emerald-800 underline">
                    {m.name}
                  </Link>
                  <span className="text-stone-500">{m.kind === "lead" ? " (lead)" : m.contact_name ? ` (${m.contact_name})` : ""}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2">
              Not a customer yet.{" "}
              <Link href={`/leads/new?phone=${encodeURIComponent(c.from_number)}`} className="text-emerald-800 underline">
                Make a lead with this number
              </Link>
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
