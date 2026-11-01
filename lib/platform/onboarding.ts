// The setup checklist (spec 13 rule 9), pure: the steps in order, where each is done, and progress. The database
// works out which are done (app.onboarding_status); nothing is ticked by hand.

export const STEPS = [
  { key: "details", label: "Company details", detail: "The legal name on invoices and notices.", href: "/settings/company" },
  { key: "branch", label: "A branch", detail: "Each office or shop, with its address and state.", href: "/settings/branches" },
  { key: "licenses", label: "Business licenses", detail: "A license number on every branch.", href: "/compliance/licenses" },
  { key: "service_types", label: "Service types", detail: "What you sell, with its service line and rules.", href: "/catalog/service-types" },
  { key: "price_book", label: "Price book", detail: "Prices by size, add-ons and one-time work.", href: "/catalog/service-types" },
  { key: "products", label: "Products", detail: "The products your technicians apply.", href: "/catalog/products" },
  { key: "credentials", label: "Applicator credentials", detail: "Each technician's certification and license.", href: "/compliance/credentials" },
  { key: "payments", label: "Payment account", detail: "Connect the account customers pay into.", href: "/billing/settings" },
  { key: "messaging", label: "Messaging", detail: "The name customers see on emails and texts.", href: "/settings/messaging" },
  { key: "team", label: "Your team", detail: "Invite the office and your technicians.", href: "/settings/users" },
  { key: "customers", label: "Customers", detail: "Import your spreadsheet or add accounts.", href: "/settings/import" },
  { key: "scheduled", label: "A scheduled visit", detail: "Put a visit on the dispatch board.", href: "/dispatch" },
  { key: "first_route", label: "First route", detail: "A technician completes a stop in the app.", href: "/dispatch" },
] as const;

export type StepKey = (typeof STEPS)[number]["key"];
export type OnboardingStatus = Partial<Record<StepKey, boolean>>;

export function progress(status: OnboardingStatus): { done: number; total: number; next: (typeof STEPS)[number] | null; complete: boolean } {
  const done = STEPS.filter((s) => status[s.key]).length;
  const next = STEPS.find((s) => !status[s.key]) ?? null;
  return { done, total: STEPS.length, next, complete: next === null };
}
