"use server";

import { redirect } from "next/navigation";
import { submitIntake } from "@/lib/portal/forms";

export async function submitBookingForm(formData: FormData) {
  const key = String(formData.get("key") ?? "");
  const body = Object.fromEntries(formData.entries());
  const outcome = await submitIntake(key, body);
  if (!outcome.ok) redirect(`/f/${encodeURIComponent(key)}?error=${encodeURIComponent(outcome.errors.join(" "))}`);
  redirect(`/f/${encodeURIComponent(key)}?sent=1`);
}
