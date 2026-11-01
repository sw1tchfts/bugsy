"use client";

/** Click to call (spec 20): the call is logged on the account, then the person's phone or softphone dials `tel:`. */
export function CallLink({ number, accountId, contactId, label }: { number: string; accountId: string | null; contactId: string | null; label?: string }) {
  const digits = number.replace(/[^\d+]/g, "");
  return (
    <a
      href={`tel:${digits}`}
      data-testid="call-link"
      className="text-emerald-800 underline"
      onClick={() => {
        void fetch("/api/calls", {
          method: "POST",
          keepalive: true,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ to: number, account_id: accountId, contact_id: contactId }),
        }).catch(() => undefined);
      }}
    >
      {label ?? number}
    </a>
  );
}
