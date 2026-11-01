// Permission strings used in roles.permissions. "*" grants everything and marks a role as an owner role.

export const PERMISSION_GROUPS = [
  {
    label: "Customers and sales",
    permissions: [
      { key: "customers.read", label: "View customers, properties and leads" },
      { key: "customers.write", label: "Edit customers, properties and leads" },
      { key: "agreements.read", label: "View agreements and quotes" },
      { key: "agreements.write", label: "Edit agreements and quotes" },
    ],
  },
  {
    label: "Catalog",
    permissions: [
      { key: "catalog.read", label: "View service types, the price book and products" },
      { key: "catalog.write", label: "Edit service types, the price book and products" },
    ],
  },
  {
    label: "Scheduling and visits",
    permissions: [
      { key: "dispatch.read", label: "View the dispatch board and routes" },
      { key: "dispatch.write", label: "Schedule and assign visits" },
      { key: "visits.read", label: "View visits and records" },
      { key: "visits.write", label: "Complete visits and record applications" },
    ],
  },
  {
    label: "Compliance",
    permissions: [
      { key: "compliance.read", label: "View credentials, records and notices" },
      { key: "compliance.write", label: "Manage credentials, amend records, send notices" },
      { key: "inventory.read", label: "View stock on trucks and in warehouses" },
      { key: "inventory.write", label: "Receive, move and count stock" },
    ],
  },
  {
    label: "Money",
    permissions: [
      { key: "billing.read", label: "View invoices and payments" },
      { key: "billing.write", label: "Issue invoices, take payments, run collections" },
      { key: "payments.capture", label: "Save a customer's card for autopay (no charges or refunds)" },
      { key: "payroll.read", label: "View time, pay rates and payroll exports" },
      { key: "payroll.write", label: "Correct time, set pay, export payroll and post it" },
      { key: "gl.read", label: "View the general ledger" },
      { key: "gl.write", label: "Post journal entries and close periods" },
      { key: "reports.read", label: "View reports" },
    ],
  },
  {
    label: "Messages",
    permissions: [
      { key: "messages.send", label: "Send messages and reply to customers" },
      { key: "messages.manage", label: "Edit message templates, settings and campaigns" },
    ],
  },
  {
    label: "Company settings",
    permissions: [
      { key: "settings.read", label: "View company settings and branches" },
      { key: "settings.write", label: "Edit company settings, branches and roles" },
      { key: "data.import", label: "Import spreadsheets at go-live" },
      { key: "users.read", label: "View users and invitations" },
      { key: "users.write", label: "Invite, change and remove users" },
      { key: "audit.read", label: "View the audit trail" },
    ],
  },
] as const;

export type Permission = (typeof PERMISSION_GROUPS)[number]["permissions"][number]["key"] | "*";

export const ALL_PERMISSIONS: readonly Permission[] = PERMISSION_GROUPS.flatMap((g) => g.permissions.map((p) => p.key));

/** True when a role's permission list grants `permission`. "*" grants everything. */
export function can(granted: readonly string[], permission: string): boolean {
  return granted.includes("*") || granted.includes(permission);
}

export function isOwnerRole(granted: readonly string[]): boolean {
  return granted.includes("*");
}
