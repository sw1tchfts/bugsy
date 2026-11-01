"use client";

// The customer's signature at the door (spec 17 rule 3), drawn on the phone and sent with the form as a PNG data URL.
import { useState } from "react";
import { SignaturePad } from "@/components/tech/signature-pad";

export function SignatureField({ name, label }: { name: string; label: string }) {
  const [value, setValue] = useState("");
  return (
    <div className="grid gap-1">
      <SignaturePad label={label} onChange={(v) => setValue(v ?? "")} />
      <input type="hidden" name={name} value={value} />
      <span className="text-xs text-stone-600" data-testid="signature-state">
        {value ? "Signed." : "Not signed yet."}
      </span>
    </div>
  );
}
