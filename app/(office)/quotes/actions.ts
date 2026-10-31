"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { opt, str } from "@/lib/customers/forms";
import { dbAs, requirePermission } from "@/lib/auth/session";
import { errorCode } from "@/lib/db";
import { parseDollarsToCents } from "@/lib/money";

const LINE_KINDS = ["initial", "recurring", "one_time", "add_on"];

function back(quoteId: string, error: string | null): never {
  revalidatePath(`/quotes/${quoteId}`);
  redirect(`/quotes/${quoteId}${error ? `?error=${encodeURIComponent(error)}` : ""}`);
}

/** Starts a draft quote for a lead or an account, with one empty option ready for lines. */
export async function createQuote(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const { session } = await requirePermission(tenantId, "agreements.write");
  const leadId = opt(formData, "lead_id");
  const accountId = opt(formData, "account_id");
  const propertyId = opt(formData, "property_id");
  let quoteId: string | null = null;
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const [quote] = await tx<{ id: string }[]>`
        insert into public.quotes (tenant_id, lead_id, account_id, property_id, valid_until)
        values (${tenantId}, ${leadId}, ${accountId}, ${propertyId}, current_date + 30) returning id`;
      await tx`insert into public.quote_options (tenant_id, quote_id, position, name) values (${tenantId}, ${quote.id}, 1, 'Option 1')`;
      quoteId = quote.id;
    });
  } catch (err) {
    error = errorCode(err);
  }
  if (error || !quoteId) redirect(`${leadId ? `/leads/${leadId}` : `/customers/${accountId}`}?error=${encodeURIComponent(error ?? "failed")}`);
  redirect(`/quotes/${quoteId}`);
}

export async function updateQuote(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const quoteId = str(formData, "quote_id");
  const { session } = await requirePermission(tenantId, "agreements.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) =>
      tx`update public.quotes set valid_until = ${opt(formData, "valid_until")}, notes = ${opt(formData, "notes")} where id = ${quoteId} and tenant_id = ${tenantId}`,
    );
  } catch (err) {
    error = errorCode(err);
  }
  back(quoteId, error);
}

export async function addOption(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const quoteId = str(formData, "quote_id");
  const { session } = await requirePermission(tenantId, "agreements.write");
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      const [{ next }] = await tx<{ next: number }[]>`select coalesce(max(position), 0) + 1 as next from public.quote_options where quote_id = ${quoteId}`;
      await tx`insert into public.quote_options (tenant_id, quote_id, position, name, description, recommended)
               values (${tenantId}, ${quoteId}, ${next}, ${str(formData, "name") || `Option ${next}`}, ${opt(formData, "description")}, ${formData.get("recommended") === "true"})`;
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(quoteId, error);
}

export async function updateOption(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const quoteId = str(formData, "quote_id");
  const optionId = str(formData, "option_id");
  const { session } = await requirePermission(tenantId, "agreements.write");
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      if (formData.get("recommended") === "true") await tx`update public.quote_options set recommended = false where quote_id = ${quoteId}`;
      await tx`update public.quote_options set name = ${str(formData, "name")}, description = ${opt(formData, "description")}, recommended = ${formData.get("recommended") === "true"}
               where id = ${optionId} and quote_id = ${quoteId} and tenant_id = ${tenantId}`;
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(quoteId, error);
}

export async function removeOption(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const quoteId = str(formData, "quote_id");
  const optionId = str(formData, "option_id");
  const { session } = await requirePermission(tenantId, "agreements.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`delete from public.quote_options where id = ${optionId} and quote_id = ${quoteId} and tenant_id = ${tenantId}`);
  } catch (err) {
    error = errorCode(err);
  }
  back(quoteId, error);
}

export async function addLine(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const quoteId = str(formData, "quote_id");
  const optionId = str(formData, "option_id");
  const { session } = await requirePermission(tenantId, "agreements.write");
  const unitPrice = parseDollarsToCents(str(formData, "unit_price"));
  const quantity = Number(str(formData, "quantity") || "1");
  const kind = str(formData, "kind");
  let error: string | null = null;
  if (unitPrice === null || !(quantity > 0) || !LINE_KINDS.includes(kind) || !str(formData, "description")) {
    error = "A description, kind, quantity and price are required.";
  } else {
    try {
      await dbAs(session, async (tx) => {
        const [{ next }] = await tx<{ next: number }[]>`select coalesce(max(position), 0) + 1 as next from public.quote_lines where option_id = ${optionId}`;
        await tx`insert into public.quote_lines (tenant_id, option_id, position, description, kind, quantity, unit_price_cents)
                 values (${tenantId}, ${optionId}, ${next}, ${str(formData, "description")}, ${kind}, ${quantity}, ${unitPrice})`;
      });
    } catch (err) {
      error = errorCode(err);
    }
  }
  back(quoteId, error);
}

export async function removeLine(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const quoteId = str(formData, "quote_id");
  const lineId = str(formData, "line_id");
  const { session } = await requirePermission(tenantId, "agreements.write");
  let error: string | null = null;
  try {
    await dbAs(session, (tx) => tx`delete from public.quote_lines where id = ${lineId} and tenant_id = ${tenantId}`);
  } catch (err) {
    error = errorCode(err);
  }
  back(quoteId, error);
}

/** draft to sent, sent to accepted (with the option), declined or expired. The database checks the transition. */
export async function setQuoteStatus(formData: FormData) {
  const tenantId = str(formData, "tenant_id");
  const quoteId = str(formData, "quote_id");
  const status = str(formData, "status");
  const { session } = await requirePermission(tenantId, "agreements.write");
  let error: string | null = null;
  try {
    await dbAs(session, async (tx) => {
      if (status === "accepted") {
        const optionId = str(formData, "option_id");
        await tx`update public.quotes set status = 'accepted', accepted_option_id = ${optionId} where id = ${quoteId} and tenant_id = ${tenantId}`;
        await tx`update public.leads set stage = 'quoted' where id = (select lead_id from public.quotes where id = ${quoteId}) and stage in ('new', 'inspection_booked')`;
      } else {
        await tx`update public.quotes set status = ${status} where id = ${quoteId} and tenant_id = ${tenantId}`;
        if (status === "sent") {
          await tx`update public.leads set stage = 'quoted' where id = (select lead_id from public.quotes where id = ${quoteId}) and stage in ('new', 'inspection_booked')`;
        }
      }
    });
  } catch (err) {
    error = errorCode(err);
  }
  back(quoteId, error);
}
