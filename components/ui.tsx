import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";

// Small, plain building blocks so every page looks the same. Tailwind utilities only.

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-emerald-800 text-white hover:bg-emerald-900",
    secondary: "border border-stone-300 bg-white text-stone-900 hover:bg-stone-50",
    danger: "border border-red-300 bg-white text-red-800 hover:bg-red-50",
  }[variant];
  return (
    <button
      className={`rounded px-3 py-1.5 text-sm font-medium disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium text-stone-700">
        {label}
      </label>
      {children}
      {hint ? <p className="text-xs text-stone-500">{hint}</p> : null}
    </div>
  );
}

const control =
  "w-full rounded border border-stone-300 bg-white px-2.5 py-1.5 text-sm text-stone-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={control} {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={control} {...props} />;
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${control} min-h-20`} {...props} />;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad"; children: ReactNode }) {
  const styles = {
    neutral: "bg-stone-100 text-stone-700",
    good: "bg-emerald-100 text-emerald-900",
    warn: "bg-amber-100 text-amber-900",
    bad: "bg-red-100 text-red-900",
  }[tone];
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${styles}`}>{children}</span>;
}

export function Card({ title, description, actions, children }: { title: string; description?: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-md border border-stone-200 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
          {description ? <p className="mt-1 max-w-prose text-sm text-stone-600">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "success"; children: ReactNode }) {
  const styles = {
    info: "border-stone-200 bg-stone-50 text-stone-800",
    error: "border-red-200 bg-red-50 text-red-900",
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
  }[kind];
  return (
    <p role={kind === "error" ? "alert" : "status"} className={`rounded border px-3 py-2 text-sm ${styles}`}>
      {children}
    </p>
  );
}

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] text-left text-sm">
        <thead>
          <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
            {headers.map((h) => (
              <th key={h} className="py-2 pr-4 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-stone-500">{children}</p>;
}

/** Maps an error code from a query string to a sentence. */
export function errorMessage(code: string | undefined): string | null {
  if (!code) return null;
  const known: Record<string, string> = {
    forbidden: "Your role does not allow that.",
    "read-only": "Nothing can be changed right now: the company is suspended or archived, or this is a read-only support session.",
    "invalid-credentials": "That email and password do not match.",
    "magic-link-failed": "The magic link could not be sent. Check the email address, or sign in with a password.",
    "last-owner": "A company must keep at least one owner. Make someone else an owner first.",
    duplicate: "Something with that name or email already exists.",
    "in-use": "That cannot be removed while something still uses it.",
    overlap: "That size band overlaps a band that already exists for this item. Bands meet at a boundary; they do not share one.",
    failed: "That did not work. Try again, and tell support if it keeps failing.",
    invitation: "This invitation is not valid for the signed-in account. Sign in with the invited email address.",
  };
  return known[code] ?? code;
}
