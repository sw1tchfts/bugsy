> Trimmed on 2026-10-31 to its general parts. The original Claude Doc (https://claude.ai/artifact/PZvWbg1f2PkV4NJK7QjFqb) also covered one state's rules, which are no longer part of the kit, so this file is no longer an exact export. Where this file and the PRD (`docs/prd.md`) differ, the PRD wins.

# Pest Control Platform: Discovery Spec

Oct 19, 2026 · @Phil

## Scope

This is a multi-tenant platform sold to pest control companies. Each company gets its own staff, customers, books and settings inside one shared system. It covers residential and commercial work across every common service line. The public website is deferred; this spec covers the office app, the technician app and the customer portal.

| Decision | Choice |
| --- | --- |
| Who buys it | Pest control companies (tenants), from one-truck owner-operators to multi-branch firms |
| Who uses it | Several user types per tenant, plus the tenant's own customers (see Users and roles) |
| Geography | Any US state; each state's rules are kept as data so a new state is configuration, not a rewrite |
| Segments | Residential and commercial |
| Service lines | General pest, termite, rodent, mosquito and tick, bed bug, wildlife. Lawn care, tree and shrub care, and other trades are out of scope |
| Public website | Deferred |
| Relationship to the rug suite | Separate app and codebase; reuses decision patterns, not code |

## How the business works

A pest control company is a route-based subscription business. Most revenue comes from recurring service agreements, and profit depends on stops per day and renewals. Rollins (Orkin's parent) reports about 75% recurring revenue, 10% add-on work and 15% one-time jobs ([Ad Astra](https://www.adastraequity.com/sell-a-business/pest-control-companies)).

**The core product is a general pest plan.** The first visit is priced higher because it includes an inspection and a heavy first treatment. After that the customer pays per recurring visit, usually quarterly ([InvoiceOwl](https://www.invoiceowl.com/blog/how-to-price-pest-control-jobs/)).

| Residential service | Typical U.S. price | How it is sold |
| --- | --- | --- |
| Initial visit on a plan | $150 to $300 | Once, at signup |
| Quarterly plan visit | $100 to $175 per visit | Most common residential plan |
| Monthly plan visit | $40 to $75 per visit | Densest routes, lowest per-visit price |
| One-time treatment | $100 to $300 | Single visit, no agreement |
| Termite treatment | $250 to $2,500+ | Bid per job after inspection |
| Bed bug treatment | $1,000 to $4,000+ | Bid per job, often several visits |

Plans usually include free re-services if pests return between visits, so that cost is built into the price. The written agreement spells out coverage, re-service terms and cancellation terms, and is signed before the first treatment ([InvoiceOwl](https://www.invoiceowl.com/blog/how-to-price-pest-control-jobs/)).

**Unit economics that the software must make visible:**

- Route density: 12 to 18 stops a day within a 10 to 15 mile radius is the benchmark buyers use ([Ad Astra](https://www.adastraequity.com/sell-a-business/pest-control-companies)).
- Retention: 80%+ annual retention is strong; under 2% monthly route attrition is top quartile, against a 2% to 3% norm (same source).
- Margin: EBITDA margins run roughly 15% to 25% (same source).
- Labor: technician pay is typically 20% to 25% of revenue, plus 5% to 7% for benefits and payroll taxes ([PCT](https://pctonline.com/article/pct1010-cover-motivating-work)).

**Service lines differ in how they are sold, which drives the data model:**

| Service line | Sales model | What the system must handle |
| --- | --- | --- |
| General pest | Recurring plan | Agreements, routes, re-services |
| Rodent | Recurring plan or one-time; commercial station programs | Device (station) tracking |
| Termite | Inspection, per-job treatment, then yearly warranty or monitoring | Warranties and renewals, bait station checks, property diagrams |
| Mosquito and tick | Seasonal recurring, spring to fall | Season schedules, state notice rules for yard spraying, sales tax |
| Bed bug | Per-job bid, several visits | Multi-visit jobs, prep checklists |
| Wildlife | Per-job trapping, exclusion and repairs | Landowner authorization, seasonal blackouts such as bat exclusion windows, materials |

**Seasons shape the mix.** In northern states outdoor work stops in winter and technicians earn more in warm months, so pay plans must hold up in winter ([PCT](https://pctonline.com/article/pct1010-cover-motivating-work)). Termite and mosquito demand vary widely by region.

## Business model and pricing

The central object is the **service agreement**: a customer, a property, a service line, a cadence, a price and terms. Because tenants run their businesses differently, every answer below is a tenant setting with a sensible default, not a hard rule.

One completed visit feeds compliance, costing and billing at once, which is why the technician app sits at the center of the build.

| Question | Answer (default) | Why |
| --- | --- | --- |
| Recurring cadence | Support monthly, every other month, quarterly and custom; default quarterly | Quarterly is the most common residential plan |
| Seasonal programs | Support programs with a fixed number of rounds in a date window (mosquito and tick seasons) | Mosquito and tick work stops in winter in much of the country |
| Initial service | Separate, higher-priced first visit on every plan | Inspection and heavy first treatment cost more |
| Pricing method | A price book per tenant: plan tiers by property size, add-ons (garage, shed, crawl space), and bid pricing for specialty work | Matches how the industry quotes |
| Specialty work | Quote built from labor hours plus materials after an inspection | Termite, bed bug and wildlife are never rate-card jobs |
| Commercial pricing | Custom per account, per site, often per device | Each facility differs |
| Billing timing | Per visit, flat monthly autopay, or annual prepay, chosen per agreement | Each changes cash flow and revenue accounting (see GL) |
| Contract terms | 12-month initial term, auto-renew, optional early cancellation fee; month-to-month allowed | Protects the discounted first visit; tenant decides |
| Re-services | Logged as $0 visits tied to the agreement, with labor and product cost captured | Real margin per account needs the hidden cost |
| Winter | Allow skipped months, interior-only winter visits, and smoothed monthly billing | Keeps cash flow and technician pay steady in the off season |
| Price changes | Yearly price increases applied in bulk with customer notice | Standard way to protect margin on long-lived accounts |

**A customer can hold several agreements** (for example general pest plus mosquito), each with its own schedule and tax treatment. Invoices roll them up so the customer sees one bill.

## Sales and CRM

The CRM separates who pays from where the work happens. An **account** is the billing party, a **property** is a service location, and **contacts** hang off either. A landlord or a restaurant group is one account with many properties; a homeowner is one account with one.

**Pipeline stages:** lead, inspection booked, quote sent, signed, initial service done, active, cancelled. Every lead keeps its source so tenants can see cost and close rate by channel.

| Question | Answer | Notes |
| --- | --- | --- |
| Lead sources | Phone, door to door, referrals, online directories and ads, and later the website | Source is required on every lead |
| Door-to-door sales | A mobile flow: territory map, knock outcomes, quick quote, e-sign and card capture at the door | Many residential companies grow through seasonal door-to-door teams |
| Technician pay | Hourly, percentage of production with a draw and a monthly true-up, or a mix | Production pay targets a labor percentage; time records are still required by federal wage law ([PCT](https://pctonline.com/article/pct1010-cover-motivating-work)) |
| Sales commissions | On new sales and upsells, for reps and technicians, with holds and chargebacks when a customer cancels early | Common in the industry ([PCT](https://pctonline.com/article/pct1010-cover-motivating-work)) |
| E-signature | Yes; agreement signed before the first service, stored as a PDF on the account | The same signature captures written consent to electronic notices, which some states require before email or text delivery |
| Follow-ups | Automated sequences for open quotes, renewals, seasonal upsells and win-backs | Mosquito and tick service is the natural spring upsell |
| Retention | Cancellation reason codes, save offers, churn by technician, route and service line | Retention is the number buyers and owners watch most |

**Rental and multi-unit properties** need resident contacts as well as the paying owner, because many states require pesticide notices to residents.

## Scheduling and field ops

Agreements generate visits automatically into a due window (for example "any day in March"), and dispatch turns windows into dated routes. The technician app captures everything the state's record and notice rules need, so compliance is a by-product of doing the job.

| Question | Answer |
| --- | --- |
| Scale per tenant | 1 to 100+ technicians, one or more branches; each branch maps to a business location |
| Dispatch | Map-based dispatch board, drag and drop, route sequencing, and route optimization with time windows and workload balancing |
| License checks | The scheduler blocks assigning a job to a technician without a current license and the right certification category for the property's state (for example a termite category for termite work) |
| Technician app | Mobile app working offline for basements and rural areas; barcode scanning through the camera |
| Blackout and notice rules | The scheduler blocks job kinds inside a state's blackout windows and holds jobs that need advance notice until it is sent |

**What a technician records at each visit:**

- Arrival and departure times (these become the start and end times on the legal record)
- Areas treated, target pests and conditions found
- Products picked from the catalog, which fills in EPA numbers, plus amount and concentration
- Photos, notes, recommendations for the customer and a signature
- Device checks on commercial and termite jobs (activity, bait taken, damaged or missing)
- Follow-up needed, which creates the next visit or a quote

**Customer messages:** day-before reminder, "on the way" text, and a post-service summary. The summary doubles as the post-application notice where the state requires one and the customer consented to electronic delivery; otherwise the system produces a printable version. Where the state requires them, the app also produces resident notices and restricted-entry warning signs.

**Commercial accounts** need more than a visit log. Food plants and similar facilities face third-party audits (AIB, SQF, BRC) that check service reports, device maps, labels and safety data sheets, sighting logs, trend reports and whether recommendations were acted on ([Rentokil](https://www.rentokil.com/us/about/blog/food-processing/avoid-the-fail)). The system therefore tracks:

- A device inventory per site: bait stations, traps and insect light traps, each with a barcode and a position on a floor plan
- Per-device results at every visit, building a trend history
- A pest sighting log the customer can add to from the portal
- Recommendations with an owner and a closed date
- A one-click audit binder export for a date range

Auditors compare the map against the floor, so moving or adding a device must update the map in the same step (same source).

**Service-line specifics:** termite jobs carry a property diagram, bait station checks and a yearly warranty renewal. Wildlife jobs are multi-visit (set traps, check traps, exclude, repair) and carry materials like a small construction job. Bed bug jobs carry a prep checklist for the customer and scheduled follow-ups.

## Compliance module

Compliance is its own module, but technicians never fill out a separate form: it reads from visits, licenses and the product catalog. Each state's rules (record fields, notice timing, retention, registries, blackouts) live in a rule pack, so a new state is configuration, not a rewrite.

| Area | What the system does |
| --- | --- |
| Applicator licenses | Per technician and state: certification number, categories, certification expiry, license number and license year; alerts at 60 and 30 days |
| Business licenses | Per branch: license number and renewal date where the state requires one, and a roster of licensed employees |
| Trainees | The state's trainee rules, such as a time limit and an assigned supervising applicator |
| Product catalog | One shared master list: product name, EPA registration number, active ingredients, restricted-use flag, restricted entry interval, label and safety data sheet files. Each tenant switches products on and sets its own cost |
| Inventory | Stock per branch and per truck; receipts, transfers, and usage deducted from visit records |
| Application records | Generated from the visit with every field the state requires; locked after that, corrected only by a logged amendment; kept for the state's retention period |
| Customer notices | Post-application notices, pre-application offers on continuing contracts, resident notices, and a log proving each was sent, as the state requires |
| Electronic consent | Stored with the signed agreement, because some states require prior written consent for email or text notices |
| Notification registries | Tenants upload a state's registry; the system matches addresses and forces any required advance notice before matching jobs |
| Inspector export | All records, notices and licenses for a date range in one file, for a state inspection |

**Restricted-use products** can only be assigned to licensed, certified applicators, never to trainees working alone.

## Billing and payments

Billing follows the agreement's billing mode, and every charge carries a service type that decides its tax. Each tenant gets its own payment account so money flows to the pest company, not to the platform.

| Question | Answer |
| --- | --- |
| Processor | Stripe, as in the rug suite, using Stripe's multi-merchant setup so each tenant is its own connected account; the platform can take a fee per payment if desired |
| Payment methods | Card and ACH, saved on file, with autopay; technicians can also take card, check or cash at the door |
| Invoice timing | On visit completion, on a monthly autopay date, or once a year for prepay; one statement per account across agreements |
| Sales tax | Taxability set per service type and state; rate by service address (state plus county and city where they apply); filing report by jurisdiction |
| Tax exemptions | Exemption certificates stored per account (for example government customers) and applied automatically |
| Collections | Reminder schedule, automatic card retries, optional late fees, and a past-due flag that warns the technician and can pause service |
| Commercial billing | PO numbers, net terms, one invoice per site or one consolidated invoice for a multi-site account |
| Cancellations | Pro-rated refund or balance due on prepaid plans, plus the early cancellation fee if the agreement has one |
| Customer portal | Pay invoices, update card, see visit history, products applied and notices, request a re-service |

**Two kinds of billing live in the platform:** tenants billing their customers (above), and the platform billing tenants for the software. Keep them in separate modules from day one.

## GL and accounting

Recommendation: build a real double-entry GL per tenant, as in the rug suite, and add a QuickBooks Online sync as an optional adapter. Many small pest companies already keep books in QuickBooks with an outside accountant, so forcing them off it would slow sales.

| Question | Answer |
| --- | --- |
| Own GL or sync | Own GL is the system of record for AR, deferred revenue, inventory, commissions and sales tax. Tenants choose full books in the app, or a daily summarized journal pushed to QuickBooks |
| Chart of accounts | A pest control template: revenue per service line, deferred revenue, AR, Stripe clearing, chemical inventory, chemical cost, technician labor, commissions payable, sales tax payable by jurisdiction, vehicles, licenses and permits |
| Revenue recognition | Earned when a visit is done. Money collected before the visit (monthly flat plans, annual prepay) sits in deferred revenue and moves to revenue as visits complete. If a visit comes before enough has been billed, the gap is an unbilled receivable. Warranty renewals are spread over the warranty year |
| Cash or accrual | Books kept on accrual; a cash-basis view for owners and tax preparers who file that way |
| Job costing | Labor from visit timestamps times a loaded hourly rate, product cost from usage, commissions; margin per visit, account, route, technician and service line |
| Payroll | Not built. Export hours, production pay and commissions to a payroll provider and post the payroll journal back |
| Bank and Stripe | Bank feed for reconciliation; each Stripe payout is matched to its payments and fees through a clearing account |
| Close | Monthly close checklist: deferred revenue roll-forward, inventory count adjustments, sales tax liability tie-out |

**Why deferred revenue matters here:** a quarterly customer on flat monthly autopay pays every month but is served four times a year. Booking revenue as billed would show smooth revenue against costs that land in service months, and would hide the unbilled balance left when someone cancels right after a visit.

## Users and roles

The hierarchy is platform, tenant (a pest company), branch (a business location), then users. Every row of data belongs to one tenant and is invisible to all others; branch scoping limits what staff at large companies see.

| User type | Works in | Sees and does |
| --- | --- | --- |
| Platform admin (your team) | Platform console | Onboards tenants, maintains the shared product catalog and state rule packs; support access only with a logged, time-limited grant |
| Owner or admin | Office app | Everything in the tenant, including settings, pricing, GL and user management |
| Office staff | Office app | Customers, agreements, scheduling, billing and collections; no GL settings or payroll data |
| Dispatcher or service manager | Office app | Dispatch board, routes, technician workloads, re-service queue |
| Technician | Technician app | Own route, visit records, truck inventory, limited customer details; works offline |
| Sales rep | Technician app and office app | Leads, quotes, own accounts and own commissions |
| Licensed manager (compliance) | Office app | Licenses, application records, notices, inspector exports |
| Bookkeeper or outside accountant | Office app | GL, reports and reconciliations; read-only elsewhere |
| Residential customer | Customer portal | Pay, update card, visit history, notices, request service |
| Commercial customer user | Customer portal | Per-site reports, device maps, trends, sighting log entries, audit binder download |
| Property manager | Customer portal | All properties under the account, per-unit history |

Roles are bundles of permissions. Tenants start from these defaults and can copy and adjust them.

## Carried over from the rug suite

The decision patterns carry over; the shape of the business does not. The rug suite sells physical goods for one company, while this platform runs recurring field service for many companies.

| Decision | Rug suite | Pest platform |
| --- | --- | --- |
| GL | Build our own | Build our own, plus an optional QuickBooks sync |
| Payments | Stripe | Stripe, one connected account per tenant |
| AI | Sales agent built in-house | Built in-house; uses below |
| Integrations | Handled one supplier at a time | Handled one adapter at a time (QuickBooks, payroll, bank feeds) |
| Tenancy | One business | Many tenants, strict data isolation |
| Banking | Mercury considered for the business | Each tenant brings its own bank; generic bank feed |
| What is sold | Goods from suppliers | Recurring visits and per-job services |
| Revenue timing | On delivery of goods | As visits are performed, with deferral |
| Sales tax | On goods | Per service type and state |
| Regulation | Light | Heavy: licenses, records, notices |
| Field work | None | Technician app, routes, offline use |

**Where in-house AI pays off here:** drafting the post-service summary from technician notes, flagging visits where product amounts look wrong for the label, answering customer questions in the portal from their own service history, and spotting accounts likely to cancel. Pest identification from customer photos is a later option.

## Scope and build

Everything on the feature list ships in one build; the PRD (`docs/prd.md`) has the scope per feature, the spec list and the launch gate. A spreadsheet import lets the first company load customers and agreements on day one; importers for specific pest software come later.

## Open questions

The PRD's Decisions page carries these with recommendations.

- [ ] **First tenant size:** owner-operators (1 to 5 technicians) or mid-size firms (10 to 50)?
- [ ] **Stack:** Next.js, Supabase and Vercel, with Supabase row-level security enforcing tenant isolation?
- [ ] **Revenue from payments:** take a fee on each customer payment through Stripe, or charge only a software subscription?
- [ ] **Software pricing:** per technician, per active account, or tiered plans?
- [ ] **GL default:** full books in the app, or QuickBooks sync first?
- [ ] **Design partner:** which pest company will pilot and shape the first version, and in which state?
- [ ] **Migration:** do we need import tools for existing pest software (customers, agreements, balances, history) at launch?
- [ ] **Launch states:** each launch state's rules (records, notices, registries, license categories, sales tax on yard spraying) must be researched and confirmed.
- [ ] **Website:** still deferred, but the intake endpoint should exist at launch so the site plugs in later. Agree?

## Sources

- [Ad Astra Equity: How to sell your pest control business](https://www.adastraequity.com/sell-a-business/pest-control-companies)
- [InvoiceOwl: How to price pest control jobs](https://www.invoiceowl.com/blog/how-to-price-pest-control-jobs/)
- [PCT: Technician compensation (Motivating work)](https://pctonline.com/article/pct1010-cover-motivating-work)
- [Rentokil: Pest management items that can tank your audit score](https://www.rentokil.com/us/about/blog/food-processing/avoid-the-fail)
