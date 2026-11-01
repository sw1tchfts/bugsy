import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { withAnon } from "@/lib/db";

export const metadata: Metadata = { title: "Referred by a friend", robots: { index: false } };

/** A customer's referral link (spec 17 rule 10): the company's booking form, carrying who sent the friend. */
export default async function Referral({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  if (!/^[A-Za-z0-9]{4,16}$/.test(code)) notFound();
  const [r] = await withAnon((tx) => tx<{ form_key: string | null }[]>`select form_key from app.referral(${code})`);
  if (!r?.form_key) notFound();
  redirect(`/f/${r.form_key}?ref=${encodeURIComponent(code.toUpperCase())}`);
}
