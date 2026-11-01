"use server";

import { redirect } from "next/navigation";
import { submitIntake } from "@/lib/portal/forms";

export async function submitBookingForm(formData: FormData) {
  const key = String(formData.get("key") ?? "");
  const body = Object.fromEntries(formData.entries());
  const outcome = await submitIntake(key, body);
  const ref = typeof body.ref === "string" && /^[A-Za-z0-9]{4,16}$/.test(body.ref) ? `&ref=${encodeURIComponent(body.ref)}` : "";
  if (!outcome.ok) redirect(`/f/${encodeURIComponent(key)}?error=${encodeURIComponent(outcome.errors.join(" "))}${ref}`);
  redirect(`/f/${encodeURIComponent(key)}?sent=1`);
}
