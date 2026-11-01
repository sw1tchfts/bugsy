"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { dbAs, requireMembership } from "@/lib/auth/session";
import { addressColumns, addressComplete, emailOrNull, geocode, intOrNull, opt, readAddress, str } from "@/lib/customers/forms";
import { loadSettings } from "@/lib/billing/db";
import { errorCode } from "@/lib/db";
import { gatewayFor } from "@/lib/payments";
import { paymentToken } from "@/lib/payments/token";
import { decodeBase64File, putFile } from "@/lib/files";
import { type GeoAddress, doorSale, recordKnock } from "@/lib/sales/db";
import { OUTCOMES } from "@/lib/sales/territory";
import { isIsoDate, todayInZone } from "@/lib/dates";

function back(path: string, params: Record<string, string>): never {
  revalidatePath(path);
  redirect(`${path}?${new URLSearchParams(params).toString()}`);
}

async function rep(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const ctx = await requireMembership(tenantId);
  if (!can(ctx.membership.permissions, "customers.write")) redirect("/door?error=forbidden");
  return { ...ctx, tenantId };
}

async function geoFrom(formData: FormData): Promise<GeoAddress | null> {
  const address = readAddress(formData);
  if (!addressComplete(address)) return null;
  const cols = addressColumns(await geocode(address)) as unknown as GeoAddress;
  // The phone's location at the door, when the rep allowed it, places the knock before the geocoder has.
  const lat = Number(opt(formData, "here_lat") ?? NaN);
  const lng = Number(opt(formData, "here_lng") ?? NaN);
  const here = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
  return { ...cols, line2: cols.line2 ?? null, county: cols.county ?? null, lat: cols.lat ?? (here ? lat : null), lng: cols.lng ?? (here ? lng : null) };
}

/** Rule 1: a knock with its outcome; a do-not-knock address warns first and is knocked only when the rep confirms. */
export async function knockAction(formData: FormData) {
  const ctx = await rep(formData);
  const territoryId = str(formData, "territory_id");
  const page = `/door/${territoryId}`;
  const outcome = str(formData, "outcome");
  if (!(OUTCOMES as readonly string[]).includes(outcome) || outcome === "sold") back(page, { error: "Pick what happened at the door." });
  const address = await geoFrom(formData);
  if (!address) back(page, { error: "Enter the street, city, state and ZIP." });
  const followUp = opt(formData, "follow_up_at");
  let error: string | null = null;
  let warn = false;
  try {
    await dbAs(ctx.session, async (tx) => {
      const [dnk] = await tx<{ id: string }[]>`
        select id from public.knocks where tenant_id = ${ctx.tenantId} and normalized_address = ${address!.normalized_address} and outcome = 'do_not_knock' and cleared_at is null limit 1`;
      if (dnk && formData.get("confirm_dnk") !== "true") {
        warn = true;
        return;
      }
      await recordKnock(tx, ctx.tenantId, ctx.session.userId, {
        territory_id: territoryId,
        address: address!,
        outcome,
        notes: opt(formData, "notes"),
        follow_up_at: followUp ? new Date(followUp).toISOString() : null,
      });
    });
  } catch (err) {
    error = errorCode(err);
  }
  if (warn) back(page, { dnk: address!.normalized_address, error: "This address asked not to be knocked. Leave it, or confirm you spoke with them." });
  back(page, error ? { error } : { note: "Knock saved." });
}

/** Rule 3: the sale at the door, signed and with a card, in one step. */
export async function sellAction(formData: FormData) {
  const ctx = await rep(formData);
  const territoryId = str(formData, "territory_id");
  const page = `/door/${territoryId}/sell`;
  const keep = Object.fromEntries([...formData.entries()].filter(([k, v]) => typeof v === "string" && !["signature", "card_number", "payment_token", "tenant_id"].includes(k) && !k.startsWith("$")) as [string, string][]);
  const fail = (error: string): never => back(page, { ...keep, error });
  const address = await geoFrom(formData);
  if (!address) fail("Enter the street, city, state and ZIP.");
  const name = str(formData, "name").trim();
  const signedName = str(formData, "signed_name").trim();
  const signature = str(formData, "signature");
  const itemId = str(formData, "price_book_item_id");
  const startsOn = str(formData, "starts_on");
  if (!name) fail("The customer's name is needed.");
  if (!itemId) fail("Pick the plan and its price.");
  if (!signedName || !signature.startsWith("data:image/")) fail("The customer types their name and signs.");
  if (!isIsoDate(startsOn) || startsOn < todayInZone(ctx.membership.tenantTimezone)) fail("Pick the first visit day from today on.");
  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  let error: string | null = null;
  let done: { agreement_id: string; number: number } | null = null;
  try {
    await dbAs(ctx.session, async (tx) => {
      // The card: Stripe's field hands over a payment method id; the local test gateway takes the typed digits.
      const card = paymentToken(gatewayFor(await loadSettings(tx, ctx.tenantId)).kind, {
        number: opt(formData, "card_number"),
        month: opt(formData, "card_month"),
        year: opt(formData, "card_year"),
        token: opt(formData, "payment_token"),
      });
      if (!card.ok) throw Object.assign(new Error(card.error), { code: "23514" });
      const [item] = await tx<{ service_type_id: string; initial_price_cents: string; recurring_price_cents: string; one_time_price_cents: string }[]>`
        select service_type_id, initial_price_cents, recurring_price_cents, one_time_price_cents from public.price_book_items where id = ${itemId} and tenant_id = ${ctx.tenantId} and active and archived_at is null`;
      if (!item) throw Object.assign(new Error("That price is not in the price book."), { code: "23514" });
      const file = decodeBase64File(signature, "image/png");
      const fileId = await putFile(tx, ctx.tenantId, { kind: "signature", contentType: file.contentType, data: file.data });
      const made = await doorSale(
        tx,
        ctx.tenantId,
        ctx.session.userId,
        {
          territory_id: territoryId,
          address: address!,
          name,
          email: emailOrNull(formData),
          phone: opt(formData, "phone"),
          property_type: opt(formData, "property_type") ?? "house",
          size_sqft: intOrNull(formData, "size_sqft"),
          lot_sqft: null,
          service_type_id: item.service_type_id,
          initial_price_cents: Number(item.initial_price_cents),
          recurring_price_cents: Number(item.recurring_price_cents),
          cadence: opt(formData, "cadence") ?? "quarterly",
          billing_mode: opt(formData, "billing_mode") ?? "per_visit",
          starts_on: startsOn,
          signed_name: signedName,
          signature_file_id: fileId,
          card_token: card.token,
          existing_account_id: /^[0-9a-f-]{36}$/i.test(opt(formData, "existing_account_id") ?? "") ? opt(formData, "existing_account_id") : null,
          ip,
        },
        ctx.membership.tenantTimezone,
      );
      const [g] = await tx<{ number: number }[]>`select number from public.agreements where id = ${made.agreement_id}`;
      done = { agreement_id: made.agreement_id, number: g.number };
    });
  } catch (err) {
    error = errorCode(err);
  }
  if (error || !done) fail(error ?? "failed");
  back(`/door/${territoryId}`, { note: `Sold: agreement #${(done as unknown as { number: number }).number} is active and its first visit is on the board.` });
}
