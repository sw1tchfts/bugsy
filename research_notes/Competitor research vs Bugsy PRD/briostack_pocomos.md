# Briostack and Pocomos vs the Bugsy PRD (as of 2026-10-29)

Scope: pest control features only. Baselines: `docs/competitors/briostack.json` and `docs/competitors/pocomos.json`, both researched 2026-10-20. Status values follow `docs/competitors/feature-taxonomy.json`. Anything dated before 2025 is labeled older.

Notes on sources:
- **pocomos.com:** the site was rebuilt as a client-side app, so WebFetch got only the page title. Pocomos figures and quotes below were read from the site's own JavaScript bundle on 2026-10-29. That bundle holds the text of /pricing, /faq, /features/* and /vs-fieldroutes. The page URL is cited.
- **Blocked review sites:** Capterra, G2, GetApp and Software Advice returned HTTP 403, so their figures come from search-result snippets and are marked as such.
- **Missing source:** the LawnStarter Briostack demo page behind the PRD's $95 and $45 figures now returns 404.

## 1. PRD wedge claims, feature by feature

### Takeaway
The PRD wedge claim holds for both products. Neither has full, vendor-documented support for Wisconsin compliance, pesticide notices, RUP controls, license tracking, an EPA/SDS catalog, license-based assignment, a GL, deferred revenue, cancellation billing, re-service cost tracking, a tiered price book or retention analytics. The only Yes is Briostack's seasonal templates (AGR-02), and that one is weak. Briostack added new, undocumented compliance claims in October 2026 that the PRD's "Why now" section does not reflect: "Technician licensing and product controls", WDI/WDO forms for all 50 states, and a direct California Department of Agriculture integration.

### Cited Findings

**Briostack, wedge features (status as of 2026-10-29)**

| ID | Status | Evidence |
| --- | --- | --- |
| CMP-08 Wisconsin | Unknown (no Wisconsin anywhere) | Vendor names only "Built-in, state-specific WDI/WDO forms (all 50 states)", a "direct CA Dept. of Agriculture integration" and a "Sentricon integration". No Wisconsin, ATCP 29, landscape registry or posting. — [Briostack vs GorillaDesk (vendor, lastmod 2026-10-08)](https://www.briostack.com/comparison/briostack-vs-gorilladesk/). The pest software page describes no state compliance. — [Briostack pest control software](https://www.briostack.com/pest-control-software/) |
| CMP-05 automatic pesticide notices | Unknown (at most generic Partial) | On completion the platform can "send the appropriate customer notification". Reminders go by the customer's preferred channel (email, text, phone, mail). Nothing pesticide-specific. — [Briostack vs Jobber (lastmod 2026-10-21)](https://www.briostack.com/comparison/briostack-vs-jobber/); [Briostack CRM page](https://www.briostack.com/pest-control-software/pest-control-crm-software/) |
| CMP-06 restricted-use controls | Unknown | No RUP fields or controls documented. "Technician licensing and product controls" is listed with no detail. — [Briostack vs GorillaDesk](https://www.briostack.com/comparison/briostack-vs-gorilladesk/) |
| CMP-03 applicator license tracking | Unknown (new vendor claim, no detail) | The same "Technician licensing and product controls" line. No license numbers, categories or expiry alerts documented. The vs Jobber page does not mention licensing. — [Briostack vs GorillaDesk](https://www.briostack.com/comparison/briostack-vs-gorilladesk/); [Briostack vs Jobber](https://www.briostack.com/comparison/briostack-vs-jobber/) |
| CMP-02 catalog with EPA no., label, SDS | Partial (unchanged) | Comparison pages cite "Chemical and product application tracking". EPA numbers, labels and SDS are not documented. The baseline's "custom chemical lists" came from the now-404 LawnStarter demo. — [Briostack vs Jobber](https://www.briostack.com/comparison/briostack-vs-jobber/) |
| SCH-04 license or skill assignment | Partial | "Automatically generate best-fit recommendations for new work orders". No skill, license or certification criteria are mentioned. — [Briostack scheduling and routing](https://www.briostack.com/pest-control-software/scheduling-routing-software/) |
| ACC-01 built-in GL | No | "Our pest control accounting software seamlessly integrates with QuickBooks Online (QBO)". No ledger is mentioned. — [Briostack invoicing and accounting](https://www.briostack.com/pest-control-software/invoicing-accounting-software/). "Briostack integrates with QuickBooks to support accounting workflows." — [Briostack vs Jobber](https://www.briostack.com/comparison/briostack-vs-jobber/) |
| ACC-04 deferred revenue | Unknown | Only a "prepayment campaign" billing option is listed. How deferred revenue is recognized is not described. — [Briostack invoicing and accounting](https://www.briostack.com/pest-control-software/invoicing-accounting-software/) |
| BIL-07 prorated refunds and cancellation billing | Unknown | Cancellations, proration and refunds are not mentioned. — [Briostack invoicing and accounting](https://www.briostack.com/pest-control-software/invoicing-accounting-software/) |
| AGR-07 re-service tracking | Partial, could not re-verify | The baseline cites a "reservice rate report" from a third-party demo whose URL now returns 404. No vendor page mentions re-service. — [LawnStarter (404 on 2026-10-29)](https://lawnstarter.com/blog/?p=52157); [Briostack pest control software](https://www.briostack.com/pest-control-software/) |
| AGR-02 seasonal programs and rounds | Yes (weak) | "Set seasonal appointments and templates for spacing out each type of service by number of days." The page does not use the word "rounds" for pest. — [Briostack scheduling and routing](https://www.briostack.com/pest-control-software/scheduling-routing-software/). The vs Jobber page cites "treatment programs, service sequencing". — [Briostack vs Jobber](https://www.briostack.com/comparison/briostack-vs-jobber/) |
| AGR-03 price book with tiers and add-ons | Partial | Pricing "by square foot or flat rate" in bids. The vs Jobber page now claims "service bundles", where the baseline had reviewers reporting bundles missing. No central add-on price book is documented. — [Briostack pest control software](https://www.briostack.com/pest-control-software/); [Briostack vs Jobber](https://www.briostack.com/comparison/briostack-vs-jobber/) |
| RPT-02 retention and churn analytics | Partial | Dashboards show "your attrition rate". Brio Insights (sold in the Growth Bundle) adds role-based dashboards that track cancellations. No breakdown by route, technician or service is documented. — [Briostack CRM page](https://www.briostack.com/pest-control-software/pest-control-crm-software/); [Briostack Growth Bundle](https://www.briostack.com/growth-bundle/) |

**Pocomos, wedge features (status as of 2026-10-29)**

| ID | Status | Evidence |
| --- | --- | --- |
| CMP-08 Wisconsin | Unknown (no Wisconsin anywhere) | The new Custom Documents feature names state forms for Arizona (WDIIR), Texas (WDI), Georgia (WIIR), Virginia (nuisance-animal permit records) and Connecticut, not Wisconsin. It states: "Custom Documents does not replace state-approved forms, licensing, or legal advice." — [Pocomos Custom Documents (help center, undated, recent)](https://help.pocomos.com/en/articles/17771127-custom-documents-state-forms-inspections-diagrams-and-signatures) |
| CMP-05 automatic pesticide notices | Partial (generic) | "Automated alerts for new leads, new customers, service reminders, after-service follow-ups..." are included. Custom Documents lists "treatment notices" as a possible use. Nothing pesticide-specific. — [pocomos.com FAQ](https://pocomos.com/faq); [Pocomos Custom Documents](https://help.pocomos.com/en/articles/17771127-custom-documents-state-forms-inspections-diagrams-and-signatures) |
| CMP-06 restricted-use controls | Unknown | A help center search for "EPA" returns "We couldn't find any articles". Neither the help center nor the site mentions RUP. — [help.pocomos.com search: EPA](https://help.pocomos.com/en/?q=EPA) |
| CMP-03 applicator license tracking | Partial | A license number is stored per technician per service type ("Requires License?"). No expiry dates or categories. — [Pocomos: edit technician license number](https://help.pocomos.com/en/articles/743673-how-do-i-edit-my-technician-s-license-number); [help.pocomos.com search: license](https://help.pocomos.com/en/?q=license) |
| CMP-02 catalog with EPA no., label, SDS | Partial | The product list has dilution rates (baseline). No EPA field: an "EPA" search returns no articles. The only SDS mention on the vendor site is a start-up checklist line, "Safety Data Sheets (SDS)", not a product feature. — [help.pocomos.com search: EPA](https://help.pocomos.com/en/?q=EPA); [pocomos.com start a business](https://pocomos.com/start-a-business) |
| SCH-04 license or skill assignment | Partial | Qualified Technicians works by service type, not license. "This will not prevent you from scheduling or adding customers, but it serves as a warning." (May 13, 2024, older) — [Pocomos Qualified Technicians](https://help.pocomos.com/en/articles/8018019-qualified-technicians) |
| ACC-01 built-in GL | No | QuickBooks Online is labeled "Third Party" and does a "One-way sync of customers, invoices, and payments... into QuickBooks Online". — [pocomos.com FAQ](https://pocomos.com/faq); [Pocomos QBO article (baseline)](https://help.pocomos.com/en/articles/14844314-quickbooks-online) |
| ACC-04 deferred revenue | Unknown | Billing modes are "per-service billing, monthly billing, custom installments, or paid-in-full". No revenue recognition. A prepayment marks future invoices paid (baseline). — [pocomos.com FAQ](https://pocomos.com/faq); [Pocomos prepay article](https://help.pocomos.com/en/articles/743672-my-customer-wants-to-prepay-for-multiple-services) |
| BIL-07 prorated refunds and cancellation billing | Unknown | A "prorate" search returns no articles. The cancel-contract article (2018, older) has no content on balances, fees or proration. — [help.pocomos.com search: prorate](https://help.pocomos.com/en/?q=prorate); [Pocomos: cancel a contract](https://help.pocomos.com/en/articles/792121-how-do-i-cancel-a-customer-s-contract) |
| AGR-07 re-service tracking | Partial (baseline said Unknown) | Re-services are added as one-off jobs ("Need to add a re-service... Quick Add Service"), and the Route Map can color them red. No link to the agreement and no cost capture or re-service rate reporting. A "callback" search returns nothing. — [Pocomos: add a one-off service](https://help.pocomos.com/en/articles/1067973-how-do-i-add-a-one-off-service); [help.pocomos.com search: re-service](https://help.pocomos.com/en/?q=re-service); [help.pocomos.com search: callback](https://help.pocomos.com/en/?q=callback) |
| AGR-02 seasonal programs and rounds | Unknown | A "seasonal" search returns no articles. The site lists only frequencies: "daily, weekly, bi-weekly, monthly, bi-monthly, quarterly, annual, other pre-set, or custom". — [help.pocomos.com search: seasonal](https://help.pocomos.com/en/?q=seasonal); [pocomos.com FAQ](https://pocomos.com/faq) |
| AGR-03 price book with tiers and add-ons | Partial | Service types carry default prices (baseline). Dynamic Estimates let a customer "select their preferred package if options are offered" (new). Pricing by property size is not documented. — [pocomos.com Dynamic Estimates](https://pocomos.com/features/dynamic-estimates); [Pocomos Service Types](https://help.pocomos.com/en/articles/1718026-service-types) |
| RPT-02 retention and churn analytics | Partial | Retention is still calculated by hand: run the Delinquent Report, then compare it with the total customer count. The article is dated May 9, 2017 (older) and remains live. The 2021 overview (older) lists only a "Cancellations" report. "Customer growth and churn" appears on the vendor site only as a checklist item in its start-a-business guide, not as a report. — [Pocomos: find my retention rates](https://help.pocomos.com/en/articles/759332-how-do-i-find-my-retention-rates); [Pocomos overview (2021)](https://intercom.help/pocomos/en/articles/2620473-pocomos-overview); [pocomos.com start a business: systems](https://pocomos.com/start-a-business/systems) |

### Inferences
- The PRD's 0-of-8 counts are not overturned by these two products for CMP-02, CMP-03, CMP-05, CMP-06, CMP-08, BIL-07, ACC-01, ACC-04, AGR-03, AGR-07 or RPT-02.
- Briostack's new "Technician licensing and product controls" claim is the item most likely to erode the CMP-03 and CMP-06 wedge. Worth a demo question.
- Briostack's "all 50 states" WDI/WDO claim and CA Department of Agriculture integration contradict the PRD's "Why now" line that the only state reports named are PestPac (CA, AZ, NY) and FieldRoutes (CA WDO). The Wisconsin gap itself still holds.
- Pocomos is moving toward state paperwork through Custom Documents: templates, diagrams, e-signature, locked after signing. Its disclaimer and the state list suggest it is not a compliance engine. Wisconsin landscape registry advance notice and ATCP 29.21 records are a different problem from WDI forms.
- AGR-02 (Briostack Yes, 1 of 8) is the weakest Yes in the PRD table. The vendor documents seasonal spacing templates, not a fixed number of rounds inside a date window, for pest.

### Gaps
- Could not see Briostack's members-only help center or community, so CMP-03, CMP-06 and AGR-07 depth is unverifiable without a demo.
- Could not confirm whether Briostack's "licensing and product controls" blocks assignment or only stores data.
- Could not re-verify the baseline's Briostack "reservice rate report" because the LawnStarter source now returns 404.
- Pocomos Custom Documents has no date and no price; whether it is an add-on could not be verified.

## 2. PRD table-stakes claims

### Takeaway
The table stakes hold for both products: map dispatch, mobile app, field payments, autopay, standard reports and a customer portal. Two qualifications:
- **Reminder and on-the-way texts:** Briostack still documents reminders but not on-the-way texts. Pocomos's on-the-way texts need its paid SMS add-on.
- **Offline mode:** both claim it, neither documents its depth, and both show warning signs (below).

### Cited Findings
- **Briostack SCH-02, dispatch board with map (Yes):** "See jobs in a calendar or map view and filter by branches and techs." The vendor page does not use the words "dispatch board" or "drag and drop". — [Briostack scheduling and routing](https://www.briostack.com/pest-control-software/scheduling-routing-software/)
- **Briostack MOB-01, mobile app (Yes):** Brio Tech v1.4.2, released 2026-10-16, with the release note "Theme and dependency updates". It lets technicians "record product applications, take photos, record notes, collect payments, generate documents". A separate door-to-door app, Brio Sales 2 v2.3.2, was released the same day. — [Brio Tech, App Store](https://apps.apple.com/us/app/brio-tech/id6462748506); [Brio Sales 2, App Store](https://apps.apple.com/us/app/brio-sales-2/id1454271702)
- **Briostack MOB-06, field payments (Yes):** "collect payments" — [Brio Tech, App Store](https://apps.apple.com/us/app/brio-tech/id6462748506)
- **Briostack BIL-02, autopay (Yes):** On completion the platform can "generate the invoice, and, when the customer is set up for AutoPay, process payment." — [Briostack vs Jobber](https://www.briostack.com/comparison/briostack-vs-jobber/)
- **Briostack RPT-01, standard reports (Yes):** revenue forecasts, expected revenue by service, payroll and production reports, and AR. — [Briostack invoicing and accounting](https://www.briostack.com/pest-control-software/invoicing-accounting-software/). Advanced reporting and the API are paid extras per a third-party review (Oct 14, 2026). — [Contractor Software Hub](https://www.contractorsoftwarehub.com/briostack-review/)
- **Briostack CX-02, reminders and on-the-way texts (Partial):** "Send automated text, call and email appointment reminders and notifications". No en-route or on-the-way notice on the scheduling or CRM pages. — [Briostack scheduling and routing](https://www.briostack.com/pest-control-software/scheduling-routing-software/); [Briostack CRM page](https://www.briostack.com/pest-control-software/pest-control-crm-software/)
- **Briostack CX-01, customer portal (Yes):** "Offer a personal and secure portal your customers can log in to, no matter the time of day". Customers view appointment records and billing and pay online. — [Briostack invoicing and accounting](https://www.briostack.com/pest-control-software/invoicing-accounting-software/)
- **Briostack MOB-02, offline mode (Yes, depth undocumented, contradictory):**
  - The scheduling page says tech app tools "function with or without data connectivity". — [Briostack scheduling and routing](https://www.briostack.com/pest-control-software/scheduling-routing-software/)
  - The FieldRoutes comparison table checks "Mobile App offline mode". — [Briostack vs FieldRoutes](https://www.briostack.com/briostack-vs-fieldroutes/)
  - The product FAQ says "all you need is an internet connection". — [Briostack pest control software](https://www.briostack.com/pest-control-software/)
  - A third-party review flags the conflict. — [Contractor Software Hub](https://www.contractorsoftwarehub.com/briostack-review/)
- **Pocomos SCH-02 (Yes):** "View multiple days at once on the calendar and drag jobs between days, routes, or technicians". Route Map. Advanced optimization handles "up to 10 trucks and 1,000 jobs at once", included. — [pocomos.com scheduling](https://pocomos.com/features/scheduling); [pocomos.com route optimization](https://pocomos.com/features/route-optimization)
- **Pocomos MOB-01 (Yes):** Pocomos Tech App v1.8.9, released 2026-10-10. App Store US rating 2.89/5 from 19 ratings. — [Pocomos Tech App, App Store](https://apps.apple.com/us/app/pocomos-tech-app/id1439597267)
- **Pocomos MOB-06 and BIL-02 (Yes):**
  - The app can "take payments, collect signatures, send en route texts". — [pocomos.com mobile app](https://pocomos.com/features/mobile-app)
  - "Card tokens stored on file are used to process future charges automatically", with ACH included. — [pocomos.com integrated payments](https://pocomos.com/features/integrated-payments)
- **Pocomos RPT-01 (Yes):** financial, operational and "Compliance Usage Reports", plus included roll-up reporting across branches. — [pocomos.com customer management](https://pocomos.com/features/customer-management); [pocomos.com FAQ](https://pocomos.com/faq)
- **Pocomos CX-02 (Yes, but texting is a paid add-on):**
  - Automated service reminders are included, by email.
  - "SMS Communications" is labeled "Add-on": "Technicians send en route texts from the mobile app." The SMS add-on "supports two-way conversations, en route messages from the mobile app, and scheduled or bulk texts."
  - — [pocomos.com SMS communications](https://pocomos.com/features/sms-communications); [pocomos.com FAQ](https://pocomos.com/faq)
- **Pocomos CX-01, customer portal (Partial):** "view invoices, make payments, see upcoming services, and update payment information". No service requests or self-booking. — [pocomos.com FAQ](https://pocomos.com/faq); [pocomos.com customer portal](https://pocomos.com/features/customer-portal)
- **Pocomos MOB-02, offline mode (Yes, shallow documentation):**
  - The only help center description is "Mobile apps for technicians provide offline capabilities for areas with poor connections" and "Offline functionality with subsequent sync" (May 21, 2021, older). — [Pocomos overview](https://intercom.help/pocomos/en/articles/2620473-pocomos-overview)
  - The October 2026 app release notes include "Jobs completed offline now sync properly". — [Pocomos Tech App, App Store](https://apps.apple.com/us/app/pocomos-tech-app/id1439597267)

### Inferences
- For the PRD's CX-02 count (5 of 8), Pocomos counts as Yes only if SMS is bought. The PRD could fairly treat its on-the-way texts as Add-on.
- The PRD's offline argument (competitors' weak offline modes) is supported in spirit for both. Briostack contradicts itself about connectivity. Pocomos shipped an offline sync fix in October 2026. Neither documents what works offline: route, records, photos or payments.
- Pocomos's portal remains Partial, and Briostack's portal is broader (payments, records, notification preferences, proposals per the baseline).

### Gaps
- Offline depth for both (which screens, how photos sync, conflict handling) could not be verified from public pages.
- Google Play ratings for either app were not checked.

## 3. Current pricing (2025 and 2026)

### Takeaway
- **Pocomos:** the PRD's figures ($59 to $225) are out of date. Pocomos now publishes prices on its own site: $109 (0 to 20 active customers) to $275 (301 to 500), then $275 plus $0.16 per customer over 500, month-to-month, no per-user charge. SMS, GPS, time tracking and card updating cost extra.
- **Briostack:** still publishes no subscription price. The PRD's $95 per office user and $45 per technician cannot be re-verified because its source now returns 404. Briostack now describes concurrent-user licensing ("active users rather than total seats"). It publishes a detailed schedule of add-on fees, and its Terms (updated Oct 9, 2025) impose a 1-year auto-renewing term with an early-termination fee.

### Cited Findings

**Pocomos (vendor site, read 2026-10-29)**

| Plan | Active customers | Monthly |
| --- | --- | --- |
| Starter | 0 to 20 | $109 |
| Growing | 21 to 50 | $159 |
| Professional | 51 to 300 | $239 |
| Business | 301 to 500 | $275 |
| Enterprise | 501+ | "$275 + $0.16 per customer over 500" |

Source: [pocomos.com pricing](https://pocomos.com/pricing). The FAQ says "Plans start at $109 per month for 0 to 20 active customers." — [pocomos.com FAQ](https://pocomos.com/faq)

- **Billable base:** "You are only charged for active and on-hold customers. Inactive customers, one-time completed jobs, leads, and users do not count toward your customer total." The cost calculator lists "No per-user charge". — [pocomos.com pricing](https://pocomos.com/pricing)
- **Phrasing conflict:** another page phrases the 501+ rate as "$275 plus $0.16 per active customer each month". — [pocomos.com](https://pocomos.com/)
- **Contract:** "Pocomos is month-to-month, so you can cancel at any time." Setup: "Most new accounts can be set up the same day". No setup fee appears anywhere in the site text. — [pocomos.com FAQ](https://pocomos.com/faq)
- **SMS:** "$4 monthly platform fee plus $0.04 per text" (in or out), described as "$4 per location / month". — [pocomos.com SMS communications](https://pocomos.com/features/sms-communications)
- **Other add-ons (prices not on the site):** "Add-on" labels on Find My Tech (GPS), Time Tracking and the Credit Card Auto Updater.
  - The baseline help center figure for Find My Tech is $9 to $19 per tech per month. — [Pocomos Find My Tech (help center)](https://help.pocomos.com/en/articles/8269317-find-my-tech); [pocomos.com Find My Tech](https://pocomos.com/features/find-my-tech)
  - A Pocomos marketplace page prices the account updater per location (search snippet only). — [pocomosmarketplace account updater](https://pocomosmarketplace.manus.space/account-updater)
- **Lead generation (new pay-per-call add-on):** "You only pay $150 when a call lasts 90 seconds or more. No shared leads, no monthly fees, no contracts." — [pocomos.com lead generation](https://pocomos.com/features/lead-generation)
- **Payment processing (integrated Zift), with conflicting rates on the vendor's own site:**
  - The FAQ says "Zift uses cost-plus pricing, which means interchange plus 1.0 percent". — [pocomos.com FAQ](https://pocomos.com/faq)
  - The FieldRoutes comparison table on the home page says "2.9% + $0.30 per transaction". — [pocomos.com home page](https://pocomos.com/)
  - The site does not say outright that Zift is required. The baseline cites reviewers calling the required processor costly.
- **Third-party figures that conflict with the vendor:**
  - FrontDeskReview ("Updated September 2026") lists $99, $159, $209 and $275, with the Growth tier marked "STALE". — [FrontDeskReview](https://frontdeskreview.com/software/pest-control-software/pocomos/)
  - ITQlick lists $59 to $225 (search snippet). — [ITQlick](https://www.itqlick.com/pocomos-software/pricing)
  - Capterra lists "$85 per feature per month" (search snippet). — [Capterra Pocomos](https://www.capterra.com/p/133292/Pocomos/)
  - The PRD's $59 to $225 came from G2, which returned 403 on 2026-10-29. — [G2 Pocomos pricing](https://g2.com/products/pocomos/pricing)

**Briostack**
- **No published subscription price:**
  - "Custom pricing, concurrent licensing by active users". — [Briostack vs GorillaDesk](https://www.briostack.com/comparison/briostack-vs-gorilladesk/)
  - "Customized pricing based on business needs, with concurrent licensing based on active users rather than total seats". — [Briostack vs Jobber](https://www.briostack.com/comparison/briostack-vs-jobber/)
  - "Transparent, user-based pricing" with core features "included at a flat, user-based rate". — [Briostack vs FieldRoutes](https://www.briostack.com/briostack-vs-fieldroutes/)
  - The vendor's own "best pest control software" post (May 21, 2026, updated Oct 19, 2026) lists Briostack's price as "Custom". — [Briostack blog](https://www.briostack.com/blog/best-pest-control-software/)
- **Terms (updated October 9, 2025):** — [Briostack Terms](https://www.briostack.com/terms/)
  - "A user license is required for each person simultaneously utilizing Customer's master account."
  - Initial term "one year starting from the Service's Go-Live Date", where go-live is the first appointment marked serviced.
  - Auto-renews for equal terms; 30 days' written notice to end.
  - Early-termination fee = monthly fees x remaining months.
  - Fees are "non-refundable"; fee changes allowed "any time after the first year".
  - "Up to 20GB of total storage per user license".
  - No named processor requirement.
  - No data-export right: after termination the company "may deactivate... and delete any data".
- **Published add-on fee schedule:** — [Briostack additional pricing (© 2026; sitemap lastmod 2026-07-20)](https://www.briostack.com/additionalpricing/)
  - **Messaging:** SMS $.04 per text; calls $.04 per minute; "10DLC Regulatory fee – $11"; $1 monthly per claimed phone number; "Notification Minimum Bundle – $5".
  - **Postal mail:** black and white from $.98 for the first sheet; color $1.30.
  - **Migration:** non-standard data manipulation $150 per occurrence; database consolidation $900; Sentricon migration $500; post-live data manipulation $300; additional imports $250.
  - **Custom documents and engineering:** custom document conversion $150 per document; new documents $150 per hour; custom engineering $150 per hour.
  - **Data services:** database backup $500; restoration of a previous version $750; storage above 20GB per user license $1 per 2GB; "Extracted Credit Card Data – $.25 per Card On File".
- **Add-on products (prices not published):**
  - Growth Bundle = Brio Insights dashboards + Marketing Playbooks, with an optional Designer License. — [Briostack Growth Bundle](https://www.briostack.com/growth-bundle/)
  - ZyraTalk AI receptionist. — [Briostack + ZyraTalk](https://www.briostack.com/briostack-zyratalk/)
  - A third-party review says API access, advanced reporting and Playbooks cost extra and routing is included. — [Contractor Software Hub (Oct 14, 2026)](https://www.contractorsoftwarehub.com/briostack-review/)
- **Third-party price points:**
  - Capterra lists a $50 per month starting price (search snippet). — [Capterra Briostack](https://www.capterra.com/p/160267/Briostack/)
  - A Sept 1, 2026 roundup cites SelectHub $19 per month, Capterra $50 and "US Tech Automations" $400 to $600 for 15 to 30 technicians (all secondhand). — [Solea](https://www.solea.ai/blog/briostack-alternatives)
- **The PRD's $95 per office user and $45 per technician:** these came from a LawnStarter demo write-up that now returns 404. They could not be re-verified. — [LawnStarter (404)](https://lawnstarter.com/blog/?p=52157)

### Inferences
- **Pocomos math (from the published formula):** an 8-technician residential company with about 1,000 to 2,000 active recurring customers would pay about $355 to $515 a month before SMS, GPS and processing. That is below Bugsy's $632 to $792 hypothesis for 8 technicians. The customer count per technician is an assumption, not sourced.
- **Positioning risk:** Pocomos now publishes its prices, runs month-to-month and charges nothing per user. That weakens the PRD's claim that published pricing answers the category's most common complaint, at least against Pocomos. Bugsy's remaining pricing distinction against Pocomos is "all-inclusive": SMS and GPS included, and compliance and GL value.
- **The "per-customer pricing swings with the season" complaint still applies:** Pocomos bills "active and on-hold customers", so winter holds still count.
- **Briostack's concurrent licensing** blunts the PRD's "per-seat pricing climbs fast" critique on paper. Its Terms (1-year auto-renew, early-termination fee, non-refundable, deletion after termination) and its long add-on fee list support the PRD's "add-on fees" and lock-in narrative. That makes Bugsy's tenant data export and no-setup-fee stance concrete differentiators.

### Gaps
- Briostack's current per-license price, and whether office and technician licenses are priced differently, could not be verified. A demo or quote is needed.
- Pocomos's prices for Find My Tech, Time Tracking and the Card Updater are not on the 2026 site. The help center figure ($9 to $19 per tech) is from the baseline and was not re-fetched.
- Whether Pocomos requires Zift could not be confirmed from vendor text.
- No source documents the date Pocomos moved from the $59 entry price to $109.

## 4. Product, ownership and funding changes in 2025 and 2026

### Takeaway
- **Briostack:** remains part of EverCommerce (Nasdaq: EVCM, controlled by PSG and Silver Lake). EverCommerce bought ZyraTalk (an AI agent platform) in September 2025, sold its marketing-technology unit in October 2025, and changed CEO in August 2026. Briostack itself now advertises AI previews, AI dashboards, an AI receptionist, all-50-state WDI/WDO forms and a California Department of Agriculture integration.
- **Pocomos:** still independent and bootstrapped. It relaunched its website with published pricing and a FieldRoutes switching page, and added a pay-per-call lead service, Custom Documents for state forms, and canvassing (knock tracking). It has no AI product features.

### Cited Findings
**Briostack and EverCommerce**
- **ZyraTalk acquisition:** EverCommerce acquired ZyraTalk on September 15, 2025. ZyraTalk captures leads, books appointments and "acts as an autonomous agent across key workflows such as scheduling, dispatch, invoicing, payment". Its "intended near-term application" is EverPro's "350,000+ home and field service providers". Briostack is not named. — [EverCommerce press release](https://www.evercommerce.com/news/evercommerce-acquires-ai-agentic-platform-company-zyratalk/)
- **ZyraTalk at Briostack:** Briostack markets ZyraTalk as an AI receptionist that "works alongside Briostack" (page lastmod 2026-09-30). Pricing, launch date and native booking are not stated. — [Briostack + ZyraTalk](https://www.briostack.com/briostack-zyratalk/); [Briostack sitemap](https://www.briostack.com/page-sitemap.xml)
- **Briostack AI roadmap (vendor, lastmod 2026-10-21):** "AI Note Refiner and Pest Identifier (Preview)", "AI Brio Assistant in development", and "AI-supported interactive business dashboards and custom reports". — [Briostack vs Jobber](https://www.briostack.com/comparison/briostack-vs-jobber/)
- **New compliance claims (vendor, lastmod 2026-10-08):** "Built-in, state-specific WDI/WDO forms (all 50 states)", "direct CA Dept. of Agriculture integration", "Sentricon integration" and "Technician licensing and product controls". — [Briostack vs GorillaDesk](https://www.briostack.com/comparison/briostack-vs-gorilladesk/)
- **Growth Bundle:** Brio Insights (role-based dashboards for "trends, performance, overdue balances, cancellations, and upsell opportunities") plus Marketing Playbooks (win-backs, renewals, collections). — [Briostack Growth Bundle](https://www.briostack.com/growth-bundle/)
- **Door-to-door sales:** Brio Sales 2 lets reps work leads on a map, assign sales areas and submit agreements electronically. Updated 2026-10-16. — [Brio Sales 2, App Store](https://apps.apple.com/us/app/brio-sales-2/id1454271702)
- **New positioning content (lastmod 2026-10-01):** an e-book, "The Hidden Operational Tax of Pest Control Software", positions Briostack as "residential-first" against PestPac. — [Briostack hidden operational tax](https://www.briostack.com/hidden-operational-tax/)
- **Events:**
  - Briostack User Conference, February 11 to 12, 2026, Atlanta. — [Briostack 2026 user conference](https://www.briostack.com/events/2026-user-conference/)
  - PestWorld 2025 (Orlando, booth #1123) and PestWorld 2026 (Grapevine, TX, Oct 20 to 23). — [Briostack events](https://www.briostack.com/events/)
- **EverCommerce leadership and results:** August 5, 2026 Q2 results: revenue $152.0M (+2.7%), adjusted EBITDA $44.5M, full year expected "toward the lower end" of guidance. Eric Remer hands over to "Alex as CEO". The company calls itself "an AI platform for the service economy". The release does not discuss EverPro results. — [EverCommerce Q2 2026 release via Finviz](https://finviz.com/news/377887/evercommerce-announces-second-quarter-2026-financial-results)
- **Divestiture:** EverCommerce sold its Marketing Technology Solutions business (EverConnect) to Ignite Visibility on October 31, 2025, for about $45.0M, to focus on "AI-powered vertical software" (FY2025 10-K, search snippet). — [EverCommerce 10-K FY2025](https://www.sec.gov/Archives/edgar/data/1853145/000185314526000010/evcm-20251231.htm)
- **No current sale process found:** the only report of EverCommerce exploring a sale is a Reuters exclusive dated April 21, 2023 (older), which reported PSG at 45% and Silver Lake at 35%. No 2025 or 2026 take-private was found. — [Reuters via WHBL (2023)](https://whbl.com/?p=534642)

**Pocomos**
- **Ownership:** no acquisition or outside funding found. GetLatka estimates 2025 revenue of $880K, with no outside funding (estimate, search snippet). Dealroom lists "No known external funding" (search snippet). — [GetLatka](https://getlatka.com/companies/pocomos.net); [Dealroom](https://app.dealroom.co/companies/pocomos)
- **New website:** published pricing, a cost calculator, a FieldRoutes comparison page and a "Start a business" guide for new operators. The site's code references Manus hosting. — [pocomos.com pricing](https://pocomos.com/pricing); [pocomos.com vs FieldRoutes](https://pocomos.com/vs-fieldroutes); [pocomos.com start a business](https://pocomos.com/start-a-business)
- **FieldRoutes comparison:** targets FieldRoutes users with vendor claims about FieldRoutes that were not verified here: "$0.18 per optimized route", "1 to 3 year lock-in" and "~3.4% + $0.30 (reported)" processing. These appear in the FieldRoutes comparison on the home page and the vs-FieldRoutes route. — [pocomos.com home page](https://pocomos.com/); [pocomos.com vs FieldRoutes](https://pocomos.com/vs-fieldroutes)
- **New or newly documented features:**
  - **Lead Generation:** pay-per-call. — [pocomos.com lead generation](https://pocomos.com/features/lead-generation)
  - **Credit Card Auto Updater:** add-on. — [pocomos.com credit card updater](https://pocomos.com/features/credit-card-updater)
  - **Mirroring:** settings shared from a franchise HQ to branches. — [pocomos.com mirroring](https://pocomos.com/features/mirroring)
  - **Canvassing:** "Reps mark each door as Not Home, Not Interested, Do Not Knock, Go Back, or New Customer", which closes the baseline's CRM-05 knock-tracking gap. — [pocomos.com door to door](https://pocomos.com/features/door-to-door)
  - **Custom Documents:** state forms, diagrams and e-signature. — [Pocomos Custom Documents](https://help.pocomos.com/en/articles/17771127-custom-documents-state-forms-inspections-diagrams-and-signatures)
  - **WDO and WDI forms:** "Pocomos can support WDO, WDI, inspection, service, and other custom forms". — [pocomos.com FAQ](https://pocomos.com/faq)
- **App release 1.8.9 (2026-10-10):** PDF invoices from service history, devices grouped by area, "Jobs completed offline now sync properly". — [Pocomos Tech App, App Store](https://apps.apple.com/us/app/pocomos-tech-app/id1439597267)
- **AI:** no AI product features. The site's start-up guide only advises operators to install AI chat and "Voice AI" from other vendors. — [pocomos.com start a business: systems](https://pocomos.com/start-a-business/systems)
- **Help center release notes:** a "What's new" search shows nothing newer than "What's New (April 2024)" (older). — [help.pocomos.com search: what's new](https://help.pocomos.com/en/?q=what%27s%20new)

### Inferences
- **Briostack:** EverCommerce's AI push (ZyraTalk, "AI platform for the service economy") is reaching Briostack mainly as AI answering and note and pest-ID previews, not compliance automation. AI was listed as a Phase 1 non-goal in the PRD; that stays defensible, but expect AI receptionist demos in Briostack sales cycles.
- **Pocomos:** is clearly courting FieldRoutes and ServSuite switchers. This overlaps with the PRD's "forced migration is a buying moment" thesis: Pocomos will compete for the same ServSuite migrations, on price and month-to-month terms.
- **Door-to-door:** both products are strong at it (Brio Sales 2; Pocomos canvassing, recruiting and video training, all included). The PRD's choice to leave the door-to-door app out of Phase 1 cedes that segment, which is consistent with the first-tenant profile.

### Gaps
- No date was found for Briostack's AI previews or the all-50-state WDI/WDO launch.
- EverPro segment performance and the cited "EverPro slowdown" headline were not read.
- Whether EverCommerce plans to fold Briostack into another EverPro product could not be determined.

## 5. Review sentiment in 2025 and 2026

### Takeaway
- **Briostack:** 2025 and 2026 sentiment is mixed to negative on stability, billing surprises and contracts. Praise centers on onboarding and some support staff.
- **Pocomos:** stays well rated for ease of use and fast support. Complaints center on thin reporting, a weak mobile app (2.9/5 on the App Store) and per-customer cost.
- **Coverage limits:** major review sites blocked direct reading, and Reddit r/pestcontrol threads on either product were not found.

### Cited Findings
**Briostack**
- **Capterra ratings (search snippets):** about 4.1/5 from 69 reviews (78% positive, 4% neutral, 17% negative). Capterra Canada shows 4.0 from 71. Some positive reviews are labeled "Vendor Referred - Incentive Offered". — [Capterra Briostack](https://www.capterra.com/p/160267/Briostack/); [Capterra Briostack reviews](https://www.capterra.com/p/160267/Briostack/reviews/)
- **G2:** 2.3/5 from 8 reviews (via a third-party review and search snippet). — [Contractor Software Hub](https://www.contractorsoftwarehub.com/briostack-review/)
- **Trustpilot:** TrustScore 2.6, 4 reviews, all 1-star, 3 in the last 12 months. — [Trustpilot Briostack](https://www.trustpilot.com/review/briostack.com)
  - Feb 18, 2026: "The platform is frequently glitchy". "Several features that were presented as included during signup later appeared as additional charges". SMS price increases from segment billing. Slow support, unclear documentation.
  - May 8 and Sep 3, 2026: near-identical texts under similar names, likely one reviewer. Promised free months were still billed; pushed toward "legal options" to exit.
- **Capterra Chile (March 2026):** a review reports "constant glitches" (search snippet only). — [Capterra Chile Briostack](https://www.capterra.cl/software/160267/briostack)
- **Third-party synthesis (Oct 14, 2026):**
  - Praise: communication history, stored documents, migration support, helpful staff.
  - Complaints: glitches and update instability, extra-cost features, rising SMS charges, a promotional billing dispute, and a $26 collections notice after cancellation.
  - "Buyer Confidence Score" 4/10.
  - Brio Tech App Store: 2.0 from 5 ratings (storefront not stated).
  - — [Contractor Software Hub](https://www.contractorsoftwarehub.com/briostack-review/)
- **App Store (US):** shows 0 ratings for Brio Tech on 2026-10-29. — [Brio Tech, App Store](https://apps.apple.com/us/app/brio-tech/id6462748506)

**Pocomos**
- **Capterra ratings:** 4.5/5 from 35 reviews (search snippets). One reviewer disliked "pricing scales with customer count, which made budgeting harder for firms with high customer turnover". Capterra UK shows 86% positive. — [Capterra Pocomos](https://www.capterra.com/p/133292/Pocomos/); [Capterra UK Pocomos](https://www.capterra.co.uk/software/133292/pocomos)
- **Recurring themes (search snippets; review dates not confirmed as 2025 or 2026):**
  - Praise: ease of use, quick support, "specifically designed for pest control".
  - Complaints: reporting "lacking in many areas"; "mobile app could be improved"; requests for automatic calling and customer self-scheduling; updates "can cause a glitch or issue during the workday"; cost for small operators.
  - — [G2 Pocomos reviews](https://www.g2.com/products/pocomos/reviews); [Software Advice Pocomos reviews](https://www.softwareadvice.com/field-service/pocomos-profile/reviews/)
- **App Store:** Pocomos Tech App 2.89/5 from 19 US ratings (2026-10-29). — [Pocomos Tech App, App Store](https://apps.apple.com/us/app/pocomos-tech-app/id1439597267)
- **Support claim:** Pocomos says it "averages a reply in under 10 minutes" (vendor claim). — [pocomos.com FAQ](https://pocomos.com/faq)
- **Reddit:** a search for r/pestcontrol threads on Briostack or Pocomos returned none. Only comparison aggregators came back. — [Slashdot Briostack vs Pocomos](https://slashdot.org/software/comparison/Briostack-vs-Pocomos)

### Inferences
- Briostack's 2026 complaints (surprise add-on charges, SMS segment billing, contract exit disputes) map directly onto the PRD's "add-on fees" pain point and Bugsy's all-inclusive, no-setup-fee pricing.
- Pocomos's weak spots (reporting depth, manual retention, the app) map onto Bugsy's planned spec 12 (reporting) and the offline technician app.

### Gaps
- Full 2025 and 2026 review text on Capterra, G2, GetApp and Software Advice could not be read (HTTP 403). Ratings and quotes are from snippets, and review dates for the Pocomos themes are unconfirmed.
- No Reddit discussion found.
- Pocomos's G2 rating was not found.

## 6. Evidence of Wisconsin or Midwest customers

### Takeaway
No public evidence was found of Wisconsin customers for either product. The only Midwest signal is Briostack exhibiting at the Missouri Pest Management Association conference in December 2026.

### Cited Findings
- **Briostack case studies:** Armor, Guardian Pest & Lawn, Alganix and Vinx. None states a location. — [Briostack case studies](https://www.briostack.com/case-studies/)
- **Briostack events:** the only Midwest listing is the MPMA Annual Conference, Jefferson City, MO, Dec 3 to 4 (2026). No Wisconsin events. — [Briostack events](https://www.briostack.com/events/)
- **Briostack metrics one-sheet:** no customer or location named. — [Briostack metrics snapshot](https://www.briostack.com/metrics-snapshot)
- **Pocomos:** no Wisconsin or Midwest customers found. The only named customer location on its site is a lead-generation example "in San Antonio". Custom Documents state examples are AZ, TX, GA, VA and CT. — [pocomos.com lead generation](https://pocomos.com/features/lead-generation); [Pocomos Custom Documents](https://help.pocomos.com/en/articles/17771127-custom-documents-state-forms-inspections-diagrams-and-signatures)
- **Wisconsin mentions:** none in Briostack's vendor pages or in the Pocomos site and help center searches run. — [Briostack vs GorillaDesk](https://www.briostack.com/comparison/briostack-vs-gorilladesk/); [help.pocomos.com search: pesticide](https://help.pocomos.com/en/?q=pesticide)

### Inferences
- Both vendors are Utah-based and market heavily in the South and Sun Belt (TX, GA, the Carolinas, FL events; AZ, TX and GA forms). A Wisconsin-first product does not face a locally entrenched Briostack or Pocomos base, as far as public evidence shows.

### Gaps
- Customer lists are not public, so absence of evidence is not evidence of absence. Asking Wisconsin pilot interviewees what they run is the only way to confirm.

## 7. PRD claim verdicts by product

### Takeaway
- **Wedge claims:** confirmed for both products. The one weak spot is Briostack's AGR-02 Yes.
- **"Why now" state-report claim:** partly contradicted by Briostack's new 50-state WDI/WDO and CA Department of Agriculture claims.
- **Pocomos pricing row:** contradicted (now $109 to $275 plus $0.16 per customer over 500).
- **Briostack pricing row:** could not be verified (source 404; vendor now sells concurrent licenses).

### Cited Findings

#### Briostack

| PRD claim | Verdict | Evidence URL |
| --- | --- | --- |
| No full Wisconsin compliance (CMP-08) | Confirmed | https://www.briostack.com/comparison/briostack-vs-gorilladesk/ |
| No automatic pesticide notices (CMP-05) | Confirmed (generic completion notifications only) | https://www.briostack.com/comparison/briostack-vs-jobber/ |
| No restricted-use controls (CMP-06) | Confirmed, with a caveat: "Technician licensing and product controls" claimed without detail | https://www.briostack.com/comparison/briostack-vs-gorilladesk/ |
| No applicator license tracking (CMP-03) | Partly (new undocumented "licensing" claim) | https://www.briostack.com/comparison/briostack-vs-gorilladesk/ |
| No catalog with EPA no., label, SDS (CMP-02) | Confirmed | https://www.briostack.com/comparison/briostack-vs-jobber/ |
| License-based assignment not full (SCH-04; 2 of 8 overall) | Confirmed for Briostack (Partial) | https://www.briostack.com/pest-control-software/scheduling-routing-software/ |
| No built-in GL (ACC-01) | Confirmed | https://www.briostack.com/pest-control-software/invoicing-accounting-software/ |
| No deferred revenue (ACC-04) | Confirmed (Unknown; prepay campaigns only) | https://www.briostack.com/pest-control-software/invoicing-accounting-software/ |
| No cancellation billing (BIL-07) | Confirmed (Unknown) | https://www.briostack.com/pest-control-software/invoicing-accounting-software/ |
| No re-service tracking (AGR-07) | Could not verify (baseline source 404) | https://lawnstarter.com/blog/?p=52157 |
| Seasonal programs: Briostack is the 1 of 8 (AGR-02) | Partly (seasonal spacing templates; "rounds" not explicit for pest) | https://www.briostack.com/pest-control-software/scheduling-routing-software/ |
| No tiered price book with add-ons (AGR-03) | Confirmed (Partial; "service bundles" newly claimed) | https://www.briostack.com/comparison/briostack-vs-jobber/ |
| No retention analytics (RPT-02) | Confirmed (Partial: attrition rate, Brio Insights) | https://www.briostack.com/pest-control-software/pest-control-crm-software/ |
| Map dispatch board (SCH-02) | Confirmed | https://www.briostack.com/pest-control-software/scheduling-routing-software/ |
| Mobile app (MOB-01) | Confirmed | https://apps.apple.com/us/app/brio-tech/id6462748506 |
| Field payments (MOB-06) | Confirmed | https://apps.apple.com/us/app/brio-tech/id6462748506 |
| Autopay (BIL-02) | Confirmed | https://www.briostack.com/comparison/briostack-vs-jobber/ |
| Standard reports (RPT-01) | Confirmed | https://www.briostack.com/pest-control-software/invoicing-accounting-software/ |
| Reminder and on-the-way texts (CX-02) | Partly (reminders yes, on-the-way not documented) | https://www.briostack.com/pest-control-software/scheduling-routing-software/ |
| Customer portal (CX-01) | Confirmed | https://www.briostack.com/pest-control-software/invoicing-accounting-software/ |
| Competitors' offline is weak (problem table) | Partly (claimed offline, self-contradictory, depth undocumented) | https://www.briostack.com/pest-control-software/ |
| Pricing: about $95 per office user, $45 per technician | Could not verify (source 404; vendor says concurrent licensing, custom quotes) | https://www.briostack.com/comparison/briostack-vs-jobber/ |
| "Per-seat pricing climbs fast" complaint | Partly (vendor now pitches concurrent licenses; reviews cite surprise add-on charges) | https://www.trustpilot.com/review/briostack.com |
| Add-on fees for SMS etc. (Why now) | Confirmed (SMS $.04, calls $.04 per minute, 10DLC $11, migration and backup fees) | https://www.briostack.com/additionalpricing/ |
| Only CA, AZ, NY (PestPac) and CA WDO (FieldRoutes) state reports exist (Why now) | Contradicted for Briostack (claims WDI/WDO forms for all 50 states and CA Dept. of Agriculture integration; still no Wisconsin) | https://www.briostack.com/comparison/briostack-vs-gorilladesk/ |
| No Wisconsin support shown | Confirmed | https://www.briostack.com/events/ |
| Owner is EverCommerce (baseline) | Confirmed; CEO change Aug 2026; ZyraTalk bought Sep 2025 | https://finviz.com/news/377887/evercommerce-announces-second-quarter-2026-financial-results |

#### Pocomos

| PRD claim | Verdict | Evidence URL |
| --- | --- | --- |
| No full Wisconsin compliance (CMP-08) | Confirmed | https://help.pocomos.com/en/articles/17771127-custom-documents-state-forms-inspections-diagrams-and-signatures |
| No automatic pesticide notices (CMP-05) | Confirmed (Partial, generic automated messages) | https://pocomos.com/faq |
| No restricted-use controls (CMP-06) | Confirmed | https://help.pocomos.com/en/?q=EPA |
| No applicator license tracking (CMP-03) | Confirmed (Partial: license number per tech per service type, no expiry) | https://help.pocomos.com/en/articles/743673-how-do-i-edit-my-technician-s-license-number |
| No catalog with EPA no., label, SDS (CMP-02) | Confirmed | https://help.pocomos.com/en/?q=EPA |
| License-based assignment not full (SCH-04) | Confirmed (Partial; warning only, by service type) | https://help.pocomos.com/en/articles/8018019-qualified-technicians |
| No built-in GL (ACC-01) | Confirmed | https://pocomos.com/faq |
| No deferred revenue (ACC-04) | Confirmed (Unknown) | https://pocomos.com/faq |
| No cancellation billing (BIL-07) | Confirmed (Unknown; no proration content) | https://help.pocomos.com/en/?q=prorate |
| No re-service tracking (AGR-07) | Confirmed (Partial: re-services as one-off jobs, no cost capture) | https://help.pocomos.com/en/articles/1067973-how-do-i-add-a-one-off-service |
| No seasonal programs (AGR-02) | Confirmed (Unknown) | https://help.pocomos.com/en/?q=seasonal |
| No tiered price book with add-ons (AGR-03) | Confirmed (Partial; estimate packages exist) | https://pocomos.com/features/dynamic-estimates |
| Retention calculated manually (RPT-02) | Confirmed (2017 article still live; no retention report) | https://help.pocomos.com/en/articles/759332-how-do-i-find-my-retention-rates |
| Map dispatch board (SCH-02) | Confirmed | https://pocomos.com/features/scheduling |
| Mobile app (MOB-01) | Confirmed (2.89/5 App Store) | https://apps.apple.com/us/app/pocomos-tech-app/id1439597267 |
| Field payments (MOB-06) | Confirmed | https://pocomos.com/features/mobile-app |
| Autopay (BIL-02) | Confirmed | https://pocomos.com/features/integrated-payments |
| Standard reports (RPT-01) | Confirmed | https://pocomos.com/faq |
| Reminder and on-the-way texts (CX-02) | Partly (email reminders included; on-the-way texts need the paid SMS add-on) | https://pocomos.com/features/sms-communications |
| Customer portal (CX-01) | Partly (pay, invoices, upcoming services; no requests or booking) | https://pocomos.com/faq |
| Competitors' offline is weak (problem table) | Partly (offline claimed in 2021 docs; Oct 2026 fix "Jobs completed offline now sync properly") | https://apps.apple.com/us/app/pocomos-tech-app/id1439597267 |
| Pricing: $59 (up to 20) to $225 (300 to 500) | Contradicted (vendor now $109 / $159 / $239 / $275, then $275 + $0.16 per customer over 500) | https://pocomos.com/pricing |
| Active recurring customers, unlimited users | Confirmed ("active and on-hold customers"; users not counted) | https://pocomos.com/pricing |
| "Per-customer pricing swings with the season" complaint | Confirmed (reviewer complaint; on-hold customers billed) | https://www.capterra.com/p/133292/Pocomos/ |
| Add-on fees for SMS and GPS (Why now) | Confirmed (SMS $4 per location + $0.04 per text; Find My Tech, Time Tracking, Card Updater are add-ons) | https://pocomos.com/features/sms-communications |
| Opaque pricing (Why now) | Contradicted for Pocomos (prices published, month-to-month) | https://pocomos.com/faq |
| No Wisconsin support shown | Confirmed | https://help.pocomos.com/en/?q=pesticide |
| Independent, privately held (baseline) | Confirmed (no acquisition or funding found) | https://getlatka.com/companies/pocomos.net |

### Inferences
- **PRD edits suggested by this evidence:**
  1. Update the Pocomos price row to $109 to $275 plus $0.16 per customer over 500, sourced to pocomos.com.
  2. Mark the Briostack price row as unverified, and note concurrent licensing plus the published add-on fee schedule.
  3. Soften the "Why now" state-reports line, since Briostack now claims all-50-state WDI/WDO forms and a CA Department of Agriculture integration.
  4. Count Pocomos CX-02 on-the-way texts as Add-on, not Yes.
  5. Reconsider whether "published pricing" is still a differentiator against Pocomos.

### Gaps
- Every Unknown above is "not found in public sources", not proven absent.
- Briostack's members-only help content and a live demo would settle CMP-03, CMP-06, AGR-07 and offline depth.
