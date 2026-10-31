// Demo tenants and users for local development and tests. Shared by scripts/seed.ts and the test suites.

export const SEED_PASSWORD = "bugsy-dev-password";

export const PLATFORM_ADMIN_EMAIL = "admin@bugsy.test";

export const ROLE_KEYS = [
  "owner",
  "office",
  "dispatcher",
  "technician",
  "sales_rep",
  "compliance_manager",
  "bookkeeper",
] as const;

export type SeedTenant = {
  name: string;
  legalName: string;
  timezone: string;
  domain: string;
  branches: { name: string; address: string; stateCode: string }[];
  /** A tenant-made role, so the tenant has roles of its own. */
  customRole: { key: string; name: string; permissions: string[] };
  pendingInviteEmail: string;
};

export const SEED_TENANTS: SeedTenant[] = [
  {
    name: "Northwind Pest Control",
    legalName: "Northwind Pest Control LLC",
    timezone: "America/New_York",
    domain: "northwind.test",
    branches: [
      { name: "Main office", address: "100 Main St, Columbus, OH 43215", stateCode: "OH" },
      { name: "East branch", address: "4400 East Broad St, Columbus, OH 43213", stateCode: "OH" },
    ],
    customRole: {
      key: "senior_technician",
      name: "Senior technician",
      permissions: ["dispatch.read", "visits.read", "visits.write", "customers.read", "compliance.read"],
    },
    pendingInviteEmail: "newhire@northwind.test",
  },
  {
    name: "Lakeshore Exterminating",
    legalName: "Lakeshore Exterminating Inc",
    timezone: "America/Chicago",
    domain: "lakeshore.test",
    branches: [
      { name: "Lakeshore HQ", address: "200 Lake St, Chicago, IL 60601", stateCode: "IL" },
      { name: "North branch", address: "900 Skokie Blvd, Northbrook, IL 60062", stateCode: "IL" },
    ],
    customRole: {
      key: "route_manager",
      name: "Route manager",
      permissions: ["dispatch.read", "dispatch.write", "visits.read", "customers.read", "reports.read"],
    },
    pendingInviteEmail: "newhire@lakeshore.test",
  },
];

export function seedUserEmail(tenant: SeedTenant, roleKey: (typeof ROLE_KEYS)[number]): string {
  return `${roleKey.replace("_", "-")}@${tenant.domain}`;
}

/** An outside bookkeeper who keeps the books for both companies: the one seeded user with two memberships. */
export const CROSS_TENANT_USER = {
  email: seedUserEmail(SEED_TENANTS[1], "bookkeeper"),
  homeTenant: SEED_TENANTS[1].name,
  alsoIn: SEED_TENANTS[0].name,
  roleKey: "bookkeeper" as const,
};
