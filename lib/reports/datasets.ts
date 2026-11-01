// The datasets reports and the export read (spec 12 rules 9 and 10). Each is a fixed query with $1 for the company,
// declared columns and the permission it needs; the builder only ever names these. Row level security still decides
// which rows a member sees, because every query runs under their session.

export type ColumnType = "text" | "number" | "money" | "date" | "boolean";
export type DatasetColumn = { name: string; label: string; type: ColumnType };
export type Dataset = { key: string; label: string; permission: string; columns: DatasetColumn[]; sql: string };

// Business dates are the company's: a timestamp becomes a date in the tenant's zone, not the session's.
const TZ = "(select t.timezone from public.tenants t where t.id = $1)";
const day = (expr: string) => `(${expr} at time zone ${TZ})::date`;

const c = (name: string, label: string, type: ColumnType = "text"): DatasetColumn => ({ name, label, type });

export const DATASETS: Dataset[] = [
  {
    key: "accounts",
    label: "Accounts",
    permission: "customers.read",
    columns: [c("name", "Name"), c("type", "Type"), c("status", "Status"), c("email", "Email"), c("phone", "Phone"), c("terms_days", "Terms (days)", "number"), c("po_required", "PO required", "boolean"), c("past_due_since", "Past due since", "date"), c("created_on", "Created", "date"), c("external_id", "Old system id")],
    sql: `select a.name, a.type, a.status, a.email, a.phone, a.terms_days, a.po_required, a.past_due_since, ${day("a.created_at")} as created_on, a.external_id
          from public.accounts a where a.tenant_id = $1 and a.archived_at is null`,
  },
  {
    key: "properties",
    label: "Properties",
    permission: "customers.read",
    columns: [c("account", "Account"), c("address", "Address"), c("city", "City"), c("state_code", "State"), c("postal_code", "ZIP"), c("property_type", "Type"), c("size_sqft", "Square feet", "number"), c("unit_count", "Units", "number")],
    sql: `select a.name as account, p.normalized_address as address, p.city, p.state_code, p.postal_code, p.property_type, p.size_sqft, p.unit_count
          from public.properties p join public.accounts a on a.id = p.account_id where p.tenant_id = $1 and p.archived_at is null`,
  },
  {
    key: "agreements",
    label: "Agreements",
    permission: "agreements.read",
    columns: [
      c("number", "Number", "number"), c("account", "Account"), c("service_type", "Service type"), c("service_line", "Service line"), c("status", "Status"), c("billing_mode", "Billing mode"), c("cadence", "Cadence"),
      c("starts_on", "Starts", "date"), c("ends_on", "Ends", "date"), c("signed_on", "Signed", "date"), c("cancelled_on", "Cancelled", "date"), c("cancel_reason", "Cancel reason"),
      c("initial_price", "Initial price", "money"), c("recurring_price", "Recurring price", "money"), c("auto_renew", "Auto renew", "boolean"), c("imported", "Imported", "boolean"), c("state_code", "State"),
    ],
    sql: `select g.number, a.name as account, st.name as service_type, st.service_line, g.status, g.billing_mode, g.cadence, g.starts_on, g.ends_on, ${day("g.signed_at")} as signed_on, g.cancelled_on,
                 r.name as cancel_reason, g.initial_price_cents as initial_price, g.recurring_price_cents as recurring_price, g.auto_renew, g.cutover_on is not null as imported, p.state_code
          from public.agreements g join public.accounts a on a.id = g.account_id join public.service_types st on st.id = g.service_type_id join public.properties p on p.id = g.property_id
          left join public.cancel_reasons r on r.id = g.cancel_reason_id
          where g.tenant_id = $1`,
  },
  {
    key: "visits",
    label: "Visits",
    permission: "visits.read",
    columns: [
      c("scheduled_for", "Scheduled", "date"), c("due_start", "Due from", "date"), c("status", "Status"), c("kind", "Kind"), c("service_type", "Service type"), c("service_line", "Service line"), c("account", "Account"),
      c("city", "City"), c("state_code", "State"), c("technician", "Technician"), c("price", "Price", "money"), c("minutes_on_site", "Minutes on site", "number"), c("imported", "Done before Bugsy", "boolean"),
    ],
    sql: `select v.scheduled_for, v.due_start, v.status, v.kind, st.name as service_type, st.service_line, a.name as account, p.city, p.state_code,
                 coalesce(m.display_name, 'Unassigned') as technician, v.price_cents as price,
                 case when v.arrived_at is not null and v.departed_at is not null then round(extract(epoch from (v.departed_at - v.arrived_at)) / 60) end as minutes_on_site, v.imported
          from public.visits v join public.service_types st on st.id = v.service_type_id join public.accounts a on a.id = v.account_id join public.properties p on p.id = v.property_id
          left join public.memberships m on m.tenant_id = v.tenant_id and m.user_id = v.technician_id
          where v.tenant_id = $1`,
  },
  {
    key: "invoices",
    label: "Invoices",
    permission: "billing.read",
    columns: [c("number", "Number", "number"), c("kind", "Kind"), c("status", "Status"), c("source", "Source"), c("account", "Account"), c("issued_on", "Issued", "date"), c("due_on", "Due", "date"), c("subtotal", "Subtotal", "money"), c("tax", "Tax", "money"), c("total", "Total", "money"), c("paid", "Paid", "money"), c("open", "Open", "money")],
    sql: `select i.number, i.kind, i.status, i.source, a.name as account, i.issued_on, i.due_on, i.subtotal_cents as subtotal, i.tax_cents as tax, i.total_cents as total, i.paid_cents as paid,
                 case when i.status in ('issued', 'partially_paid', 'past_due') then i.total_cents - i.paid_cents else 0 end as open
          from public.invoices i join public.accounts a on a.id = i.account_id where i.tenant_id = $1 and i.status <> 'draft'`,
  },
  {
    key: "payments",
    label: "Payments",
    permission: "billing.read",
    columns: [c("kind", "Kind"), c("method", "Method"), c("status", "Status"), c("amount", "Amount", "money"), c("received_on", "Received", "date"), c("account", "Account"), c("reference", "Reference")],
    sql: `select p.kind, p.method, p.status, p.amount_cents as amount, ${day("p.received_at")} as received_on, a.name as account, p.reference
          from public.payments p join public.accounts a on a.id = p.account_id where p.tenant_id = $1`,
  },
  {
    key: "leads",
    label: "Leads",
    permission: "customers.read",
    columns: [c("name", "Name"), c("stage", "Stage"), c("source", "Source"), c("created_on", "Created", "date"), c("city", "City"), c("state_code", "State")],
    sql: `select l.name, l.stage, coalesce(s.name, 'unknown') as source, ${day("l.created_at")} as created_on, l.city, l.state_code
          from public.leads l left join public.lead_sources s on s.id = l.source_id where l.tenant_id = $1`,
  },
  {
    key: "journal_lines",
    label: "Journal lines",
    permission: "gl.read",
    columns: [c("entry", "Entry", "number"), c("posted_on", "Posted", "date"), c("period", "Period"), c("source_type", "Kind"), c("account_number", "Account number"), c("account_name", "Account"), c("debit", "Debit", "money"), c("credit", "Credit", "money"), c("agreement", "Agreement", "number")],
    sql: `select e.number as entry, e.posted_on, e.period, e.source_type, g.number as account_number, g.name as account_name, l.debit_cents as debit, l.credit_cents as credit, ag.number as agreement
          from public.journal_lines l join public.journal_entries e on e.id = l.entry_id join public.gl_accounts g on g.id = l.gl_account_id left join public.agreements ag on ag.id = l.agreement_id
          where l.tenant_id = $1`,
  },
  {
    key: "messages",
    label: "Messages",
    permission: "customers.read",
    columns: [c("direction", "Direction"), c("channel", "Channel"), c("purpose", "Purpose"), c("status", "Status"), c("created_on", "Created", "date"), c("account", "Account"), c("suppressed_reason", "Not sent because")],
    sql: `select m.direction, m.channel, m.purpose, m.status, ${day("m.created_at")} as created_on, a.name as account, m.suppressed_reason
          from public.messages m left join public.accounts a on a.id = m.account_id where m.tenant_id = $1`,
  },
];

export function datasetFor(key: string): Dataset | undefined {
  return DATASETS.find((d) => d.key === key);
}
