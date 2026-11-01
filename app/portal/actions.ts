"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { addPaymentMethod, chargeInvoice, loadSettings } from "@/lib/billing/db";
import { getStatePack } from "@/lib/compliance/rules";
import { opt, str } from "@/lib/customers/forms";
import { type ArrivalWindow, type CrewMember, type StateRuleInput, checkAssignment } from "@/lib/dispatch/checks";
import { errorCode } from "@/lib/db";
import { isIsoDate, todayInZone } from "@/lib/dates";
import { gatewayFor } from "@/lib/payments";
import { paymentToken } from "@/lib/payments/token";
import { rescheduleProblems } from "@/lib/portal/rules";
import { type PortalIdentity, portalDb, portalIdentities, requirePortal, setPortalCookie } from "@/lib/portal/session";
import { getSession } from "@/lib/auth/session";

function back(path: string, params: Record<string, string | null>): never {
  revalidatePath("/portal", "layout");
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  redirect(`${path}${q ? `?${q}` : ""}`);
}

const pathOf = (formData: FormData, fallback: string) => {
  const p = opt(formData, "return_to") ?? fallback;
  return p.startsWith("/portal") ? p : fallback;
};

export async function switchIdentity(formData: FormData) {
  const session = await getSession();
  if (!session) redirect("/sign-in?next=/portal");
  const id = str(formData, "portal_user_id");
  const identities = await portalIdentities(session);
  if (identities.some((i) => i.id === id)) await setPortalCookie(id);
  redirect("/portal");
}

async function run(fn: (tx: Parameters<Parameters<typeof portalDb>[2]>[0], identity: PortalIdentity) => Promise<unknown>): Promise<string | null> {
  const { session, identity } = await requirePortal();
  if (identity.tenant_status !== "active") return "read-only";
  try {
    await portalDb(session, identity, (tx) => fn(tx, identity));
    return null;
  } catch (err) {
    return errorCode(err);
  }
}

/** Rule 3: a card, tokenized by the company's gateway (Stripe's field in the browser); only brand, last four and expiry are kept. */
export async function addCard(formData: FormData) {
  const to = pathOf(formData, "/portal/billing");
  let refused: string | null = null;
  const error = await run(async (tx, identity) => {
    const settings = await loadSettings(tx, identity.tenant_id);
    const t = paymentToken(gatewayFor(settings).kind, {
      number: opt(formData, "number"),
      month: opt(formData, "exp_month"),
      year: opt(formData, "exp_year"),
      token: opt(formData, "payment_token"),
    });
    if (!t.ok || !t.token) {
      refused = t.ok ? "Enter the card number and its expiry." : t.error;
      return;
    }
    await addPaymentMethod(tx, identity.tenant_id, { account_id: identity.account_id, token: t.token, autopay: formData.get("autopay") === "on", added_by: null });
  });
  if (refused) back(to, { error: refused });
  back(to, error ? { error } : { note: "Card saved." });
}

export async function updateCard(formData: FormData) {
  const methodId = str(formData, "method_id");
  const intent = str(formData, "intent");
  const error = await run(async (tx, identity) => {
    const [m] = await tx<{ id: string; gateway_payment_method_id: string }[]>`
      select id, gateway_payment_method_id from public.payment_methods where id = ${methodId} and tenant_id = ${identity.tenant_id} and account_id = ${identity.account_id} and status = 'active'`;
    if (!m) throw Object.assign(new Error("That card is not on this account."), { code: "23514" });
    if (intent === "default") {
      await tx`update public.payment_methods set is_default = (id = ${methodId}) where tenant_id = ${identity.tenant_id} and account_id = ${identity.account_id} and status = 'active'`;
    } else if (intent === "autopay_on" || intent === "autopay_off") {
      await tx`update public.payment_methods set autopay = ${intent === "autopay_on"} where id = ${methodId}`;
    } else if (intent === "remove") {
      const settings = await loadSettings(tx, identity.tenant_id);
      await gatewayFor(settings).detachPaymentMethod({ account_id: settings.gateway_account_id, gateway_payment_method_id: m.gateway_payment_method_id });
      await tx`update public.payment_methods set status = 'removed', autopay = false, is_default = false where id = ${methodId}`;
    }
  });
  back("/portal/billing", error ? { error } : { note: "Saved." });
}

/** Rule 3: pays an open invoice in full with a saved card; a failed charge leaves it open and says why. */
export async function payInvoice(formData: FormData) {
  const invoiceId = str(formData, "invoice_id");
  const attempt = str(formData, "attempt");
  const to = `/portal/invoices/${invoiceId}`;
  let failure: string | null = null;
  const error = await run(async (tx, identity) => {
    const outcome = await chargeInvoice(tx, identity.tenant_id, invoiceId, {
      payment_method_id: opt(formData, "method_id"),
      idempotency_key: `portal:${invoiceId}:${attempt}`,
      recorded_by: null,
      post: false,
    });
    if (!outcome.ok) failure = outcome.error;
  });
  if (error) back(to, { error });
  back(to, failure ? { error: `The payment did not go through: ${String(failure).replace(/_/g, " ")}.` } : { note: "Paid. Thank you." });
}

/** Rule 4: requests go in only while the company takes them (the database checks it too). */
async function assertRequestsOpen(tx: Parameters<Parameters<typeof portalDb>[2]>[0], tenantId: string): Promise<void> {
  const [s] = await tx<{ allow_requests: boolean }[]>`select allow_requests from public.portal_settings where tenant_id = ${tenantId}`;
  if (s && !s.allow_requests) throw Object.assign(new Error("The office is not taking requests online right now; call them instead."), { code: "23514" });
}

/** Rule 4: a re-service request needs the property's active agreement and what the customer is seeing. */
export async function requestReservice(formData: FormData) {
  const propertyId = str(formData, "property_id");
  const details = str(formData, "details").trim();
  if (!details) back("/portal/requests", { error: "Say what you are seeing and where." });
  const error = await run(async (tx, identity) => {
    await assertRequestsOpen(tx, identity.tenant_id);
    const [g] = await tx<{ id: string }[]>`
      select id from public.agreements where tenant_id = ${identity.tenant_id} and property_id = ${propertyId} and status = 'active' order by starts_on desc limit 1`;
    if (!g) throw Object.assign(new Error("There is no active plan at that property; ask for a booking instead."), { code: "23514" });
    await tx`insert into public.service_requests (tenant_id, account_id, property_id, portal_user_id, kind, agreement_id, details)
             values (${identity.tenant_id}, ${identity.account_id}, ${propertyId}, ${identity.id}, 'reservice', ${g.id}, ${details.slice(0, 2000)})`;
  });
  back("/portal/requests", error ? { error } : { note: "Request sent. The office will book the visit and let you know." });
}

export async function requestBooking(formData: FormData) {
  const propertyId = str(formData, "property_id");
  const serviceTypeId = str(formData, "service_type_id");
  const preferred = opt(formData, "preferred_date");
  const window = (opt(formData, "arrival_window") ?? "any") as ArrivalWindow;
  const error = await run(async (tx, identity) => {
    const [s] = await tx<{ requestable_service_type_ids: string[]; allow_requests: boolean }[]>`
      select requestable_service_type_ids, allow_requests from public.portal_settings where tenant_id = ${identity.tenant_id}`;
    if (!s?.allow_requests || !s.requestable_service_type_ids.includes(serviceTypeId)) throw Object.assign(new Error("Pick a service from the list."), { code: "23514" });
    if (preferred && (!isIsoDate(preferred) || preferred < todayInZone(identity.tenant_timezone))) throw Object.assign(new Error("Pick a day from today on."), { code: "23514" });
    await tx`insert into public.service_requests (tenant_id, account_id, property_id, portal_user_id, kind, service_type_id, preferred_date, arrival_window, details)
             values (${identity.tenant_id}, ${identity.account_id}, ${propertyId}, ${identity.id}, 'booking', ${serviceTypeId}, ${preferred}, ${window}, ${opt(formData, "details")})`;
  });
  back("/portal/requests", error ? { error } : { note: "Request sent. The office will confirm a day." });
}

type Context = {
  visit: {
    id: string;
    agreement_id: string | null;
    service_type_id: string;
    branch_id: string | null;
    status: string;
    due_start: string;
    due_end: string;
    scheduled_for: string | null;
    technician_id: string | null;
    arrival_window: ArrivalWindow;
    job_kind: string;
    treatment_areas: string[];
    property_state: string;
    registry_matches: unknown;
    registry_notice_dates: string[];
    branch_license: { expires_on: string | null } | null;
    account_past_due_since: string | null;
    authorization_on_file: boolean;
  };
  state_rule: StateRuleInput;
  crew: (Omit<CrewMember, "credential"> & { credential: CrewMember["credential"] })[];
  pause_when_past_due: boolean;
  settings: { allow_reschedule: boolean; reschedule_notice_hours: number; max_stops_per_day: number } | null;
  stops: Record<string, number>;
  timezone: string;
};

/** Rule 5: the office's rules, then the dispatch check for the crew on the new day, then the move. */
export async function rescheduleVisit(formData: FormData) {
  const visitId = str(formData, "visit_id");
  const date = str(formData, "date");
  const to = `/portal/visits/${visitId}`;
  if (!isIsoDate(date)) back(to, { error: "Pick a day." });
  let refused: string[] = [];
  const error = await run(async (tx) => {
    const [{ ctx }] = await tx<{ ctx: Context }[]>`select app.portal_reschedule_context(${visitId}) as ctx`;
    refused = rescheduleProblems({ visit: ctx.visit, date, settings: ctx.settings, stops: ctx.stops, now: new Date(), timeZone: ctx.timezone });
    if (refused.length) return;
    const check = checkAssignment({
      visit: {
        ...ctx.visit,
        job_kind: ctx.visit.job_kind as never,
        treatment_areas: ctx.visit.treatment_areas as never,
        scheduled_for: date,
        registry_notice_sent: ctx.visit.registry_notice_dates.includes(date),
        pause_when_past_due: ctx.pause_when_past_due,
      },
      stateRule: ctx.state_rule,
      crew: ctx.crew,
      pack: getStatePack(ctx.visit.property_state),
      today: todayInZone(ctx.timezone),
    });
    if (!check.ok) {
      refused = ["That day does not work for this visit; the office can find another."];
      return;
    }
    await tx`select app.portal_move_visit(${visitId}, ${date}::date)`;
  });
  if (error) back(to, { error, ask: date });
  if (refused.length) back(to, { error: refused.join(" "), ask: date });
  back(to, { note: "Moved. We will see you then." });
}

export async function requestReschedule(formData: FormData) {
  const visitId = str(formData, "visit_id");
  const date = str(formData, "date");
  const to = `/portal/visits/${visitId}`;
  if (!isIsoDate(date) || date < todayInZone((await requirePortal()).identity.tenant_timezone)) back(to, { error: "Pick a day from today on." });
  const error = await run(async (tx, identity) => {
    await assertRequestsOpen(tx, identity.tenant_id);
    const [v] = await tx<{ property_id: string; agreement_id: string | null }[]>`select property_id, agreement_id from public.visits where id = ${visitId} and account_id = ${identity.account_id}`;
    if (!v) throw Object.assign(new Error("That visit is not on this account."), { code: "23514" });
    await tx`insert into public.service_requests (tenant_id, account_id, property_id, portal_user_id, kind, visit_id, agreement_id, preferred_date, details)
             values (${identity.tenant_id}, ${identity.account_id}, ${v.property_id}, ${identity.id}, 'reschedule', ${visitId}, ${v.agreement_id}, ${date}, ${opt(formData, "details")})`;
  });
  back(to, error ? { error } : { note: "Request sent. The office will confirm a new day." });
}

/** Rule 6: a commercial customer logs a sighting at their own site. */
export async function addSighting(formData: FormData) {
  const propertyId = str(formData, "property_id");
  const to = `/portal/sites/${propertyId}`;
  const location = str(formData, "location").trim();
  const pest = str(formData, "pest").trim();
  if (!location || !pest) back(to, { error: "Say what you saw and where." });
  const count = opt(formData, "count");
  const error = await run(async (tx, identity) => {
    const [who] = await tx<{ email: string }[]>`select email from public.portal_users where id = ${identity.id}`;
    await tx`insert into public.sightings (tenant_id, property_id, seen_at, location, pest, count, reported_by, source, notes)
             values (${identity.tenant_id}, ${propertyId}, now(), ${location.slice(0, 200)}, ${pest.slice(0, 100)}, ${count && /^\d+$/.test(count) ? Number(count) : null},
                     ${who?.email ?? identity.account_name}, 'customer', ${opt(formData, "notes")})`;
  });
  back(to, error ? { error } : { note: "Sighting logged. The office and your technician will see it." });
}
