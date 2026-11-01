"use server";

import { redirect } from "next/navigation";
import { withAnon } from "@/lib/db";

/** Rule 9: one answer per visit, 0 to 10 with an optional comment, through the definer function granted to anon. */
export async function answerSurvey(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const score = Number(formData.get("score"));
  const comment = String(formData.get("comment") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(token) || !Number.isInteger(score) || score < 0 || score > 10) redirect(`/s/${encodeURIComponent(token)}?error=1`);
  await withAnon((tx) => tx`select app.answer_survey(${token}::uuid, ${score}, ${comment.slice(0, 2000)})`);
  redirect(`/s/${encodeURIComponent(token)}?thanks=1`);
}
