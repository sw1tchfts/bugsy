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
import { OUTCOMES, inTerritory } from "@/lib/sales/territory";
import { type PriceBookItemLike, priceBookOffers } from "@/lib/catalog/pricing";
import { fromTenantLocal, isIsoDate, todayInZone } from "@/lib/dates";

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

type Here = { lat: number; lng: number } | null;

/** The address (geocoded for the property) and the phone's position at the door when the rep allowed it. */
async function geoFrom(formData: FormData): Promise<{ address: GeoAddress; here: Here } | null> {
  const address = readAddress(formData);
  if (!addressComplete(address)) return null;
  const cols = addressColumns(await geocode(address)) as unknown as GeoAddress;
  const lat = Number(opt(formData, "here_lat") ?? NaN);
  const lng = Number(opt(formData, "here_lng") ?? NaN);
  const here = Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0) ? { lat, lng } : null;
  return { address: { ...cols, line2: cols.line2 ?? null, county: cols.county ?? null, lat: cols.lat ?? null, lng: cols.lng ?? null }, here };
}

/** Rule 2: the territory is one of the rep's (row level security shows only those) and the address is inside it. */
async function territoryProblem(tx: Parameters<Parameters<typeof dbAs>[1]>[0], tenantId: string, territoryId: string, address: GeoAddress): Promise<string | null> {
  const [t] = await tx<{ zip_codes: string[]; streets: string[]; active: boolean }[]>`
    select zip_codes, streets, active from public.territories where id = ${territoryId} and tenant_id = ${tenantId}`;
  if (!t || !t.active) return "That territory is not one of yours.";
  return inTerritory({ line1: address.line1, postal_code: address.postal_code }, t) ? null : "That address is outside this territory.";
}

/** Rule 1: every rep is warned at a do-not-knock door, whoever recorded it. */
async function doNotKnockAt(tx: Parameters<Parameters<typeof dbAs>[1]>[0], tenantId: string, normalized: string): Promise<boolean> {
  const [{ dnk }] = await tx<{ dnk: boolean }[]>`select app.do_not_knock(${tenantId}, ${normalized}) as dnk`;
  return dnk;
}

/** Rule 1: a knock with its outcome; a do-not-knock address warns first and is knocked only when the rep confirms. */
export async function knockAction(formData: FormData) {
  const ctx = await rep(formData);
  const territoryId = str(formData, "territory_id");
  const page = `/door/${territoryId}`;
  const outcome = str(formData, "outcome");
  if (!(OUTCOMES as readonly string[]).includes(outcome) || outcome === "sold") back(page, { error: "Pick what happened at the door." });
  const geo = await geoFrom(formData);
  if (!geo) back(page, { error: "Enter the street, city, state and ZIP." });
  const { address, here } = geo!;
  const followUp = opt(formData, "follow_up_at");
  const followUpAt = followUp ? fromTenantLocal(followUp, ctx.membership.tenantTimezone) : null;
  if (followUp && !followUpAt) back(page, { error: "Pick a day and time to come back." });
  let error: string | null = null;
  let warn = false;
  try {
    await dbAs(ctx.session, async (tx) => {
      const outside = await territoryProblem(tx, ctx.tenantId, territoryId, address);
      if (outside) throw Object.assign(new Error(outside), { code: "23514" });
      if ((await doNotKnockAt(tx, ctx.tenantId, address.normalized_address)) && formData.get("confirm_dnk") !== "true") {
        warn = true;
        return;
      }
      await recordKnock(tx, ctx.tenantId, ctx.session.userId, {
        territory_id: territoryId,
        address,
        here,
        outcome,
        notes: opt(formData, "notes"),
        follow_up_at: followUpAt ? followUpAt.toISOString() : null,
      });
    });
  } catch (err) {
    error = errorCode(err);
  }
  if (warn) back(page, { dnk: address.normalized_address, error: "This address asked not to be knocked. Leave it, or confirm you spoke with them." });
  back(page, error ? { error } : { note: "Knock saved." });
}

/** Rule 3: the sale at the door, signed and with a card, in one step. */
export async function sellAction(formData: FormData) {
  const ctx = await rep(formData);
  const territoryId = str(formData, "territory_id");
  const page = `/door/${territoryId}/sell`;
  const keep = Object.fromEntries([...formData.entries()].filter(([k, v]) => typeof v === "string" && !["signature", "card_number", "payment_token", "tenant_id"].includes(k) && !k.startsWith("$")) as [string, string][]);
  const fail = (error: string): never => back(page, { ...keep, error });
  const geo = await geoFrom(formData);
  if (!geo) fail("Enter the street, city, state and ZIP.");
  const { address, here } = geo!;
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
      const outside = await territoryProblem(tx, ctx.tenantId, territoryId, address);
      if (outside) throw Object.assign(new Error(outside), { code: "23514" });
      if ((await doNotKnockAt(tx, ctx.tenantId, address.normalized_address)) && formData.get("confirm_dnk") !== "true") {
        throw Object.assign(new Error("This address asked not to be knocked; confirm the customer asked for the plan."), { code: "23514" });
      }
      // Rule 3: the price is the band the price book picks for this house's size, whatever the form sent.
      const [chosen] = await tx<{ service_type_id: string }[]>`
        select service_type_id from public.price_book_items where id = ${itemId} and tenant_id = ${ctx.tenantId} and active and archived_at is null and not add_on`;
      if (!chosen) throw Object.assign(new Error("That price is not in the price book."), { code: "23514" });
      const bands = await tx<PriceBookItemLike[]>`
        select id, service_type_id, name, add_on, size_basis, size_min, size_max, initial_price_cents, recurring_price_cents, one_time_price_cents
        from public.price_book_items where tenant_id = ${ctx.tenantId} and service_type_id = ${chosen.service_type_id} and active and archived_at is null and not add_on order by position, size_min`;
      const pick = priceBookOffers(bands, { sizeSqft: intOrNull(formData, "size_sqft"), lotSqft: null })
        .map((o) => o.pick)
        .find((p) => p.status === "match" && p.item.id === itemId);
      if (!pick || pick.status !== "match") throw Object.assign(new Error("That price does not fit this house's size; price it again."), { code: "23514" });
      const item = { service_type_id: chosen.service_type_id, initial_price_cents: String(pick.item.initial_price_cents), recurring_price_cents: String(pick.item.recurring_price_cents) };
      const file = decodeBase64File(signature, "image/png");
      const fileId = await putFile(tx, ctx.tenantId, { kind: "signature", contentType: file.contentType, data: file.data });
      const made = await doorSale(
        tx,
        ctx.tenantId,
        ctx.session.userId,
        {
          territory_id: territoryId,
          address,
          here,
          consent_notices: formData.get("consent_notices") === "true",
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
