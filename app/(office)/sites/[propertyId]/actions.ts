"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions";
import { dbAs, requireMembership } from "@/lib/auth/session";
import { checkProblems, isDeviceKind, validPosition, ZONES } from "@/lib/commercial/devices";
import { imageInfo } from "@/lib/commercial/image";
import { opt, str } from "@/lib/customers/forms";
import { fromTenantLocal, isIsoDate, todayInZone } from "@/lib/dates";
import { errorCode } from "@/lib/db";
import { putFile } from "@/lib/files";
import { isMarkKind } from "@/lib/specialty/marks";
import { requireActiveTenant } from "@/lib/tenancy/active-tenant";

type Ctx = Awaited<ReturnType<typeof requireMembership>> & { tenantId: string; propertyId: string; timeZone: string; page: string };

/** The signed-in member allowed to write this site from the office (rule 11), or a redirect. */
async function writer(formData: FormData): Promise<Ctx> {
  const tenantId = str(formData, "tenant_id");
  const propertyId = str(formData, "property_id");
  const ctx = await requireMembership(tenantId);
  const { active } = await requireActiveTenant();
  const page = `/sites/${propertyId}`;
  const ok = can(ctx.membership.permissions, "customers.write") || can(ctx.membership.permissions, "dispatch.write");
  if (!ok) redirect(`${page}?error=forbidden`);
  return { ...ctx, tenantId, propertyId, timeZone: active.tenantTimezone, page };
}

function back(ctx: Ctx, params: Record<string, string | null>, anchor = ""): never {
  revalidatePath(ctx.page);
  revalidatePath("/sites");
  const q = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]))).toString();
  redirect(`${ctx.page}${q ? `?${q}` : ""}${anchor}`);
}

async function run(ctx: Ctx, fn: (tx: Parameters<Parameters<typeof dbAs>[1]>[0]) => Promise<unknown>, note: string, anchor = ""): Promise<never> {
  let error: string | null = null;
  try {
    await dbAs(ctx.session, fn);
  } catch (err) {
    error = errorCode(err);
  }
  back(ctx, error ? { error } : { note }, anchor);
}

const num = (formData: FormData, key: string): number | null => {
  const v = opt(formData, key);
  return v === null || v === "" ? null : Number(v);
};

/** A floor plan: PNG, JPEG or WebP, read from its bytes (rule 12). */
export async function uploadMap(formData: FormData) {
  const ctx = await writer(formData);
  const name = str(formData, "name").trim();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) back(ctx, { error: "Choose the floor plan image." }, "#maps");
  const bytes = new Uint8Array(await (file as File).arrayBuffer());
  const info = imageInfo(bytes);
  if (!info) back(ctx, { error: "A floor plan is a PNG, JPEG or WebP image." }, "#maps");
  await run(
    ctx,
    async (tx) => {
      const fileId = await putFile(tx, ctx.tenantId, { kind: "document", contentType: info!.type, data: bytes });
      const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from public.site_maps where property_id = ${ctx.propertyId}`;
      await tx`insert into public.site_maps (tenant_id, property_id, name, file_id, width, height, position)
               values (${ctx.tenantId}, ${ctx.propertyId}, ${name || "Floor plan"}, ${fileId}, ${info!.width}, ${info!.height}, ${n + 1})`;
    },
    "Floor plan added.",
    "#maps",
  );
}

export async function archiveMap(formData: FormData) {
  const ctx = await writer(formData);
  const mapId = str(formData, "map_id");
  await run(
    ctx,
    async (tx) => {
      // Only this site's own map: archive it first, then unmap its devices.
      const archived = await tx`update public.site_maps set archived_at = now()
                                where id = ${mapId} and tenant_id = ${ctx.tenantId} and property_id = ${ctx.propertyId} and archived_at is null returning id`;
      if (archived.length === 0) throw Object.assign(new Error("That floor plan is not on this site."), { code: "23514" });
      await tx`update public.devices set map_id = null, x = null, y = null
               where map_id = ${mapId} and tenant_id = ${ctx.tenantId} and property_id = ${ctx.propertyId} and status = 'active'`;
    },
    "Floor plan archived; its devices are unmapped until placed again.",
    "#maps",
  );
}

export async function addDevice(formData: FormData) {
  const ctx = await writer(formData);
  const kind = str(formData, "kind");
  const zone = str(formData, "zone");
  const number = str(formData, "number").trim();
  const location = str(formData, "location").trim();
  if (!isDeviceKind(kind) || !(ZONES as readonly string[]).includes(zone) || !number || !location) back(ctx, { error: "A device needs a kind, a zone, a number and a location." }, "#devices");
  await run(
    ctx,
    (tx) => tx`insert into public.devices (tenant_id, property_id, number, barcode, kind, zone, location, installed_on)
               values (${ctx.tenantId}, ${ctx.propertyId}, ${number}, ${opt(formData, "barcode")}, ${kind}, ${zone}, ${location}, ${todayInZone(ctx.timeZone)})`,
    `Device ${number} added. Place it on the map.`,
    "#devices",
  );
}

export async function updateDevice(formData: FormData) {
  const ctx = await writer(formData);
  const zone = str(formData, "zone");
  const number = str(formData, "number").trim();
  const location = str(formData, "location").trim();
  if (!(ZONES as readonly string[]).includes(zone) || !number || !location) back(ctx, { error: "A device needs a zone, a number and a location." }, "#devices");
  await run(
    ctx,
    (tx) => tx`update public.devices set number = ${number}, barcode = ${opt(formData, "barcode")}, zone = ${zone}, location = ${location}
               where id = ${str(formData, "device_id")} and property_id = ${ctx.propertyId} and status = 'active'`,
    "Device saved.",
    "#devices",
  );
}

/** Rules 3 and 7: a device placed or moved on a map; history records the before and after. */
export async function placeDevice(formData: FormData) {
  const ctx = await writer(formData);
  const x = num(formData, "x");
  const y = num(formData, "y");
  const mapId = opt(formData, "map_id");
  if (!mapId || !validPosition(x, y) || x === null) back(ctx, { error: "Pick a device, then tap the map where it is." }, "#maps");
  await run(
    ctx,
    async (tx) => {
      const [map] = await tx`select id from public.site_maps where id = ${mapId} and tenant_id = ${ctx.tenantId} and property_id = ${ctx.propertyId} and archived_at is null`;
      if (!map) throw Object.assign(new Error("That floor plan is not in use at this site."), { code: "23514" });
      await tx`update public.devices set map_id = ${mapId}, x = ${x}, y = ${y} where id = ${str(formData, "device_id")} and property_id = ${ctx.propertyId} and status = 'active'`;
    },
    "Device placed on the map.",
    "#maps",
  );
}

export async function removeDevice(formData: FormData) {
  const ctx = await writer(formData);
  const reason = str(formData, "reason").trim();
  if (!reason) back(ctx, { error: "Say why the device came out." }, "#devices");
  await run(
    ctx,
    (tx) => tx`update public.devices set status = 'removed', removed_on = ${todayInZone(ctx.timeZone)}, removed_reason = ${reason}
               where id = ${str(formData, "device_id")} and property_id = ${ctx.propertyId} and status = 'active'`,
    "Device taken out; it stays in the history.",
    "#devices",
  );
}

/** Office paper entry: a check from a service report, with no visit (edge case). */
export async function recordCheck(formData: FormData) {
  const ctx = await writer(formData);
  const day = str(formData, "checked_on");
  const status = str(formData, "status");
  const check = { status, notes: opt(formData, "notes"), count: num(formData, "count"), bait_consumed_pct: num(formData, "bait_consumed_pct") };
  const problems = checkProblems(check);
  if (!isIsoDate(day) || day > todayInZone(ctx.timeZone)) problems.push("The date is a day that has come.");
  if (problems.length) back(ctx, { error: problems.join(" ") }, "#checks");
  const at = fromTenantLocal(`${day}T12:00`, ctx.timeZone);
  await run(
    ctx,
    (tx) => tx`insert into public.device_checks (tenant_id, device_id, visit_id, checked_at, source, status, activity, count, bait_consumed_pct, pest, notes)
               select ${ctx.tenantId}, d.id, null, ${at}, 'office', ${status}, ${status === "checked" ? (opt(formData, "activity") ?? "none") : null},
                      ${status === "checked" ? check.count : null}, ${status === "checked" ? check.bait_consumed_pct : null}, ${opt(formData, "pest")}, ${check.notes}
               from public.devices d where d.id = ${str(formData, "device_id")} and d.property_id = ${ctx.propertyId}`,
    "Check recorded.",
    "#checks",
  );
}

export async function addSighting(formData: FormData) {
  const ctx = await writer(formData);
  const seen = fromTenantLocal(str(formData, "seen_at"), ctx.timeZone);
  if (!seen || !str(formData, "pest").trim() || !str(formData, "location").trim()) back(ctx, { error: "A sighting needs when, what and where." }, "#sightings");
  await run(
    ctx,
    (tx) => tx`insert into public.sightings (tenant_id, property_id, seen_at, location, pest, count, reported_by, source, notes)
               values (${ctx.tenantId}, ${ctx.propertyId}, ${seen}, ${str(formData, "location").trim()}, ${str(formData, "pest").trim()}, ${num(formData, "count")},
                       ${opt(formData, "reported_by")}, ${str(formData, "source") || "office"}, ${opt(formData, "notes")})`,
    "Sighting logged.",
    "#sightings",
  );
}

export async function resolveSighting(formData: FormData) {
  const ctx = await writer(formData);
  const resolution = str(formData, "resolution").trim();
  if (!resolution) back(ctx, { error: "Say how the sighting was handled." }, "#sightings");
  await run(
    ctx,
    (tx) => tx`update public.sightings set resolved_at = now(), resolution = ${resolution} where id = ${str(formData, "sighting_id")} and property_id = ${ctx.propertyId} and resolved_at is null`,
    "Sighting resolved.",
    "#sightings",
  );
}

export async function addRecommendation(formData: FormData) {
  const ctx = await writer(formData);
  const description = str(formData, "description").trim();
  if (!description) back(ctx, { error: "Say what should be done." }, "#recommendations");
  const due = opt(formData, "due_on");
  await run(
    ctx,
    (tx) => tx`insert into public.recommendations (tenant_id, property_id, sighting_id, category, description, responsibility, priority, owner_name, due_on)
               values (${ctx.tenantId}, ${ctx.propertyId}, ${opt(formData, "sighting_id")}, ${str(formData, "category")}, ${description}, ${str(formData, "responsibility")},
                       ${str(formData, "priority")}, ${opt(formData, "owner_name")}, ${due && isIsoDate(due) ? due : null})`,
    "Recommendation added.",
    "#recommendations",
  );
}

/** Rule 8: owner, due date and progress; closing needs a date and a note. */
export async function updateRecommendation(formData: FormData) {
  const ctx = await writer(formData);
  const status = str(formData, "status");
  const note = opt(formData, "closed_note");
  if (status === "closed" && !note?.trim()) back(ctx, { error: "Closing a recommendation needs a note: what was done." }, "#recommendations");
  const due = opt(formData, "due_on");
  await run(
    ctx,
    (tx) => tx`update public.recommendations set status = ${status}, owner_name = ${opt(formData, "owner_name")}, due_on = ${due && isIsoDate(due) ? due : null},
                 closed_on = ${status === "closed" ? todayInZone(ctx.timeZone) : null}, closed_note = ${status === "closed" ? note : null}
               where id = ${str(formData, "recommendation_id")} and property_id = ${ctx.propertyId}`,
    status === "closed" ? "Recommendation closed." : "Recommendation saved.",
    "#recommendations",
  );
}

function documentType(bytes: Uint8Array): string {
  if (bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return "application/pdf";
  return imageInfo(bytes)?.type ?? "application/octet-stream";
}

export async function uploadDocument(formData: FormData) {
  const ctx = await writer(formData);
  const title = str(formData, "title").trim();
  const file = formData.get("file");
  if (!title || !(file instanceof File) || file.size === 0) back(ctx, { error: "A document needs a title and a file." }, "#documents");
  const bytes = new Uint8Array(await (file as File).arrayBuffer());
  const valid = opt(formData, "valid_until");
  await run(
    ctx,
    async (tx) => {
      const fileId = await putFile(tx, ctx.tenantId, { kind: "document", contentType: documentType(bytes), data: bytes });
      await tx`insert into public.site_documents (tenant_id, property_id, file_id, title, kind, valid_until)
               values (${ctx.tenantId}, ${ctx.propertyId}, ${fileId}, ${title}, ${str(formData, "kind") || "other"}, ${valid && isIsoDate(valid) ? valid : null})`;
    },
    "Document added.",
    "#documents",
  );
}

/** Spec 15 rule 8: a termite diagram mark at fractions of the floor plan, with a kind and a label. */
export async function addMark(formData: FormData) {
  const ctx = await writer(formData);
  const x = num(formData, "x");
  const y = num(formData, "y");
  const mapId = opt(formData, "map_id");
  const kind = str(formData, "kind");
  const label = str(formData, "label").trim();
  if (!mapId || x === null || !validPosition(x, y) || !isMarkKind(kind) || !label) back(ctx, { error: "Pick a kind, write a label and tap the plan where it is." }, "#marks");
  await run(
    ctx,
    async (tx) => {
      const [map] = await tx`select id from public.site_maps where id = ${mapId} and tenant_id = ${ctx.tenantId} and property_id = ${ctx.propertyId} and archived_at is null`;
      if (!map) throw Object.assign(new Error("That floor plan is not in use at this site."), { code: "23514" });
      await tx`insert into public.diagram_marks (tenant_id, property_id, map_id, kind, x, y, label) values (${ctx.tenantId}, ${ctx.propertyId}, ${mapId}, ${kind}, ${x}, ${y}, ${label.slice(0, 80)})`;
    },
    "Mark added.",
    "#marks",
  );
}

export async function removeMark(formData: FormData) {
  const ctx = await writer(formData);
  await run(ctx, (tx) => tx`delete from public.diagram_marks where id = ${str(formData, "mark_id")} and tenant_id = ${ctx.tenantId} and property_id = ${ctx.propertyId}`, "Mark removed.", "#marks");
}
