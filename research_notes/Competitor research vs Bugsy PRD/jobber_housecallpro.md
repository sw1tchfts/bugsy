# Jobber and Housecall Pro vs the Bugsy PRD (pest control lens, as of October 29, 2026)

Scope and method: vendor pages were fetched on 2026-10-29 unless a different date is given. "Baseline" means the 2026-10-20 profiles in `docs/competitors/jobber.json` and `docs/competitors/housecall-pro.json`. Where I relied on a baseline source without re-fetching it, the finding says "baseline, not re-fetched". Statuses use `docs/competitors/feature-taxonomy.json` (Yes, Partial, Add-on, No, Unknown). Anything dated before 2025 is labeled OLDER. Several pages returned HTTP 403 to my fetcher: productupdates.getjobber.com, Capterra compare pages and GlobeNewswire. For those I could see only the search-result title or summary, and the finding says so.

## 1. PRD wedge claims, feature by feature: does either product fully support them?

### Takeaway
Neither product has full ("Yes") support for any of the 14 wedge features checked. That confirms the PRD's wedge table for these two products. Jobber is the stronger of the two on pest compliance. It has a basic chemical application log with EPA registration numbers, target pests, applicator license numbers, weather and CSV export, but the vendor's own help article says that log is web only, not in the mobile app. Housecall Pro has no chemical log at all, and its "fix" is a printable paper log template. Both sell a human-run bookkeeping service rather than a documented double-entry ledger, and neither documents deferred revenue, proration on cancellation, re-service tracking or license-based dispatch.

### Cited Findings

**Jobber: compliance (CMP) and the mobile chemical log**
- Jobber's help article says chemical tracking is "available on select plans". It names no plan. — [Jobber help: Chemical tracking](https://help.getjobber.com/en/articles/chemical-tracking/)
- The same article says "There is no chemical tracking in the mobile app" and "Chemicals must be recorded from jobber.com". The article was last updated April 10, 2024 (OLDER). It is still the live vendor article, and I found no newer vendor page that says chemical capture moved into the app. — [Jobber help: Chemical tracking](https://help.getjobber.com/en/articles/chemical-tracking/)
- The treatment form has these sections: service address; job, applicator and date and time; "Chemical name and concentration"; application details; weather; other information. The help article does not mention EPA registration number, rate, amount, area or target pest. Applicator license numbers are entered separately under Work Settings, "Employee/Applicator License Numbers". There are no license categories, expiry dates or alerts. — [Jobber help: Chemical tracking](https://help.getjobber.com/en/articles/chemical-tracking/)
- The feature page says the form records chemicals and pesticides used, "their registration numbers", and the pests targeted. History can be downloaded and sorted "by date, client, or applicator". It does not mention labels, SDS, state compliance, any US state or regulator, or customer notifications. — [Jobber chemical tracking feature page](https://www.getjobber.com/features/chemical-tracking/)
- Jobber's pest control page describes no compliance feature and names no state. — [Jobber pest control page](https://www.getjobber.com/industries/pest-control-software/)
- The Jobber pricing page (dateModified 2026-09-23) does not list chemical tracking under any plan. Which plans include it remains unknown. — [Jobber pricing](https://www.getjobber.com/pricing/)
- Third-party sources conflict on Jobber. An affiliate roundup says Jobber chemical data is tracked "via custom fields", but Jobber's own page documents a native chemical log. — [Agiled roundup (2026)](https://agiled.app/blog/best-client-management-software-for-pest-control); [Jobber chemical tracking](https://www.getjobber.com/features/chemical-tracking/)

**Jobber: scheduling, agreements, billing, accounting, reporting**
- SCH-04 (license or skill based assignment): I found no skill, tag or license matching. A Jobber support reply in the community forum, about a year old, says Jobber "does not have an auto-assign or round-robin feature" for visits. Assignment is manual from the map or schedule. — [Jobber community: automated round robin](https://community.getjobber.com/discussions/job-details-scheduling/scheduling---automated-round-robin/2765/replies/2803)
- BIL-07 (cancellation billing): the help article "What if a job gets canceled" (updated March 24, 2026) says to close the job and choose either "Complete past visits, remove future visits" or "Remove incomplete visits", then decide by hand whether to invoice. It does not cover proration, refunds, cancellation fees or the client balance. — [Jobber help: What if a job gets canceled](https://help.getjobber.com/en/articles/what-if-a-job-gets-canceled/)
- A Jobber community staff reply says "there is currently no 'cancel job' feature" and suggests renaming the job "cancelled" and closing it. — [Jobber community: canceling a job](https://community.getjobber.com/discussions/job-details-scheduling/canceling-a-job/3865)
- AGR-02 (seasonal rounds): the pest page says users can set up "monthly, quarterly, or seasonal programs" and Jobber books the visits automatically. There is no rounds-in-a-window construct, so this stays Partial. — [Jobber pest control page](https://www.getjobber.com/industries/pest-control-software/)
- AGR-07 (re-service and callbacks): the pest page does not mention re-service or callbacks. — [Jobber pest control page](https://www.getjobber.com/industries/pest-control-software/)
- AGR-03 (price book tiers): optional line-item upsells are a Grow plan feature. Size or square-foot tiers are not documented (baseline, not re-fetched). — [Jobber pricing](https://www.getjobber.com/pricing/)
- ACC-01 (general ledger): Jobber Bookkeeping "starts at $149 per month", is priced by annual revenue, and is "Available to U.S. customers only". It includes "a dedicated bookkeeper" and books "closed within five days of month-end". The page does not mention a general ledger, double-entry, chart of accounts, accrual or cash basis, deferred revenue, or the accounting software underneath. — [Jobber Bookkeeping](https://www.getjobber.com/features/bookkeeping/)
- ACC-04 (deferred revenue): neither the Bookkeeping page nor the recurring-job help documents it. — [Jobber Bookkeeping](https://www.getjobber.com/features/bookkeeping/)
- RPT-02 (retention): only a client re-engagement report lists lapsed clients (baseline, not re-fetched). — [Jobber help: Client re-engagement report](https://help.getjobber.com/en/articles/client-re-engagement-report/)

**Housecall Pro: compliance**
- The HCP pest control page does not mention chemical tracking, pesticide logs, EPA, licensing, compliance, state reporting, re-service or seasonal programs. Its only license reference is the title of a resource article. — [HCP pest control page](https://www.housecallpro.com/industries/pest-control-software/)
- HCP offers a free printable pest control log book template. This is a paper form, not a software feature. — [HCP log book template](https://www.housecallpro.com/pest-control/templates-calculators/log-book-template)
- A competitor's blog (Fieldproxy, June 3, 2026) states "Housecall Pro has no native chemical log module", so technicians use paper or spreadsheets. It says it draws on r/pestcontrol and owner forums but cites no specific post. Treat it as a competitor claim. — [Fieldproxy: HCP alternatives for pest control](https://www.fieldproxy.ai/resources/blog/best-housecall-pro-alternatives-for-pest-control-businesses-2026)
- CMP-05 (pesticide notices): only a workaround exists, customizable automatic pre-job and post-job emails. Nothing is pesticide-specific (baseline, not re-fetched). — [HCP automated marketing](https://www.housecallpro.com/features/automated-marketing/)

**Housecall Pro: agreements, billing, accounting**
- Recurring service plans are listed only under the MAX plan on the pricing page. Basic and Essentials do not have them. — [HCP pricing](https://www.housecallpro.com/pricing/)
- BIL-07: the Service Plans FAQ (dated July 17, 2026) does not cover proration, cancellation fees or what happens to future visits and payments on cancellation. Billing frequency "can't be changed once a plan is active"; the only option is to cancel the plan and create a new one. Per-visit billing uses a $0 plan workaround. — [HCP help: Service plans FAQs](https://help.housecallpro.com/en/articles/5485025-service-plans-faqs)
- AGR-03: the price book and flat-rate pricing come with Essentials. The Sales Proposal Tool (good, better, best options, "$40/mo value") is included in MAX. No property-size tiers are documented. — [HCP pricing](https://www.housecallpro.com/pricing/)
- ACC-01: HCP Accounting is a bookkeeping service ("Let Housecall Pro handle your books, prep reports, and sync transactions") run by "bookkeeping experts". It offers account reconciliation, P&L and a balance sheet. Its FAQ answers "Yes" to whether it replaces your current accounting software. The page does not mention double-entry, chart of accounts, journal entries, accrual or cash basis, deferred revenue or a price. Imagery and links are dated April 2025. — [HCP Accounting](https://www.housecallpro.com/features/accounting/)
- Accounting, Payroll, Voice, Pipeline and CSR AI are separate add-ons with unpublished prices. — [HCP pricing](https://www.housecallpro.com/pricing/); [Projul HCP pricing analysis 2026](https://projul.com/blog/housecall-pro-pricing-analysis-2026)
- The release roadmap (Winter 2024 through Winter 2026) has no item on chemical tracking, pest control, licenses, skills-based dispatch, proration, cancellations, service plans or retention reporting. — [HCP product release roadmap](https://www.housecallpro.com/product-release-roadmap/)

**Wedge status grid (October 2026)**

| ID | Feature | Jobber | Jobber evidence | Housecall Pro | HCP evidence |
| --- | --- | --- | --- | --- | --- |
| CMP-08 | Wisconsin compliance | Unknown (no state named) | [feature page](https://www.getjobber.com/features/chemical-tracking/) | Unknown (no compliance content) | [pest page](https://www.housecallpro.com/industries/pest-control-software/) |
| CMP-05 | Automatic pesticide notices | Unknown (generic reminders only) | [chemical tracking help](https://help.getjobber.com/en/articles/chemical-tracking/) | Partial (pre and post-job email workaround) | [automated marketing](https://www.housecallpro.com/features/automated-marketing/) |
| CMP-06 | Restricted-use controls | Unknown | [chemical tracking help](https://help.getjobber.com/en/articles/chemical-tracking/) | Unknown | [pest page](https://www.housecallpro.com/industries/pest-control-software/) |
| CMP-03 | Applicator license tracking | Partial (numbers only; no category, expiry or alerts) | [chemical tracking help](https://help.getjobber.com/en/articles/chemical-tracking/) | Unknown | [pest page](https://www.housecallpro.com/industries/pest-control-software/) |
| CMP-02 | Catalog with EPA no., label, SDS | Partial (registration no. and target pests; no label or SDS) | [feature page](https://www.getjobber.com/features/chemical-tracking/) | Unknown (no EPA fields; paper log template) | [log template](https://www.housecallpro.com/pest-control/templates-calculators/log-book-template) |
| MOB-03 | Chemical capture in the mobile app | Partial: web only per vendor (OLDER article, April 2024) | [chemical tracking help](https://help.getjobber.com/en/articles/chemical-tracking/) | Partial (materials as job line items; no pesticide fields; baseline) | [material tracking help](https://help.housecallpro.com/en/articles/7119757-material-inventory-detail-tracking) |
| SCH-04 | License or skill based assignment | Unknown (support: no auto-assign) | [community](https://community.getjobber.com/discussions/job-details-scheduling/scheduling---automated-round-robin/2765/replies/2803) | Unknown | [HCP pest apps blog (baseline)](https://www.housecallpro.com/resources/best-pest-control-apps/) |
| ACC-01 | Built-in general ledger | Add-on (human bookkeeping service from $149/mo, US only; GL not documented) | [Bookkeeping](https://www.getjobber.com/features/bookkeeping/) | Add-on (human bookkeeping service; price and GL not documented) | [Accounting](https://www.housecallpro.com/features/accounting/) |
| ACC-04 | Deferred revenue | Unknown | [Bookkeeping](https://www.getjobber.com/features/bookkeeping/) | Unknown | [Accounting](https://www.housecallpro.com/features/accounting/) |
| BIL-07 | Prorated refunds, cancellation billing | Unknown (close job, invoice by hand) | [cancel help](https://help.getjobber.com/en/articles/what-if-a-job-gets-canceled/) | Unknown | [service plans FAQ](https://help.housecallpro.com/en/articles/5485025-service-plans-faqs) |
| AGR-07 | Re-service and callback tracking | Unknown | [pest page](https://www.getjobber.com/industries/pest-control-software/) | Unknown | [pest page](https://www.housecallpro.com/industries/pest-control-software/) |
| AGR-02 | Seasonal programs and rounds | Partial ("seasonal" cadence only) | [pest page](https://www.getjobber.com/industries/pest-control-software/) | Unknown (plans are MAX only) | [pricing](https://www.housecallpro.com/pricing/) |
| AGR-03 | Price book with tiers and add-ons | Partial (upsell line items; no size tiers) | [pricing](https://www.getjobber.com/pricing/) | Partial (flat-rate price book; good, better, best on MAX) | [pricing](https://www.housecallpro.com/pricing/) |
| RPT-02 | Retention and churn analytics | Partial (re-engagement report only) | [help](https://help.getjobber.com/en/articles/client-re-engagement-report/) | Unknown | [advanced reporting (baseline)](https://www.housecallpro.com/features/advanced-reporting/) |

### Inferences
- The PRD's "0 of 8" counts hold for these two products. No wedge feature reaches Yes, and nothing in October 2026 changed a baseline status.
- Jobber's chemical log is the nearest thing to pest compliance in either product, and it appears neglected. The help article has not been updated since April 2024, and the log sits outside the 2026 offline and mobile work. Bugsy's "record comes from finishing the stop, in the app" is a sharp contrast to Jobber's office-side, web-only entry.
- Both vendors answer "no general ledger" with a human bookkeeping service, not software. The real comparison for Bugsy's spec 09 pitch is "done-for-you books" vs "books that are correct by construction". An owner who already pays an outside accountant may see Jobber Bookkeeping ($149+) or HCP Accounting as solving the same pain, so the pitch should stress per-agreement deferred revenue and contract balances, which neither service documents.
- HCP gates recurring service plans to MAX, so for a pest company it is not a $59 product. Its practical floor is $299 a month on annual billing.

### Gaps
- Which Jobber plans include chemical tracking ("select plans"): not stated on the pricing page or in the help article.
- Whether Jobber added chemical capture to the mobile app after April 2024: no vendor confirmation either way. productupdates.getjobber.com returned 403.
- HCP Accounting price, and whether either bookkeeping service runs on QuickBooks or a proprietary ledger: not published.
- HCP SCH-04: I found no official help article on tags or skills.

## 2. PRD table-stakes claims, and Housecall Pro's view-only offline mode

### Takeaway
All seven table stakes are present in both products: map dispatch, mobile app, field payments, autopay, standard reports, reminder and on-the-way texts, and a customer portal. On Jobber, reminders and autopay need the Connect tier or higher. The PRD's claim that Housecall Pro is view-only offline is confirmed by HCP's own help center and its current pricing page. Jobber added a partial offline mode in 2026 (forms, visit details, notes, timers), but chemical records are not part of it.

### Cited Findings
- Jobber Core includes scheduling, quotes, invoices with online payments and "built-in reporting". Connect adds "automated client reminders" and "Collect payments automatically" (autopay). — [Jobber pricing](https://www.getjobber.com/pricing/)
- Jobber field payments include Tap to Pay at 2.7% + 30¢. — [Jobber pricing](https://www.getjobber.com/pricing/)
- Jobber's schedule has day, week and month views, drag and drop and a map drawer. The client hub lets customers request work, approve quotes, see visits and pay. On-my-way texts are on Connect and up (all baseline, not re-fetched). — [Jobber help: Schedule overview](https://help.getjobber.com/en/articles/schedule-overview-new-schedule/); [Jobber client hub](https://getjobber.com/features/client-hub/)
- Jobber app ratings shown on its pest page: 4.8 from 13,861 App Store reviews and 4.5 from 4,883 Google Play reviews. — [Jobber pest control page](https://www.getjobber.com/industries/pest-control-software/)
- HCP includes in every plan: "scheduling and dispatch", payments, a free iOS and Android app, a Spanish app option, and "offline viewing". Checks can be deposited through the mobile app at no fee. Tap to Pay is listed among the add-ons. — [HCP pricing](https://www.housecallpro.com/pricing/)
- HCP automated reminders, On My Way texts with a live map, a customer portal, autopay by card on file, and job, invoice and AR aging reports (baseline, not re-fetched). — [HCP vehicle GPS page](https://www.housecallpro.com/features/vehicle-gps-tracking/); [HCP customer portal](https://www.housecallpro.com/features/customer-portal/); [HCP advanced reporting](https://www.housecallpro.com/features/advanced-reporting/)
- HCP offline, from its help center: "Jobs are the only area of the app where data can be stored". A job must have been opened online first. "Editing without cell service or WiFi connection is not supported at this time." Storage is capped. The article shows January 21, 2026. — [HCP help: Mobile FAQ](https://help.housecallpro.com/en/articles/4747652-housecall-pro-mobile-faq)
- HCP rebuilt its mobile app in spring 2026. The announcement does not mention offline mode, and the current pricing page still says "offline viewing". — [HCP Spring Summit release, May 27, 2026](https://finance.yahoo.com/sectors/technology/articles/housecall-pro-unveils-platform-redesign-130000061.html); [HCP pricing](https://www.housecallpro.com/pricing/)
- Jobber offline: a vendor update titled "Keep working in Jobber, even without internet" exists. I saw only its title, because the page returned 403. — [Jobber product update](https://productupdates.getjobber.com/134787-keep-working-in-jobber-even-without-internet)
- A third-party blog attributes these offline capabilities to Jobber's help center: timers (not location-based ones), job forms, notes and attachments, and viewing visit details. It says editing existing records and capturing signatures do not work offline, and dates the launch to January 2026. The baseline says March 2026, so the date conflicts. — [Mowbius: Does Jobber work offline (2026)](https://getmowbius.com/blog/does-jobber-work-offline)
- An older Jobber community reply said the app did "not support offline capabilities, with the exception of internal notes", and that unsynced notes are lost if the app is logged out or updated. — [Jobber community: out of cell service](https://community.getjobber.com/discussions/job-details-scheduling/out-of-cell-service-area-access/6478)

### Inferences
- The PRD's technician-row claim is accurate for HCP. For Jobber, "weak offline" is still fair but no longer "none". Jobber's offline mode does not cover chemical records, because those cannot be entered in the app at all.
- Bugsy's Phase 1 gaps (field payments, standard reports, reminder texts) are features both horizontal tools give even small shops. They are needed to compete on price-sensitive deals.

### Gaps
- I could not fetch Jobber's official offline help article, so the exact list of what works offline (payments, completing visits, photos) is unverified.
- Exact plan tier for HCP On My Way texts: the pricing page does not list them.

## 3. Current published pricing, users, add-ons and card processing

### Takeaway
The PRD's price ranges are accurate as of October 2026: Jobber $29 to $699 a month, Housecall Pro $59 to $299 on annual billing. But the features a pest company needs sit above the entry tiers. Jobber needs Connect for autopay and reminders and Grow for job costing. Housecall Pro needs MAX for recurring service plans. For an 8-technician company, both horizontal tools cost roughly $230 to $600 a month, below Bugsy's $632 to $792 hypothesis. Card processing benchmarks are 2.9% + 30¢ (Jobber) and from 2.59% (HCP), with ACH at 1% for both.

### Cited Findings
**Jobber** (pricing page dateModified 2026-09-23, fetched 2026-10-29; see [Jobber pricing](https://www.getjobber.com/pricing/)):
- Monthly, no commitment: Core $49 (1 user). Connect $139 (1 user), $199 (5), $299 (10), $399 (15). Grow $199 (1), $299 (5), $399 (10), $499 (15). Plus $499 (5), $599 (10), $699 (15).
- 1-year commitment, after the promotion: Core $39. Connect $119, $169, $259, $339. Grow $169, $259, $349, $429. Plus $439, $499, $599.
- Annual prepaid, renewal rates: Core $29. Connect $99, $149, $229, $299. Grow $149, $229, $299, $399. Plus $399, $449, $529.
- Extra users cost $29/mo each. 16 or more users requires Contact Sales.
- Promotion: up to 40% off for new customers who subscribe before October 30, 2026, 11:59 p.m. PT.
- Plan gating: Connect adds reminders, autopay, QuickBooks Online sync and time tracking. Grow adds upsell line items, job costing, two-way SMS and custom automations. Plus adds custom reports, Pipeline, Marketing Suite and AI Receptionist.
- Add-ons: AI Receptionist $29/mo, Marketing Suite $99/mo, Pipeline $49/mo.
- Processing: card 2.9% + 30¢; Tap to Pay 2.7% + 30¢; ACH (US) 1%; instant payouts an extra 1%.
- AI Receptionist allowance, from the help article updated October 28, 2026: "$29 per month, which includes 30 conversations", then "$0.79 per additional conversation". "Receptionist is included on the Plus Plan with unlimited usage." Dedicated phone numbers are available in the US, Canada and UK. — [Jobber help: Receptionist](https://help.getjobber.com/en/articles/receptionistpowered-by-jobber-ai/)
- This conflicts with the add-ons help article (updated August 13, 2026), which says Receptionist "includes 100 conversations per month", and with the baseline (100). TechRadar lists the add-on at $99/mo. — [Jobber help: Add-on features](https://help.getjobber.com/en/articles/add-on-features-to-your-jobber-plan-subscription/); [TechRadar Jobber review](https://www.techradar.com/pro/software-services/jobber-crm-review)
- Add-on terms: add-on charges are prorated within the billing period, are non-refundable on removal, and cannot be bought during a trial. — [Jobber help: Add-on features](https://help.getjobber.com/en/articles/add-on-features-to-your-jobber-plan-subscription/)
- Jobber Bookkeeping costs from $149/mo, priced by annual revenue, US only. Catch-up work for up to 24 months of backlog is billed one time. — [Jobber Bookkeeping](https://www.getjobber.com/features/bookkeeping/)
- Payroll is through integrations (Gusto, Sequifi), not a native product (baseline, not re-fetched). — [Jobber product update: Gusto](https://productupdates.getjobber.com/29906-speed-up-and-simplify-payroll-with-gusto)

**Housecall Pro** (pricing page fetched 2026-10-29, © 2026; see [HCP pricing](https://www.housecallpro.com/pricing/)):
- Basic: $59/mo annual or $79 monthly, 1 user. Essentials: $149 annual or $189 monthly, 5 users. MAX: $299 annual or $329 monthly, 8 users, then $35/mo per additional user.
- Promotions: Basic and Essentials $26 for the first month; MAX $99/mo for 3 months ("save $690"); a $50 gift card for booking a demo; 14-day trial with no card.
- Gating: Essentials adds routes, flat-rate pricing, photo reports, employee GPS, commissions and QuickBooks Online sync. MAX adds the Sales Proposal Tool, recurring service plans, route optimization, open API and a dedicated onboarding specialist.
- Add-ons, with no prices shown: CSR AI (AI call and chat answering), Pipeline, Payroll, Accounting, Business Coaching, Voice, Campaigns, VGPS and Dashcams, Tap to Pay, Websites. The Sales Proposal Tool is a "$40/mo value", included in MAX.
- Processing: card "as low as 2.59%"; ACH 1%; mobile check deposit with no fee.
- Baseline (not re-fetched): vehicle GPS $20 per vehicle per month and dashcams $49 per device per month; Instapay instant payouts about 1%. — [HCP vehicle GPS](https://www.housecallpro.com/features/vehicle-gps-tracking/); [HCP Instapay](https://www.housecallpro.com/features/instapay/)
- Third-party pricing guides confirm HCP does not publish most add-on prices, including Accounting, Payroll and Voice. — [Projul HCP pricing analysis 2026](https://projul.com/blog/housecall-pro-pricing-analysis-2026)

### Inferences
- **8-technician company, assuming 2 office users (10 seats).** Jobber Connect 10 is $229 on annual billing or $299 monthly. Grow 10 is $299 or $399. Plus 10 is $449 or $599. HCP MAX is about $369 on annual billing or $399 monthly ($299 or $329 plus 2 × $35, assuming the $35 seat price applies on both terms). Bugsy's $632 to $792 runs from about the same as Jobber Plus monthly to about 3.5 times Jobber Connect annual. Even with Jobber Bookkeeping added (Grow 10 annual $299 + $149 = $448), the horizontal stack costs less. Bugsy needs to justify roughly $250 to $400 a month of premium with compliance and the ledger.
- Jobber's self-serve cap of 15 users falls inside Bugsy's ICP (3 to 15 technicians plus office staff). A 13-technician company with 3 office users is pushed to Jobber sales. Bugsy's unlimited office users is a real differentiator at the top of the ICP.
- **Payments benchmark for the PRD's "no more than today" rule.** A tenant moving from Jobber pays 2.9% + 30¢ on cards and 1% on ACH. From HCP it pays from 2.59% on cards and 1% on ACH.

### Gaps
- HCP CSR AI, Voice, Pipeline, Payroll and Accounting prices are not published. A third-party guide found in search cites $200 to $500 a month for CSR AI, but I could not identify its primary source, so I have not used it.
- Whether HCP's $35 extra-user price applies to monthly as well as annual MAX: not stated.
- Which Jobber plans can buy AI Receptionist ("select plans"): not stated.

## 4. AI features shipped in 2025 and 2026, and pest use

### Takeaway
Both vendors ship AI quickly. Jobber now has a paid AI receptionist (general availability August 2025), hands-free Jobber Voice (September 2025), official Claude and ChatGPT connectors for all customers (September 25, 2026) and a "Teammate" agent in beta (September 2026). Housecall Pro has an "AI Team": CSR AI call and chat answering, Analyst, Coach, Marketing AI and Accountant AI. It previewed its "largest AI product release to date" in June 2026 without naming it publicly. I found no evidence of how pest companies specifically use any of these.

### Cited Findings
- Jobber Receptionist reached general availability in August 2025. At launch Jobber said it had already handled more than 200,000 conversations. — [Jobber Receptionist launch release (via Agile Brand Guide)](https://agilebrandguide.com/jobber-launches-ai-powered-receptionist-to-answer-calls-and-texts-for-busy-home-service-businesses/)
- Receptionist answers calls and texts 24/7, books visits using online booking settings, creates requests or tasks, escalates on keywords, and logs a summary, transcript and recording. "Receptionist Companion" (listens during your calls and drafts quotes or visits) is marked "Coming Soon". The page names no pest examples (it names plumbers, HVAC, landscapers and cleaners) and does not disclose the underlying model. — [Jobber AI Receptionist](https://www.getjobber.com/features/ai-receptionist/)
- September 2025: Jobber announced Jobber Voice (hands-free task actions on site) and a Campaign Generator. I saw this through an aggregator. — [finanzen.net republished release](https://www.finanzen.net/nachricht/aktien/industry-leader-jobber-unveils-exciting-new-ai-offerings-for-home-service-businesses-14894231)
- September 25, 2026: Jobber launched a Plugin in ChatGPT and a Connector for Claude, built on MCP, "available to all Jobber customers". They answer questions about clients, properties, jobs, quotes, invoices, requests and visits. They update client, property and request records from call or job notes. They find unbilled revenue (approved quotes never scheduled, completed jobs never invoiced). Jobber "remains the system of record". — [PR Newswire, Sept 25, 2026](https://www.prnewswire.com/news-releases/jobber-launches-mcp-bringing-home-and-commercial-service-data-and-workflows-directly-into-chatgpt-and-claude-302890385.html)
- Secondary coverage of that launch says the connector cannot delete records, change schedules, or create jobs, quotes or invoices. That is not in the primary release. The baseline dated this launch "Oct 2026"; the press release shows September 25, 2026. — [Lapaas Voice](https://lapaasvoice.com/jobber-mcp-chatgpt-claude-connectors)
- Jobber Teammate is an AI agent for morning briefings and task triage, in beta with early access from September 23, 2026. Seen only through an aggregator, with no primary release found. — [BriefGlance](https://briefglance.com/companies/octopusapp-inc-jobber/pulses/87587)
- Jobber Copilot, an AI assistant, launched in October 2024 (OLDER). — [PR Newswire, Oct 2024](https://prnewswire.com/news-releases/jobber-launches-copilot-the-first-of-several-ai-powered-products-aimed-at-making-home-service-business-ownership-simpler-than-ever-before-302264047.html)
- HCP AI Team: CSR AI answers calls and chats 24/7 (text support "coming soon"); chat is on all plans and call answering is "a paid feature"; Analyst AI (custom reports from questions), Coach AI and Marketing AI on all plans; Help AI. No prices are shown, and CSR AI is "sold separately". — [HCP AI Team](https://www.housecallpro.com/features/ai-team/)
- CSR AI and IVR shipped in the Winter 2025 release. — [HCP product release roadmap](https://www.housecallpro.com/product-release-roadmap/)
- The February 2026 update listed CSR AI Chat Answering and Accountant AI, and promised more AI "later this year". Seen through a search summary. — [HCP February 2026 product updates](https://www.housecallpro.com/resources/february-2026-product-updates/)
- HCP previewed its "largest AI product release to date" at the June 4, 2026 Spring Summit. The release gives no name or capabilities. — [HCP Spring Summit release, May 27, 2026](https://finance.yahoo.com/sectors/technology/articles/housecall-pro-unveils-platform-redesign-130000061.html)
- HCP ran "AI Accelerator Week" (April 27 to May 1, 2026), a free bootcamp teaching pros to use Claude, ChatGPT, NotebookLM and Perplexity alongside HCP. Seen through a search summary. — [GlobeNewswire, Apr 24, 2026](https://www.globenewswire.com/news-release/2026/04/24/3280845/0/en/housecall-pro-launches-ai-accelerator-week-to-help-home-service-pros-put-ai-to-work-in-their-businesses.html)
- HCP now calls itself an "AI-powered field service platform" (October 28, 2026). — [GlobeNewswire, Oct 28, 2026](https://www.globenewswire.com/news-release/2026/10/28/3390247/0/en/housecall-pro-names-anan-kashyap-chief-financial-officer-to-support-next-phase-of-growth.html)

### Inferences
- AI call answering is now a standard paid add-on in horizontal tools: about $29 a month with usage caps on Jobber, unpublished on HCP. Bugsy's Phase 1 excludes AI features. That is defensible for a compliance-led wedge, but prospects coming from Jobber will notice it.
- Jobber's MCP connector means a Jobber pest customer can already ask Claude or ChatGPT about unbilled work. The connector exposes no chemical or compliance data, because none of Jobber's documented connector objects cover it.

### Gaps
- No pest-specific AI use cases or testimonials were found for either vendor.
- The name and contents of HCP's June 2026 AI release are not public.
- The underlying LLM providers for Jobber Receptionist and HCP CSR AI are not disclosed.

## 5. Pest control adoption and what pest operators say

### Takeaway
Neither vendor publishes a count of pest control customers. Company-wide, Jobber claims more than 100,000 businesses and 400,000 pros; HCP claims 200,000 to 250,000 pros. Each shows a few named pest testimonials, with no locations. Pest-operator feedback from 2025 and 2026 was thin in what I could reach. Reddit was not accessible to my tools, and Capterra pages returned 403. What surfaced repeats two themes: weak reporting, and no native chemical log (HCP).

### Cited Findings
- Jobber company-wide: more than 100,000 businesses, 400,000+ service pros, 50+ industries, 34 million+ properties served, 70+ countries, and 130+ marketplace integrations (September 25, 2026). — [PR Newswire, Sept 25, 2026](https://www.prnewswire.com/news-releases/jobber-launches-mcp-bringing-home-and-commercial-service-data-and-workflows-directly-into-chatgpt-and-claude-302890385.html)
- Jobber's pest page shows no pest-specific count. Testimonials: Kaleb Pagel (Pagel Services), Cole Perry (Advanced Pest Control: "Jobber helps us provide consistent service every time"), Brandon Jones (JP Pest Control Service), with no locations given. — [Jobber pest control page](https://www.getjobber.com/industries/pest-control-software/)
- HCP company-wide: "Trusted by 200K+ Pros" on its pest page and in its May 27, 2026 release. "More than 250,000 home service professionals who have served 1 in 4 American homes" in its October 28, 2026 release. — [HCP pest page](https://www.housecallpro.com/industries/pest-control-software/); [GlobeNewswire, Oct 28, 2026](https://www.globenewswire.com/news-release/2026/10/28/3390247/0/en/housecall-pro-names-anan-kashyap-chief-financial-officer-to-support-next-phase-of-growth.html)
- HCP's only pest testimonial is Richard V, VeriKill Pest Control, with no location: "There's just no better software for the price you're paying with Housecall Pro". — [HCP pest page](https://www.housecallpro.com/industries/pest-control-software/)
- July 15, 2026: HCP launched its first trade-specific packages, for HVAC, plumbing and electrical. Pest control is not included. I saw the headline and search summary only. — [GlobeNewswire, July 15, 2026](https://www.globenewswire.com/news-release/2026/07/15/3327769/0/en/housecall-pro-launches-trade-specific-software-packages-for-hvac-plumbing-and-electrical-businesses.html)
- Capterra (search snippets; the page returned 403 and the reviews are undated): a pest control reviewer complains of "a lack of properly reports that I don't recommend it". Another pest reviewer calls Jobber "a great software for tracking which service was conducted with chemical tracking of which and how much pesticides were used". Jobber has about 1,487 Capterra reviews. — [Capterra: Jobber vs FieldRoutes](https://www.capterra.com/compare/127994-146076/Jobber-vs-FieldRoutes); [Capterra: Jobber reviews](https://www.capterra.com/p/127994/Jobber/reviews/)
- Fieldproxy, a competitor (June 3, 2026), says the most common HCP complaints in pest owner forums (r/pestcontrol, the Pest Control Operators of America community, Facebook groups) are: no chemical log; quarterly treatments that "require workarounds" such as duplicated jobs or tags that break reporting; and a third complaint. It cites no individual posts. — [Fieldproxy](https://www.fieldproxy.ai/resources/blog/best-housecall-pro-alternatives-for-pest-control-businesses-2026)
- Pest-niche comparison sites describe both GorillaDesk and Jobber as general field-service platforms that list pest among their trades, and note Jobber's applicator-filterable chemical records. — [US Tech Automations: Jobber vs GorillaDesk](https://ustechautomations.com/resources/blog/jobber-vs-gorilladesk-for-pest-control-2027); [Pest Control Software Guide: GorillaDesk vs Jobber](https://pestcontrolsoftwareguide.com/gorilladesk-vs-jobber/)

### Inferences
- HCP is verticalizing, but toward mechanical trades first. A pest package is not announced, which leaves room for Bugsy in the near term. HCP's packaging move is worth watching.
- What pest operators miss in horizontal tools, as best the evidence shows: a native, in-app chemical record; recurring quarterly programs without workarounds; and useful reports. These match Bugsy's specs 06, 07, 04 and the proposed spec 12.

### Gaps
- reddit.com is blocked for my search tool, so I could not verify r/pestcontrol sentiment directly.
- I could not read dated 2025 or 2026 pest-filtered reviews on G2 or Capterra (403).
- No vendor publishes the number of pest control customers. PCT Online and mypmp.net coverage of Jobber or HCP was not reached in this pass.

## 6. Evidence of Wisconsin pest control customers

### Takeaway
I found no evidence of Wisconsin pest control customers for either product, and no Wisconsin or ATCP 29 content on either vendor's site.

### Cited Findings
- Neither the Jobber chemical tracking page nor the Jobber pest page names any state or regulator. — [Jobber chemical tracking](https://www.getjobber.com/features/chemical-tracking/); [Jobber pest page](https://www.getjobber.com/industries/pest-control-software/)
- The HCP pest page has no compliance content and names no state. — [HCP pest page](https://www.housecallpro.com/industries/pest-control-software/)
- None of the vendor testimonials (Pagel Services, Advanced Pest Control, JP Pest Control Service, VeriKill Pest Control) gives a location. — [Jobber pest page](https://www.getjobber.com/industries/pest-control-software/); [HCP pest page](https://www.housecallpro.com/industries/pest-control-software/)

### Inferences
- A search for Wisconsin pest companies returned listings for Madison, Wisconsin Rapids and Green Bay firms, but none named its software. Absence of evidence is not evidence of absence. Horizontal tools are probably in use among small Wisconsin operators, and the pilot interviews should ask.

### Gaps
- Whether Pagel Services is the Wisconsin company of that name: it is not stated on Jobber's page and I could not verify it.
- No vendor customer map or state breakdown is public.

## 7. Verdict tables: PRD claims vs October 2026 evidence

### Takeaway
Most PRD claims about Jobber and Housecall Pro are confirmed. Five need correction or nuance:
- "Cheap" ignores tier gating for pest-relevant features.
- Jobber's offline mode is partial, not absent.
- Jobber's AI Receptionist allowance changed from 100 to 30 conversations.
- Jobber's Claude and ChatGPT connectors launched September 25, not in October.
- Jobber does have a basic chemical log with registration numbers. The PRD sentence does not deny this, but the crosswalk should not imply Jobber has nothing.

### Cited Findings

**Jobber**

| PRD claim | Verdict | Evidence URL |
| --- | --- | --- |
| No Wisconsin support (Why now) | Confirmed | https://www.getjobber.com/features/chemical-tracking/ |
| CMP-08 Wisconsin compliance not fully supported | Confirmed (Unknown) | https://www.getjobber.com/industries/pest-control-software/ |
| CMP-05 automatic pesticide notices not fully supported | Confirmed (Unknown) | https://help.getjobber.com/en/articles/chemical-tracking/ |
| CMP-06 restricted-use controls not fully supported | Confirmed (Unknown) | https://help.getjobber.com/en/articles/chemical-tracking/ |
| CMP-03 applicator license tracking not fully supported | Confirmed (Partial: numbers only) | https://help.getjobber.com/en/articles/chemical-tracking/ |
| CMP-02 catalog with EPA no., label, SDS not fully supported | Confirmed (Partial: registration no., no label or SDS) | https://www.getjobber.com/features/chemical-tracking/ |
| Chemical tracking is web only (baseline weakness) | Confirmed by the vendor, but the source article is OLDER (April 2024); current state could not be re-verified | https://help.getjobber.com/en/articles/chemical-tracking/ |
| SCH-04 license-based assignment: Jobber not among the 2 | Confirmed (no skill or license matching; no auto-assign) | https://community.getjobber.com/discussions/job-details-scheduling/scheduling---automated-round-robin/2765/replies/2803 |
| ACC-01 no built-in general ledger | Confirmed (Add-on: human bookkeeping from $149/mo, US only; no GL documented) | https://www.getjobber.com/features/bookkeeping/ |
| ACC-04 no deferred revenue | Confirmed (could not find) | https://www.getjobber.com/features/bookkeeping/ |
| BIL-07 no cancellation billing | Confirmed (close job, invoice by hand) | https://help.getjobber.com/en/articles/what-if-a-job-gets-canceled/ |
| AGR-07 no re-service tracking | Confirmed (could not find) | https://www.getjobber.com/industries/pest-control-software/ |
| AGR-02 seasonal rounds: Jobber not the 1 | Confirmed (Partial: "seasonal" cadence only) | https://www.getjobber.com/industries/pest-control-software/ |
| AGR-03 price book tiers not fully supported | Confirmed (Partial; baseline) | https://www.getjobber.com/pricing/ |
| RPT-02 retention analytics not fully supported | Confirmed (Partial; baseline) | https://help.getjobber.com/en/articles/client-re-engagement-report/ |
| No device programs, labels, SDS or state reports | Confirmed (CSV export only, no state format) | https://help.getjobber.com/en/articles/chemical-tracking/ |
| "Cheap" | Partly (entry $29 to $49, but reminders and autopay need Connect, $99 annual or $139 monthly and up) | https://www.getjobber.com/pricing/ |
| "Polished" | Confirmed (4.8 from 13,861 App Store reviews; 4.5 from 4,883 Google Play reviews) | https://www.getjobber.com/industries/pest-control-software/ |
| Table stakes: map dispatch, mobile app, field payments, autopay, standard reports | Confirmed (autopay on Connect and up; map per baseline) | https://www.getjobber.com/pricing/ |
| Reminders and on-the-way texts | Confirmed (Connect and up) | https://www.getjobber.com/pricing/ |
| Customer portal | Confirmed (client hub; baseline) | https://getjobber.com/features/client-hub/ |
| Pricing "$29 to $699 a month by tier, billing term and users" | Confirmed (fetched 2026-10-29; extra users $29; 16+ users contact sales) | https://www.getjobber.com/pricing/ |
| Per-seat pricing climbs fast (Jobber complaint) | Partly: $29 per extra user confirmed; review complaints not re-verified | https://www.getjobber.com/pricing/ |
| Weak reporting (category complaint) | Partly: an undated pest reviewer on Capterra complains of reports | https://www.capterra.com/compare/127994-146076/Jobber-vs-FieldRoutes |
| Baseline: AI Receptionist $29/mo for 100 conversations | Contradicted (October 28, 2026 help: 30 conversations, then $0.79 each; unlimited on Plus) | https://help.getjobber.com/en/articles/receptionistpowered-by-jobber-ai/ |
| Baseline: Claude and ChatGPT connectors "Oct 2026" | Contradicted on date (launched September 25, 2026, for all customers) | https://www.prnewswire.com/news-releases/jobber-launches-mcp-bringing-home-and-commercial-service-data-and-workflows-directly-into-chatgpt-and-claude-302890385.html |
| Weak offline (implied) | Partly: 2026 offline mode covers forms, visit details, notes, timers; no record editing; no chemical capture in the app | https://getmowbius.com/blog/does-jobber-work-offline |

**Housecall Pro**

| PRD claim | Verdict | Evidence URL |
| --- | --- | --- |
| No Wisconsin support (Why now) | Confirmed | https://www.housecallpro.com/industries/pest-control-software/ |
| CMP-08 Wisconsin compliance not fully supported | Confirmed (Unknown) | https://www.housecallpro.com/industries/pest-control-software/ |
| CMP-05 automatic pesticide notices not fully supported | Confirmed (Partial: generic pre and post-job emails; baseline) | https://www.housecallpro.com/features/automated-marketing/ |
| CMP-06 restricted-use controls not fully supported | Confirmed (Unknown) | https://www.housecallpro.com/industries/pest-control-software/ |
| CMP-03 applicator license tracking not fully supported | Confirmed (Unknown) | https://www.housecallpro.com/industries/pest-control-software/ |
| CMP-02 catalog with EPA no., label, SDS not fully supported | Confirmed (no EPA fields; paper log template offered instead) | https://www.housecallpro.com/pest-control/templates-calculators/log-book-template |
| SCH-04 license-based assignment: HCP not among the 2 | Confirmed (could not find) | https://www.housecallpro.com/resources/best-pest-control-apps/ |
| ACC-01 no built-in general ledger | Confirmed (Add-on: human bookkeeping service; claims to replace accounting software; GL and price not documented) | https://www.housecallpro.com/features/accounting/ |
| ACC-04 no deferred revenue | Confirmed (could not find) | https://www.housecallpro.com/features/accounting/ |
| BIL-07 no cancellation billing | Confirmed (Service Plans FAQ, July 17, 2026, silent; frequency cannot change on active plans) | https://help.housecallpro.com/en/articles/5485025-service-plans-faqs |
| AGR-07 no re-service tracking | Confirmed (could not find) | https://www.housecallpro.com/industries/pest-control-software/ |
| AGR-02 seasonal rounds: HCP not the 1 | Confirmed (Unknown; service plans MAX only) | https://www.housecallpro.com/pricing/ |
| AGR-03 price book tiers not fully supported | Confirmed (Partial: flat-rate; good, better, best on MAX) | https://www.housecallpro.com/pricing/ |
| RPT-02 retention analytics not fully supported | Confirmed (Unknown; baseline) | https://www.housecallpro.com/features/advanced-reporting/ |
| No device programs, labels, SDS or state reports | Confirmed | https://www.housecallpro.com/industries/pest-control-software/ |
| "Cheap" | Partly (from $59 annual, but recurring service plans need MAX at $299 annual or $329 monthly; many add-on prices unpublished) | https://www.housecallpro.com/pricing/ |
| Offline mode is view-only | Confirmed ("Editing without cell service or WiFi connection is not supported"; pricing page lists "offline viewing") | https://help.housecallpro.com/en/articles/4747652-housecall-pro-mobile-faq |
| Table stakes: map dispatch, mobile app, field payments, autopay, standard reports | Confirmed (pricing page plus baseline; Tap to Pay is listed as an add-on) | https://www.housecallpro.com/pricing/ |
| Reminders and on-the-way texts | Confirmed (baseline; not on the pricing page) | https://www.housecallpro.com/features/vehicle-gps-tracking/ |
| Customer portal | Confirmed (baseline) | https://www.housecallpro.com/features/customer-portal/ |
| Pricing "$59 to $299 a month on annual billing" | Confirmed ($79 to $329 monthly; MAX 8 users, +$35 per user) | https://www.housecallpro.com/pricing/ |
| Add-on fees (category complaint) | Confirmed (CSR AI, Voice, Pipeline, Payroll, Accounting, GPS and Tap to Pay are add-ons, mostly unpriced) | https://www.housecallpro.com/pricing/ |

### Inferences
- The wedge and table-stakes tables in the PRD can stand for these two products without changing any count.
- Change the "Problem and why now" sentence to: "cheap at entry and polished, but the features a recurring pest business needs sit in higher tiers, and they still have no device programs, labels, safety data sheets, state reports or in-app pesticide records."
- In the pricing table, add a note that HCP's pest-relevant floor is MAX at $299 to $329 a month.
- Correct the two baseline JSON entries (Jobber Receptionist allowance; MCP launch date) when the crosswalk is next refreshed.

### Gaps
- Several confirmations rest on the 2026-10-20 baseline rather than re-fetched pages: Jobber map schedule, client hub, re-engagement report; HCP reminders, portal, notices workaround and reporting. These are marked "baseline" above.
- Jobber's offline details rely on a third-party blog because the vendor update page returned 403.
