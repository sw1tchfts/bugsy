> Exported from the Claude Doc on 2026-10-29 so Claude Code sessions can read it. The doc (https://claude.ai/artifact/PZvWbg1f2PkV4NJK7QjFqb) is the master copy; re-export after editing it.

# Pest Control Platform: Discovery Spec

Oct 19, 2026 · @Phil

## Scope

This is a multi-tenant platform sold to many Wisconsin pest control companies. Each company gets its own staff, customers, books and settings inside one shared system. It covers residential and commercial work across every common service line. The public website is deferred; this spec covers the office app, the technician app and the customer portal.

| Decision | Choice |
| --- | --- |
| Who buys it | Pest control companies (tenants), from one-truck owner-operators to multi-branch firms |
| Who uses it | Several user types per tenant, plus the tenant's own customers (see Users and roles) |
| Geography | Wisconsin only at launch; state rules kept in one module so other states can be added later |
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
| Mosquito and tick | Seasonal recurring, spring to fall | Season schedules, landscape notice rules, sales tax |
| Bed bug | Per-job bid, several visits | Multi-visit jobs, prep checklists |
| Wildlife | Per-job trapping, exclusion and repairs | Landowner authorization, bat blackout dates, materials |

**Wisconsin shapes the mix.** Work is seasonal; technicians earn more in warm months, so pay plans must hold up in winter ([PCT](https://pctonline.com/article/pct1010-cover-motivating-work)). Termites are a smaller line than in the South: established colonies sit in the southern half of the state, likely spread along rail lines ([USDA Forest Service](https://research.fs.usda.gov/treesearch/48731)). Bats are protected, which turns wildlife scheduling into a compliance problem (see Wisconsin rules).

## Wisconsin rules

Three agencies set the rules: DATCP (pesticides, chapter ATCP 29), DNR (wildlife) and DOR (sales tax). Almost every rule turns into a record the system must create, a notice it must send, or a date it must enforce.

**Licensing.** A for-hire applicator needs three things before any application: category certification (renewed every 5 years), an individual commercial applicator license, and a pesticide business license. Both licenses run January 1 to December 31 ([DATCP](https://datcp.wi.gov/Pages/Licenses_Permits/CommercialApplicator.aspx)). The business license is per business location, costs $70 plus a $20 surcharge, and lists every licensed employee ([ATCP 29.20](https://docs.legis.wisconsin.gov/code/admin_code/atcp/020/29/v/22)). A trainee may work 30 days under direct on-site supervision by a certified applicator ([UW Extension](https://fyi.extension.wisc.edu/pat/?p=3439)).

| Certification category | Covers | Service lines |
| --- | --- | --- |
| 7.1 Structural | Pests (including vertebrates and birds) in and around homes, food plants, schools, warehouses | General pest, rodent, bed bug |
| 7.3 Termite | Termite prevention and control in structures | Termite |
| 5.0 Aquatic and Mosquito | Mosquito control on land or larvae in water | Mosquito (tick category to confirm) |
| 26.0 Chemigation (subcategory) | Mosquito misting systems | Misting system installs |

Source: [UW Pesticide Applicator Training](https://fyi.extension.wisc.edu/pat/commercial-certification-categories). Structural work excludes mosquito control ([DATCP checklist](https://datcp.wi.gov/Documents/HTCStructuralChecklist.pdf)).

**Application records ([ATCP 29.21](https://docs.legis.wisconsin.gov/code/admin_code/atcp/020/29/v/22)).** The applicator completes a record the same day, and the business keeps it 2 years. Required fields:

- Applicator first and last name; customer name and address
- Site treated and a specific description of its location
- Date and approximate start and end time
- Product name and EPA registration number
- Concentration and total quantity, or amount per unit area and total area
- Mixing or loading location, unless applied from a retail container or equipment of 5 gallons or 50 pounds or less

**Customer notices.**

| Rule | When | What the system sends or posts |
| --- | --- | --- |
| [ATCP 29.22](https://docs.legis.wisconsin.gov/code/admin_code/atcp/020/29/v/22) post-application | Within 30 days, in writing; email or text only with prior written consent | Company phone, applicator names and license numbers, site, date and times, products with EPA numbers, quantities, label precautions, label copy offer |
| [ATCP 29.55](https://docs.legis.wisconsin.gov/code/admin_code/atcp/020/29/ix/55) residential offer | Before the first application, then yearly on continuing contracts | Written offer of pre-application information: products, labels, date, contact |
| ATCP 29.55 notice to residents | At the time of application | Notice left with an adult or posted at the unit door; common areas and perimeter jobs post in entryways |
| ATCP 29.55 warning sign | Before applying any product with a restricted entry interval | 8.5 x 11 inch sign at each entrance, removed when the interval ends |
| [ATCP 29.56](https://docs.legis.wisconsin.gov/code/admin_code/atcp/020/29/ix/55) landscape | Yard mosquito and tick spraying, and structural work beyond 10 feet of the building | Yearly offer, warning signs, and at least 12 hours notice to anyone on DATCP's landscape registry (mail postmarked 2 business days ahead) |

The 10-foot rule matters: a perimeter spray that reaches past 10 feet triggers the landscape rules ([DATCP checklist](https://datcp.wi.gov/Documents/HTCStructuralChecklist.pdf)). School boards must ensure anyone applying on public school grounds is certified (note to [ATCP 29.26](https://docs.legis.wisconsin.gov/code/admin_code/atcp/020/29/v/22)).

**Wildlife.** Bats are protected and may not be killed; exclusions may not be done June 1 to July 31 ([Wisconsin DNR](https://dnr.wisconsin.gov/topic/EndangeredResources/batFAQs)). Inside that window only the landowner may proceed, by filing a health exemption form within 5 days (same source). Removal of nuisance animals by a hired operator falls under DNR rule NR 12.10, which calls for the landowner's written approval; the exact fields are an open question below.

**Sales tax.** Structural pest control does not appear among the taxable services in DOR's materials. Wisconsin does tax spraying of lawns, trees and shrubs as a landscaping service, at 5% state plus county tax where it applies, sourced to the service address ([DOR Publication 210](https://www.revenue.wi.gov/DOR%20Publications/pb210.pdf)), so yard mosquito and tick spraying needs a ruling. Milwaukee County and the City of Milwaukee added or raised their own taxes in 2024 (same source). Invoices that mix taxable and nontaxable work must split the two (same source).

## Business model and pricing

The central object is the **service agreement**: a customer, a property, a service line, a cadence, a price and terms. Because tenants run their businesses differently, every answer below is a tenant setting with a sensible default, not a hard rule.

_(Diagram in the original doc: one agreement generates visits; each completed visit feeds compliance records, job costing and billing.)_

One completed visit feeds compliance, costing and billing at once, which is why the technician app sits at the center of the build.

| Question | Answer (default) | Why |
| --- | --- | --- |
| Recurring cadence | Support monthly, every other month, quarterly and custom; default quarterly | Quarterly is the most common residential plan |
| Seasonal programs | Support programs with a fixed number of rounds in a date window (mosquito and tick seasons) | Wisconsin mosquito and tick work stops in winter |
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
| Door-to-door sales | Supported as a phase 2 mobile flow: territory map, knock outcomes, quick quote, e-sign and card capture at the door | Many residential companies grow through seasonal door-to-door teams |
| Technician pay | Hourly, percentage of production with a draw and a monthly true-up, or a mix | Production pay targets a labor percentage; time records are still required by federal wage law ([PCT](https://pctonline.com/article/pct1010-cover-motivating-work)) |
| Sales commissions | On new sales and upsells, for reps and technicians, with holds and chargebacks when a customer cancels early | Common in the industry ([PCT](https://pctonline.com/article/pct1010-cover-motivating-work)) |
| E-signature | Yes; agreement signed before the first service, stored as a PDF on the account | The same signature captures written consent to electronic notices, which ATCP 29.22 requires |
| Follow-ups | Automated sequences for open quotes, renewals, seasonal upsells and win-backs | Mosquito and tick service is the natural spring upsell |
| Retention | Cancellation reason codes, save offers, churn by technician, route and service line | Retention is the number buyers and owners watch most |

**Rental and multi-unit properties** need resident contacts as well as the paying owner, because notices go to residents (ATCP 29.55).

## Scheduling and field ops

Agreements generate visits automatically into a due window (for example "any day in March"), and dispatch turns windows into dated routes. The technician app captures everything the Wisconsin record and notice rules need, so compliance is a by-product of doing the job.

| Question | Answer |
| --- | --- |
| Scale per tenant | 1 to 100+ technicians, one or more branches; each branch maps to a licensed business location |
| Dispatch | Phase 1: map-based dispatch board, drag and drop, simple route sequencing. Phase 2: full route optimization with time windows and workload balancing |
| License checks | The scheduler blocks assigning a job to a technician without a current license and the right category (for example 7.3 for termite) |
| Technician app | Installable mobile web app first, working offline for basements and rural areas; barcode scanning through the camera |
| Blackout and notice rules | Scheduler blocks bat exclusions June 1 to July 31; yard mosquito and tick jobs, and structural jobs beyond 10 feet, check the landscape registry and send 12-hour notice |

**What a technician records at each visit:**

- Arrival and departure times (these become the start and end times on the legal record)
- Areas treated, target pests and conditions found
- Products picked from the catalog, which fills in EPA numbers, plus amount and concentration
- Photos, notes, recommendations for the customer and a signature
- Device checks on commercial and termite jobs (activity, bait taken, damaged or missing)
- Follow-up needed, which creates the next visit or a quote

**Customer messages:** day-before reminder, "on the way" text, and a post-service summary. The summary doubles as the ATCP 29.22 notice when the customer consented to electronic delivery; otherwise the system produces a printable version. For residential jobs the app also prints or texts the resident notice, and the restricted-entry warning sign when a product needs one.

**Commercial accounts** need more than a visit log. Food plants and similar facilities face third-party audits (AIB, SQF, BRC) that check service reports, device maps, labels and safety data sheets, sighting logs, trend reports and whether recommendations were acted on ([Rentokil](https://www.rentokil.com/us/about/blog/food-processing/avoid-the-fail)). The system therefore tracks:

- A device inventory per site: bait stations, traps and insect light traps, each with a barcode and a position on a floor plan
- Per-device results at every visit, building a trend history
- A pest sighting log the customer can add to from the portal
- Recommendations with an owner and a closed date
- A one-click audit binder export for a date range

Auditors compare the map against the floor, so moving or adding a device must update the map in the same step (same source).

**Service-line specifics:** termite jobs carry a property diagram, bait station checks and a yearly warranty renewal. Wildlife jobs are multi-visit (set traps, check traps, exclude, repair) and carry materials like a small construction job. Bed bug jobs carry a prep checklist for the customer and scheduled follow-ups.

## Compliance module

Compliance is its own module, but technicians never fill out a separate form: it reads from visits, licenses and the product catalog. Wisconsin rules live in a rules file (notice timing, retention, required fields) so a second state is configuration, not a rewrite.

| Area | What the system does |
| --- | --- |
| Applicator licenses | Per technician: certification number, categories, certification expiry (5-year), license number and license year; alerts at 60 and 30 days |
| Business licenses | Per branch: license number and December 31 renewal; a roster of licensed employees, with a ready-made email to DATCP when an applicator is added ([UW Extension](https://fyi.extension.wisc.edu/pat/?p=4041)) |
| Trainees | 30-day registration clock and an assigned supervising applicator |
| Product catalog | One shared master list: product name, EPA registration number, active ingredients, restricted-use flag, restricted entry interval, label and safety data sheet files. Each tenant switches products on and sets its own cost |
| Inventory | Stock per branch and per truck; receipts, transfers, and usage deducted from visit records |
| Application records | Generated from the visit at day end with every ATCP 29.21 field; locked after that, corrected only by a logged amendment; kept at least 2 years |
| Customer notices | Post-application notice within 30 days, yearly pre-application offer on continuing contracts, resident notices, and a log proving each was sent |
| Electronic consent | Stored with the signed agreement, because email or text notices need prior written consent |
| Landscape registry | Tenant uploads DATCP's yearly registry; the system matches addresses and forces the 12-hour advance notice before matching jobs |
| Inspector export | All records, notices and licenses for a date range in one file, for a DATCP inspection |

**Restricted-use products** can only be assigned to licensed, certified applicators, never to trainees working alone.

## Billing and payments

Billing follows the agreement's billing mode, and every charge carries a service type that decides its tax. Each tenant gets its own payment account so money flows to the pest company, not to the platform.

| Question | Answer |
| --- | --- |
| Processor | Stripe, as in the rug suite, using Stripe's multi-merchant setup so each tenant is its own connected account; the platform can take a fee per payment if desired |
| Payment methods | Card and ACH, saved on file, with autopay; technicians can also take card, check or cash at the door |
| Invoice timing | On visit completion, on a monthly autopay date, or once a year for prepay; one statement per account across agreements |
| Sales tax | Taxability set per service type: structural pest work not taxed; yard mosquito and tick spraying pending a DOR ruling. Rate by service address (state 5%, plus county and city where they apply). Filing report by jurisdiction |
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

The hierarchy is platform, tenant (a pest company), branch (a licensed business location), then users. Every row of data belongs to one tenant and is invisible to all others; branch scoping limits what staff at large companies see.

| User type | Works in | Sees and does |
| --- | --- | --- |
| Platform admin (your team) | Platform console | Onboards tenants, maintains the shared product catalog and state rules; support access only with a logged, time-limited grant |
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
| Sales tax | On goods | Per service type (structural not taxed; yard spraying to confirm) |
| Regulation | Light | Heavy: licenses, records, notices |
| Field work | None | Technician app, routes, offline use |

**Where in-house AI pays off here:** drafting the post-service summary from technician notes, flagging visits where product amounts look wrong for the label, answering customer questions in the portal from their own service history, and spotting accounts likely to cancel. Pest identification from customer photos is a later option.

## MVP scope and phasing

Phase 1 covers what a residential company does every day, including Wisconsin compliance, because a tenant cannot switch systems without it. Commercial depth and specialty lines follow once a pilot company is running on the platform.

_(Phase chart in the original doc. The build order used here is in `specs/README.md`.)_

Phase 1 includes a spreadsheet import so a pilot company can load customers and agreements on day one; importers for specific pest software come in phase 3.

## Open questions

These need your call or an outside check before design starts.

- [ ] **First tenant size:** owner-operators (1 to 5 technicians) or mid-size firms (10 to 50)? This sets when route optimization, branches and commercial audit tools arrive.
- [ ] **Stack:** your usual Next.js, Supabase and Vercel, with Supabase row-level security enforcing tenant isolation?
- [ ] **Revenue from payments:** take a fee on each customer payment through Stripe, or charge only a software subscription?
- [ ] **Software pricing:** per technician, per active account, or tiered plans?
- [ ] **GL default:** full books in the app, or QuickBooks sync first? Worth asking 3 to 5 Wisconsin pest companies.
- [ ] **Design partner:** is there a Wisconsin pest company willing to pilot and shape the first version?
- [ ] **Migration:** do we need import tools for existing pest software (customers, agreements, balances, history) at launch?
- [ ] **Tick and yard tax:** which certification covers yard tick control, and is yard mosquito and tick spraying taxed like lawn spraying? Confirm with DATCP and DOR.
- [ ] **Wildlife operators:** confirm what NR 12.10 requires of a hired operator (written approval fields, any DNR permit).
- [ ] **Landscape registry:** what format DATCP distributes the yearly registry in, so the import can be planned.
- [ ] **Website:** still deferred, but the intake endpoint should exist at launch so the site plugs in later. Agree?

## Sources

- [Ad Astra Equity: How to sell your pest control business](https://www.adastraequity.com/sell-a-business/pest-control-companies)
- [InvoiceOwl: How to price pest control jobs](https://www.invoiceowl.com/blog/how-to-price-pest-control-jobs/)
- [PCT: Technician compensation (Motivating work)](https://pctonline.com/article/pct1010-cover-motivating-work)
- [Rentokil: Pest management items that can tank your audit score](https://www.rentokil.com/us/about/blog/food-processing/avoid-the-fail)
- [USDA Forest Service: Genetic analysis of termite colonies in Wisconsin](https://research.fs.usda.gov/treesearch/48731)
- [Wisconsin Administrative Code, ATCP 29.20 to 29.26](https://docs.legis.wisconsin.gov/code/admin_code/atcp/020/29/v/22)
- [Wisconsin Administrative Code, ATCP 29.54 to 29.56](https://docs.legis.wisconsin.gov/code/admin_code/atcp/020/29/ix/55)
- [DATCP: Structural pesticide applications compliance checklist](https://datcp.wi.gov/Documents/HTCStructuralChecklist.pdf)
- [DATCP: Commercial applicator](https://datcp.wi.gov/Pages/Licenses_Permits/CommercialApplicator.aspx)
- [UW Extension PAT: Commercial certification categories](https://fyi.extension.wisc.edu/pat/commercial-certification-categories)
- [UW Extension PAT: Commercial licensing](https://fyi.extension.wisc.edu/pat/?p=4041)
- [UW Extension PAT: How to get certified and licensed](https://fyi.extension.wisc.edu/pat/commercial-how-to-get-certified-and-licensed/)
- [Wisconsin DNR: Bat frequently asked questions](https://dnr.wisconsin.gov/topic/EndangeredResources/batFAQs)
- [Wisconsin DOR: Publication 210, landscaping services](https://www.revenue.wi.gov/DOR%20Publications/pb210.pdf)
