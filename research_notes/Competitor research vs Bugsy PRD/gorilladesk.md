# GorillaDesk vs the Bugsy PRD (evidence as of 2026-10-29)

Scope: pest control features only. Pages were fetched on 2026-10-29 unless a date is given. Status values follow `docs/competitors/feature-taxonomy.json` (Yes, Partial, Add-on, No, Unknown). "Baseline" means `docs/competitors/gorilladesk.json`, researched 2026-10-20. Capterra, G2, Software Advice and GetApp returned HTTP 403 to direct fetches, and reddit.com is blocked to the search tool, so review evidence comes from search snippets, the App Store and a third-party Play Store tracker.

## 1. PRD wedge claims, feature by feature

### Takeaway
None of the 13 wedge features is a vendor-documented "Yes" in GorillaDesk today, so the PRD's wedge counts hold for GorillaDesk. One baseline status is out of date: SCH-04 moves from Unknown to Partial, because Mantis AI routing (beta, Growth plan, preview only) now matches jobs to technician *skills* by service type. It does not use licenses or certifications.

### Cited Findings

| ID | Feature | Baseline | Status now | Evidence and notes | URL |
|---|---|---|---|---|---|
| CMP-08 | Wisconsin compliance (ATCP 29, registry notice, posting) | Unknown | Unknown | Wisconsin is not named anywhere. The chemical tracking page says only that if a state "requires pesticide usage logs" GorillaDesk can generate them, and that "many states require that chemical use be tracked and stored for up to seven years." The pest page offers "Stay compliant in your state" with no state detail. | https://gorilladesk.com/features/chemical-tracking-software/ ; https://gorilladesk.com/industries/pest-control-software/ |
| CMP-05 | Automatic customer pesticide notices | Partial | Partial | Completion triggers email or text the work order or invoice (help article dated Apr 16, 2026). Chemical use appears on invoices and work orders by default. There is no pre-application notice, registry notice or notice log. | https://intercom.help/gorilladesk/en/articles/2164746-triggers ; https://gorilladesk.com/features/chemical-tracking-software/ |
| CMP-06 | Restricted-use pesticide controls | Unknown | Unknown | Restricted-use products are not mentioned on the chemical tracking page, and no 2025–2026 change log entry covers them. | https://gorilladesk.com/features/chemical-tracking-software/ ; https://intercom.help/gorilladesk/en/articles/8420909-gorilladesk-software-change-log-and-updates |
| CMP-03 | Applicator license tracking | Unknown | Unknown (likely absent) | A help center search for "license" returns only a company-level "Business License" field in company settings and custom documents. Nothing covers technician license numbers, categories or expiry. | https://intercom.help/gorilladesk/en/?q=license |
| CMP-02 | Catalog with EPA no., label, SDS | Partial | Partial | The master material list holds the "EPA registration number, active ingredients, and dilution rates." A help center search for "SDS" returns zero articles. Labels appear only as "follow the label instructions." | https://gorilladesk.com/features/chemical-tracking-software/ ; https://intercom.help/gorilladesk/en/?q=SDS |
| SCH-04 | License or skill based assignment | Unknown | **Partial (changed)** | In Mantis AI Routing [Beta], "Technician Skill Matching – Match service type to technician skills" uses skills from a Skills Manager (examples: Ant Control, Termite Treatment, Mosquito Control). The help article says nothing about certifications or licenses, and does not say whether a skill mismatch blocks an assignment or only lowers its preference. It is a Growth plan feature labeled "Preview Available / Live Version Coming Soon". The change log (Oct 19, 2026) says applying routes to the live calendar "isn't available yet." | https://intercom.help/gorilladesk/en/articles/16069037-mantis-ai-routing-beta ; https://intercom.help/gorilladesk/en/articles/8420909-gorilladesk-software-change-log-and-updates |
| ACC-01 | Built-in general ledger | No | No | The accounting FAQ calls GorillaDesk "your pest control software" and QuickBooks "your full financial software". That article is dated Sep 1, 2017, so it is old. The pricing page lists "QuickBooks Online Sync" on Pro. No accounting or GL entries appear in the 2025–2026 change log. | https://intercom.help/gorilladesk/en/articles/431640-accounting-faq-quickbooks ; https://gorilladesk.com/pricing/ |
| ACC-04 | Deferred revenue | Unknown | Unknown (no evidence) | No deferred revenue documentation exists. The accounting FAQ suggests a manual journal entry (DR AR / CR Income) for accrual users. The mosquito page lets customers "prepay for the season" but says nothing on how that is booked. The "Advance Balance" trigger bills the next service early, and GorillaDesk recommends leaving it disabled. | https://intercom.help/gorilladesk/en/articles/431640-accounting-faq-quickbooks ; https://gorilladesk.com/industries/mosquito-control-software/ ; https://intercom.help/gorilladesk/en/articles/2164746-triggers |
| BIL-07 | Prorated refunds, cancellation billing | Unknown | Unknown (likely absent) | The Terminate Service article (Jan 19, 2026) says the linked invoice "will be voided" and that "all associated recurring jobs will be deleted." It does not mention prepaid balances, refunds, proration or cancellation fees. A help search for "prorate" returns zero articles. | https://intercom.help/gorilladesk/en/articles/10349402-job-status-terminate-service ; https://intercom.help/gorilladesk/en/?q=prorate |
| AGR-07 | Re-service and callback tracking | Partial | Partial | The mosquito page mentions a "warranty-based respray" and suggests "custom tags or notes to track why a job was moved or repeated." A new trigger (Mar 30, 2026) automatically marks $0 invoices as Paid. No callback cost capture exists. A help search for "callback" returns only AI agent and VoIP articles. | https://gorilladesk.com/industries/mosquito-control-software/ ; https://intercom.help/gorilladesk/en/articles/2164746-triggers ; https://intercom.help/gorilladesk/en/?q=callback |
| AGR-02 | Seasonal programs and rounds | Partial | Partial | The mosquito page offers to "schedule out the entire season in just a few clicks" on 14, 21 or 30 day cycles, to "prepay for the season", and to send "automatic renewal notices for service plans". Service Plans (Growth plan, article Apr 7, 2025) chain follow-up services that each trigger on the previous job's completion. Season or date windows are not covered and there is no round-count model. | https://gorilladesk.com/industries/mosquito-control-software/ ; https://intercom.help/gorilladesk/en/articles/10165299-service-plans |
| AGR-03 | Price book with tiers and add-ons | Partial | Partial (tiers on Growth) | Estimate Packages bundle items, and "customers can choose only one package"; they are listed among Growth plan features. The Map Estimation Tool (Growth, Aug 1, 2025) measures property area. No pricing by square footage or property size is documented. Line items and service templates became exportable on Jul 11, 2025. | https://intercom.help/gorilladesk/en/?q=package ; https://intercom.help/gorilladesk/en/articles/8569025-features-available-on-the-growth-plan ; https://intercom.help/gorilladesk/en/articles/8420909-gorilladesk-software-change-log-and-updates |
| RPT-02 | Retention and churn analytics | Partial | Partial | Retention data is limited to: the Terminate Service status (added Jan 16, 2025), a dashboard count of terminated jobs, a Service Lookup filter with a Termination Notes column, and a Kong AI sample prompt for a "customer churn report". The report list (Jan 13, 2026) has no retention or cancellation-rate report, and nothing breaks churn down by technician, route or service. | https://intercom.help/gorilladesk/en/articles/10349402-job-status-terminate-service ; https://intercom.help/gorilladesk/en/articles/1090344-available-reports ; https://intercom.help/gorilladesk/en/?q=churn |

- Neither 2025–2026 change log section contains any entry on licenses, notices, SDS, labels, restricted-use pesticides, state report formats, deferred revenue, proration or QuickBooks. The material-tracking work in that period: dilution toggle and custom column (Mar 21, 2025), Material Use report including device materials (Mar 31, 2025), Material Preset power-up (Apr 8, 2025), presets on mobile (May 30, 2025), and hiding materials on paperwork (Sep 4, 2025) — https://intercom.help/gorilladesk/en/articles/8420909-gorilladesk-software-change-log-and-updates
- One entry (Apr 23, 2025) reads "Weather data on PDFs now labeled", so GorillaDesk paperwork carries weather data. The baseline's CMP-01 note said weather fields were not documented. — https://intercom.help/gorilladesk/en/articles/8420909-gorilladesk-software-change-log-and-updates

### Inferences
- The wedge holds against GorillaDesk on every regulatory and accounting item: CMP-02, 03, 05, 06 and 08, ACC-01 and 04, and BIL-07. The vendor's 2025–2026 roadmap went into AI agents, VoIP, payments and marketing, not compliance or accounting, so these gaps are unlikely to close soon.
- SCH-04 is the closest call. GorillaDesk now has skill tags, and Mantis can match service type to skill. A skill tag could act as a manual stand-in for a certification category ("Mosquito Control" as a skill), but it has no license number, expiry or hard block. Bugsy's pitch should say "license *and expiry* enforced at dispatch", not just "skill-based assignment."
- AGR-02 and AGR-03 are the softest wedge items against GorillaDesk. It already sells season scheduling, season prepay, renewal notices and good/better/best-style packages, though packages need the $149+ Growth plan. In a demo, a Wisconsin mosquito buyer may see these as good enough.

### Gaps
- Could not confirm whether Mantis skill matching blocks or only prefers. The Mantis article also contradicts itself on applying routes to the live calendar.
- Did not search the help center for "restricted" or "RUP" specifically. CMP-06 rests on the chemical tracking page and the change log.
- Could not see the in-app material record fields directly (no login). Help center coverage may lag the product.

## 2. PRD table-stakes claims and the offline-mode claim

### Takeaway
All the table-stakes items the PRD lists are present in GorillaDesk. The customer portal is Pro-only, and texts need the paid SMS package. The PRD's claim that offline mode "caches only the current week" is confirmed by the vendor's article, but that article is dated Dec 18, 2024 (older than 2025). The bigger offline limit is that job and invoice details are read-only offline.

### Cited Findings
- **Dispatch board with map (SCH-02): Yes.** The baseline cites a drag-and-drop calendar plus map view (https://gorilladesk.com/features/job-scheduling-software/, not re-fetched). 2025–2026 additions: all work pool jobs appear on the map (Apr 10, 2025), schedules get map colors (Sep 24, 2025), and the Map Drawing Tool was renamed Map Batch Select (Apr 1, 2026) — https://intercom.help/gorilladesk/en/articles/8420909-gorilladesk-software-change-log-and-updates
- **Route optimization:** included on every plan. Basic gets "routing up to 25 stops", Pro gets Drive Matrix routing with real-time drive times, and Growth adds Best Available Time and Job Magnet — https://gorilladesk.com/pricing/
- **Mobile app (MOB-01): Yes.** On the iOS App Store it is rated 4.4 from 62 ratings, version 3.4.5 (released Sep 22) — https://apps.apple.com/us/app/gorilladesk/id978627591. On Google Play it is rated 4.18 from 406 ratings, about 29K installs, store last updated 2026-09-21, per a third-party tracker crawled 2026-10-28 — https://appgoblin.info/apps/com.gorilladesk.app
- **Field payments (MOB-06): Yes.** Mobile 3.3.0 added Tap to Pay (Jan 23, 2025), and mobile tipping arrived May 20, 2026 — https://intercom.help/gorilladesk/en/articles/8420909-gorilladesk-software-change-log-and-updates. A Square contactless chip reader costs $49 — https://intercom.help/gorilladesk/en/articles/2574943-square (search snippet).
- **Autopay and card on file (BIL-02): Yes.** The "Charge card on file" completion trigger needs Stripe or Square and a saved card (Apr 16, 2026) — https://intercom.help/gorilladesk/en/articles/2164746-triggers. Pro adds "automated subscription billing through Stripe and Square" — https://gorilladesk.com/pricing/
- **Standard reports (RPT-01): Yes.** Basic includes "20 built-in reports and a dashboard" — https://gorilladesk.com/pricing/. The report list (Jan 13, 2026) covers invoices, payments, Accounts Aging, Sales Tax Summary, revenue and forecast by client, service, item, staff, source and tag, Material Usage, Time Clocking and GPS — https://intercom.help/gorilladesk/en/articles/1090344-available-reports. Accounts Aging gained a "Point In Time" view on Sep 10, 2026 — https://intercom.help/gorilladesk/en/articles/8420909-gorilladesk-software-change-log-and-updates
- **Reminders and on-the-way texts (CX-02): Yes, but texting is paid.** Confirmations and reminders go by email and/or text "X days before," and on-my-way messages can include "the exact arrival time and link to your current location" — https://gorilladesk.com/features/appointment-confirmations-reminders/. On-the-way messaging requires the SMS package ("You must have the SMS package enabled") — https://intercom.help/gorilladesk/en/articles/5581067-on-the-way-messaging (search snippet). An "On My Way" location variable was added Dec 29, 2025 — https://intercom.help/gorilladesk/en/articles/8420909-gorilladesk-software-change-log-and-updates
- **Customer portal (CX-01): Add-on (Pro plan).** The pricing page lists Customer Portal under Pro — https://gorilladesk.com/pricing/ ; https://intercom.help/gorilladesk/en/articles/431660-plans-pricing. The portal was redesigned Feb 19, 2025, with a Portal AI agent for inquiries, leads and bookings, and gained location search on Oct 1, 2026 — https://intercom.help/gorilladesk/en/articles/8420909-gorilladesk-software-change-log-and-updates
- **Offline mode (MOB-02): Partial.** The article says "Offline mode will only store data from the current week, Monday – Sunday", with no access to last or next week. The calendar must have been loaded online at least once, and offline mode works only in the app. Job details and invoice details "cannot be edited offline". Techs *can* change job status, add check-in and check-out times, add notes, and add or edit materials. Payments, signatures, photos and sync behavior are not covered. The article is dated Dec 18, 2024 — https://intercom.help/gorilladesk/en/articles/6993151-app-offline-mode
- Later offline items are fixes only: mobile 3.3.4 included an offline-mode fix (Jun 20, 2025) — https://intercom.help/gorilladesk/en/articles/8420909-gorilladesk-software-change-log-and-updates. App version history shows 3.2.8 "Load offline mode when the server is not responding" and a 3.4.1 fix for job counts when switching from offline to online — https://apps.apple.com/us/app/gorilladesk/id978627591
- Aggregator review sites claim "nearly 20% report slow syncing and lack of reliable offline access." These are affiliate-style sites with unstated methods, so treat the figure as unverified — https://fieldcamp.ai/reviews/gorilladesk/ ; https://tooleduppro.com/reviews/gorilladesk/

### Inferences
- The PRD's wording "GorillaDesk caches only the current week" is accurate, but it understates the real problem. For a technician in a basement, a one-week cache is enough. What fails is the read-only job and invoice detail, plus undocumented offline photo, signature and payment capture. GorillaDesk offline *does* record check-in and check-out times and materials, which are the core ATCP 29.21 fields, so the PRD's "incomplete legal records" cost is weaker against GorillaDesk than against a view-only app. Bugsy should pitch completion-blocking validation and durable offline photos and signatures instead.
- Route optimization is included from the $49 Basic plan, and Bugsy defers it past Phase 1. A prospect comparing the two will see that gap. The PRD's argument that "manual dispatch works at this size" should be stated explicitly in sales material.
- Bugsy's Phase 1 field payments (cash, check, card on file, pay link) trail GorillaDesk's Tap to Pay, card reader and tipping.

### Gaps
- No 2025–2026 vendor statement on offline mode exists, and the article may be stale. Could not test the app (no sign-up allowed).
- The baseline SCH-02 feature page (job-scheduling-software) was not re-fetched; the change log entries above confirm the map features are current.

## 3. Current pricing (2025–2026)

### Takeaway
The PRD's numbers are right: $49, $99 and $149 a month, each including one route, unlimited users, extra routes $30 to $100. The marginal route is mostly $50, though. An 8-route company pays about $299 (Basic), $449 (Pro) or $549 (Growth) a month before SMS, VoIP and AI fees, well under Bugsy's proposed $632 to $792.

### Cited Findings
- **Plans (monthly billing):** Basic $49, Pro $99, Growth $149, each for the first route with unlimited users. Extra routes: Basic +$50 each for routes 2–3 and +$30 each from route 4; Pro +$50 each; Growth +$100 for route 2 and +$50 each from route 3. The page's worked totals: 3 routes cost $149 / $199 / $299 and 5 routes cost $209 / $299 / $399 (Basic / Pro / Growth). The page carries "© 2026" — https://gorilladesk.com/pricing/
- **Conflicting help article:** the Plans & Pricing article (Feb 8, 2026) says Basic is "$50/month per additional schedule" with no $30 step, and gives no extra-schedule price for Growth — https://intercom.help/gorilladesk/en/articles/431660-plans-pricing. The pricing page is more detailed and newer, so I treat it as current.
- **Third-party conflict:** Software Advice structured data lists Growth at $299 a month — https://www.softwareadvice.com/field-service/gorilladesk-profile/reviews/ (search snippet). This contradicts the vendor's $149 and is probably stale or a multi-route figure. One Capterra snippet mentions "monthly plans starting at $79", probably older pricing — https://www.capterra.com/p/130290/GorillaDesk/reviews/ (search snippet).
- **Route definition:** "Each technician who works solo needs their own schedule. Crews that travel together need a schedule only for the crew leader" (Feb 8, 2026) — https://intercom.help/gorilladesk/en/articles/431660-plans-pricing
- **Terms:** yearly billing gives one month free and is charged for the full year upfront. Monthly plans cancel anytime and accounts can be frozen. 14-day trial, no card required. No setup fees or contracts. Free migration of contacts, addresses, notes and starting balance only, not service or billing history — https://gorilladesk.com/pricing/
- **SMS:** $5 a month for a local number, plus credit packs of $50 for 1,000, $100 for 2,500 and $200 for 8,000 texts. Credits never expire and only outgoing texts count. The page is inconsistent: one paragraph lists a "$20 / $50 / $100 / $200" series — https://gorilladesk.com/pricing/. Incoming messages are free — https://intercom.help/gorilladesk/en/articles/431660-plans-pricing
- **AI agents:** $1.00 per completed "static" conversation (Q&A) and $1.75 per completed "dynamic" conversation (captures a lead or books). No monthly fee is listed. The agents are Maya (receptionist), Kong (analyst), Mantis (routing) and Atrax (website builder), plus VoIP, SMS, web chat and portal agents — https://gorilladesk.com/features/ai-agents/. The reminders page says "AI agents included on every plan", which likely means available on every plan but metered — https://gorilladesk.com/features/appointment-confirmations-reminders/
- **VoIP:** VoIP Basic $65, VoIP Pro $95 and VoIP Growth $275 a month, "unlimited users on every tier" — https://gorilladesk.com/voip-plan/. The help article says VoIP Basic "starts at $65/month per user", which conflicts with the vendor page — https://intercom.help/gorilladesk/en/articles/431660-plans-pricing. A Mar 20, 2026 change added a one-time activation fee, monthly number fees and free seats — https://intercom.help/gorilladesk/en/articles/8420909-gorilladesk-software-change-log-and-updates
- **MailStream:** native SMS and email campaigns with "pay-as-you-go pricing" (Apr 20, 2026). SMS sent through MailStream bills at the standard SMS package rate — https://intercom.help/gorilladesk/en/articles/8420909-gorilladesk-software-change-log-and-updates ; https://intercom.help/gorilladesk/en/articles/13731262-mailstream (search snippet). The baseline's "$5 per 1,000 emails" was not re-verified.
- **Payment processing** (article Jul 23, 2025): Stripe "2.9% + 30 cents per successful charge" with no setup or monthly fees; Square card-not-present 2.9% + 30¢; Square in person with Square hardware 2.6% + 15¢. ACH and Tap to Pay rates are not stated, and no GorillaDesk markup is mentioned — https://intercom.help/gorilladesk/en/articles/5342695-stripe-vs-square
- **Tipping:** "A connect fee of 15% + $0.30 applies per successful transaction". Stripe only; Square "not yet available" (article Sep 17, 2026) — https://intercom.help/gorilladesk/en/articles/14711280-tipping. The 15% figure is as written; it may be a typo for 1.5%. Could not verify.
- **Surcharging:** customizable from 0.01% to 3.00% with a 3% default and the $0.30 fee removed (Jul 16, 2026). Credit cards only, removed from ACH and debit (Jun 23 and Jul 1, 2026). Disabled and locked in MA, CT, ME and PR (Aug 1, 2026) — https://intercom.help/gorilladesk/en/articles/8420909-gorilladesk-software-change-log-and-updates
- **Other add-ons:** SnailMail (Jul 20, 2025) upgraded to USPS First-Class "at no extra cost" (Jun 9, 2026); per-piece prices not found. Attachment limits by plan: Basic 20MB, Pro 50MB, Growth 100MB (Dec 8, 2025) — https://intercom.help/gorilladesk/en/articles/8420909-gorilladesk-software-change-log-and-updates
- **Feature gating that matters for pest companies:** Pro ($99) is needed for the customer portal, online booking, GPS tracking, QuickBooks Online sync, device tracking and barcoding, documents and e-signature, commission tracking and subscription billing. Growth ($149) is needed for estimate packages, Service Plans, Map Estimation, Job Magnet, Best Available Time and Mantis — https://gorilladesk.com/pricing/ ; https://intercom.help/gorilladesk/en/articles/10165299-service-plans

### Inferences
- These figures are my own arithmetic from the pricing page's per-route rules, not vendor quotes.

| Routes or techs | GD Basic | GD Pro | GD Growth | Bugsy at $79–$99 per tech |
|---|---|---|---|---|
| 3 | $149 | $199 | $299 | $237–$297 |
| 8 | $299 | $449 | $549 | $632–$792 |
| 15 | $509 | $799 | $899 | $1,185–$1,485 |

- At 8 technicians Bugsy would cost about $83 to $343 a month more than GorillaDesk Pro or Growth, before GorillaDesk's SMS credits. For example, 5,000 outgoing texts a month would cost roughly $125 at the $200 per 8,000 rate; that volume is my assumption, not a sourced figure. Bugsy's all-inclusive SMS and GL narrow the gap, but the list price is still higher, so the pitch must rest on compliance and accounting value, not price.
- GorillaDesk charges one route per crew; Bugsy's per-active-technician price would charge a two-person crew twice. Expect this objection from companies that run trainees with a certified applicator, which the PRD's `visit_technicians` change makes common.
- GorillaDesk already publishes its prices and charges no setup fee, so "published pricing, no setup fee" does not differentiate against it. "SMS included" and "no tier gating" do.

### Gaps
- No annual prices are shown, only "one month free". ACH and Tap to Pay processing rates, SnailMail per-piece prices, MailStream email rates and the AI agent package's own fee (the help center mentions "the AI Agent package") were not found.
- The tipping connect fee figure needs confirmation.

## 4. Product changes in 2025 and 2026

### Takeaway
GorillaDesk ships often, but its 2025–2026 releases went into AI agents, VoIP, payments (Tap to Pay, ACH verification, tipping, surcharging), marketing (MailStream, SnailMail, Atrax websites, free DoorMamba) and routing (Mantis). There were no compliance, license, notice or accounting releases. It is moving toward an AI front office, not regulatory depth.

### Cited Findings
All entries below are from https://intercom.help/gorilladesk/en/articles/8420909-gorilladesk-software-change-log-and-updates (newest entry Oct 21, 2026; 2025 and 2026 sections fully read).
- **AI:** Portal AI Agent (Feb 19, 2025); SMS AI agent recognizes existing customers (Jun 2, 2025); AI Help Agent (Aug 15, 2025); Atrax AI website builder, free on Basic (Oct 6, 2025); Kong AI data analyst on Pro and Growth (Oct 21, 2025), on mobile (Mar 9, 2026) and with more data (Mar 18, 2026); AI VoIP Receptionist, requiring VoIP Pro (Jan 22, 2026); AI agent PDF content (Jun 3, 2026); AI agents extended to payments, estimates, documents and appointments (Aug 18, 2026); AI Writing and Note Assistant (Aug 14 and 21, 2026); Mantis AI routing preview on Growth (Oct 19, 2026); SMS Lead Conversion Agent (Oct 21, 2026).
- **Platform:** expanded API endpoints (Aug 8, 2026); GorillaDesk MCP server for AI assistants (Aug 21, 2026).
- **Payments and billing:** Terminate Service status for churn tracking, which voids invoices and removes recurring jobs (Jan 16, 2025); Tap to Pay on mobile 3.3.0 (Jan 23, 2025); recurring discounts (Mar 7, 2025); Net 30/60/90 payment terms with automatic late fees (Mar 17, 2025); deposits applicable across invoices (Mar 25, 2025); tax on late fees (Jun 29, 2025); PO numbers repeating on recurring invoices with PO search (Dec 2, 2025); Stripe ACH Instant Verification, with micro-deposits retired in March 2026 (Mar 6, 2026); auto-mark $0 invoices Paid (Mar 30, 2026); tipping (May 20, 2026); surcharge changes (Jun 23 to Aug 1, 2026); debit and credit tags (Jul 13, 2026).
- **Materials:** dilution toggle (Mar 21, 2025); materials inside devices added to the Material Use report (Mar 31, 2025); Material Preset (Apr 8, 2025); weather data labeled on PDFs (Apr 23, 2025); presets on mobile (May 30, 2025); hide materials on work orders (Sep 4, 2025).
- **Agreements and scheduling:** Service Plans on Growth (Mar 28, 2025); block scheduling outside office hours (Aug 11, 2025); 4th and 5th period scheduling exceptions (Nov 20, 2025); real-time technician tracking and technician dashboard on mobile (Dec 29, 2025); per-location scheduling preferences (dated Aug 20 in the log but listed among October 2026 entries).
- **Termite:** Sentricon devices can be moved between locations and customers (Jan 14, 2026).
- **Marketing and communication:** SnailMail (Jul 20, 2025); Map Estimation Tool on Growth (Aug 1, 2025); triggers send documents by SMS (Sep 5, 2025); DoorMamba made free (Dec 17, 2025); MailStream (Apr 20, 2026); manual SMS number blocking (Jun 4, 2026).
- **Absent from the 2025–2026 entries:** chemical compliance beyond material entry, licenses, pesticide notices, SDS, labels, restricted-use pesticides, QuickBooks or accounting, proration, re-service and retention reports.

### Inferences
- The MCP server and API expansion make GorillaDesk data reachable by outside AI tools and integrators. A third party could build compliance add-ons on top, but none was found.
- Repeating PO numbers on recurring invoices (Dec 2025) updates the baseline's COM-07 note ("PO number fields not documented"). It does not touch the PRD wedge.

### Gaps
- Could not verify whether GorillaDesk has announced plans for state compliance or accounting features; no roadmap page was found.
- Pest trade press (PCT Online, mypmp.net) produced no GorillaDesk news in search; the query returned unrelated WIPO "PCT" pages. Could not verify any 2025–2026 press coverage.

## 5. Review sentiment in 2025 and 2026

### Takeaway
Sentiment is strongly positive on ease of use, support and price: about 4.8 on Capterra and G2, 4.4 on iOS and 4.2 on Android. Pest companies report switching *to* GorillaDesk from PestPac, FieldRoutes, Briostack, Pocomos and paper. No public account of a company leaving it was found. Complaints cluster on tier gating and rising cost per schedule, reporting depth, setup complexity, outages, and mobile sync, the last mostly from low-quality aggregators.

### Cited Findings
- **Capterra:** about 4.8 from 272–278 reviews (two search snippets differ). Direct fetch returned 403 — https://www.capterra.com/p/130290/GorillaDesk/reviews/ (search snippets).
- **G2:** 4.8 out of 5 from 43 reviews with an ease-of-use score of 9.6. G2 says reviewers rate its pricing above Jobber's but some find it "expensive for solo operators". Negatives are complex setup and delays from outages — https://www.g2.com/compare/gorilladesk-vs-jobber ; https://www.g2.com/compare/gorilladesk-vs-pestpac-by-workwave
- **App Store:** 4.4 from 62 ratings. Reviews include an owner who switched from PestPac because it was "too complicated", a company that moved from paper in 2025 and praises email billing, online payments, the portal and support, "Wildlifewrangler" (Jul 23, 2025) praising steady improvement, and a long-time user who disliked a UI change in the version switch — https://apps.apple.com/us/app/gorilladesk/id978627591?see-all=reviews&platform=iphone
- **Older App Store review (2022):** reported lost contract signatures, photos and access codes after a server error, and that "upgrades sometimes take the system down." Same page as above.
- **Google Play:** 4.18 from 406 ratings, via a third-party tracker — https://appgoblin.info/apps/com.gorilladesk.app. GorillaDesk's own site claims a 4.8 Android rating (self-reported, per search snippet).
- **Capterra and Software Advice complaints** (from search summaries, dates not verified):
  - features not available on Basic, and costs that "add up quickly with additional users or schedules";
  - one reviewer pays $99 instead of $50 to get document features;
  - missing payroll and crew support, and no termite diagrams (possibly older, since Sketch graphing is now on Pro);
  - users not notified when the system is down;
  - one dissatisfied Software Advice reviewer was asked to pay the full contract balance to exit, which conflicts with the vendor's "no contracts" claim and may reflect annual prepay.

  Sources: https://www.capterra.com/p/130290/GorillaDesk/reviews/ ; https://www.softwareadvice.com/field-service/gorilladesk-profile/reviews/
- **Switching in:** Capterra reviewers name FieldRoutes, PestPac, Briostack and Pocomos as prior tools, plus QuickBooks with Google Calendar, and paper — https://www.capterra.com/p/130290/GorillaDesk/reviews/ (search summary). No review describing a move away from GorillaDesk was found (same search).
- **Aggregator criticism (low confidence, affiliate-style):** mobile app more limited than desktop, slow syncing, reporting "falls short for data-driven operations teams", SMS costs lacking transparency at high volume, and a poor fit for 50+ technician operations — https://fieldcamp.ai/reviews/gorilladesk/ ; https://tooleduppro.com/reviews/gorilladesk/ ; https://www.selecthub.com/p/field-service-software/gorilladesk/
- **Trustpilot:** no reviews, profile unclaimed — https://www.trustpilot.com/review/gorilladesk.com

### Inferences
- GorillaDesk is the low-friction, well-liked choice that PestPac and FieldRoutes refugees pick. Bugsy will not out-"easy" it on day one, so its position has to rest on compliance and books plus comparable ease. No review cites Wisconsin compliance or deferred revenue as a pain point. Bugsy's discovery interviews should test whether Wisconsin GorillaDesk users feel those pains or handle them on paper without complaint.
- The PRD's category complaints ("opaque pricing with add-on fees for SMS, GPS and card processing") apply only in part to GorillaDesk. SMS is a paid add-on and GPS is gated to Pro, but pricing is published and no card-processing markup is documented beyond standard Stripe or Square rates. The tipping connect fee is the exception.

### Gaps
- Reddit r/pestcontrol could not be searched (reddit.com blocked to the crawler). Could not verify Reddit sentiment.
- Could not read individual dated 2025–2026 Capterra, G2 or Software Advice reviews directly (HTTP 403). Counts and quotes above come from search snippets.
- Google Play reviews were not visible (the Play page did not render, and the tracker shows no review text).

## 6. Wisconsin and Midwest customers

### Takeaway
Mosquito Police of Antigo, Wisconsin (8 techs) is confirmed. No other Wisconsin customer was found. GorillaDesk showcases Midwest pest and wildlife firms with 13 to 27 technicians, which overlaps and exceeds Bugsy's 3 to 15 technician target.

### Cited Findings
- Mosquito Police, Antigo, WI, 8 techs, appears in the "Mosquito Control teams run on GorillaDesk" list with no quote or case study — https://gorilladesk.com/industries/mosquito-control-software/
- Midwest pest and wildlife customers on the pest control page: Abra Kadabra Environmental Services (Mound, MN, 27 techs), Van Den Berge Pest Control (Holland, MI, 17), Four Seasons Exterminating (Lakeview, MI, 18), Cottom's Wildlife Removal (Columbia Station, OH, 15) and Boone Wildlife (Kirkwood, MO, 13). No Wisconsin, Illinois, Iowa or Indiana firm is listed — https://gorilladesk.com/industries/pest-control-software/
- The showcased pest customers across all states range from 13 to 27 techs — https://gorilladesk.com/industries/pest-control-software/
- A web search for GorillaDesk Wisconsin pest customers found none beyond the above — search results, e.g. https://gorilladesk.com/pest-control-service-agreement/

### Inferences
- The PRD frames GorillaDesk mainly as the price-led choice for 1–2 tech owner-operators ("GorillaDesk starts at $49 a month"). Its own showcase shows 13–27 tech pest companies, so it competes head-on for Bugsy's 3–15 tech first tenant, including in the upper Midwest.
- Mosquito Police of Antigo is a natural interview target. It is a Wisconsin mosquito company on GorillaDesk that must handle landscape registry notices and posting, which GorillaDesk does not document.

### Gaps
- Could not verify Mosquito Police's current status or how it handles Wisconsin notices. The customer lists are marketing showcases with no dates.

## 7. Summary verdicts: which PRD claims about GorillaDesk hold?

### Takeaway
The PRD's GorillaDesk claims mostly hold. Its pricing figures, the absence of a GL, deferred revenue and Wisconsin support, and the offline "current week" detail are all confirmed. Three points need updating: SCH-04 is now Partial (skill matching in beta); the "1–2 tech" framing understates GorillaDesk's reach into the 3–15 tech segment; and "published pricing, no setup fee" does not set Bugsy apart from GorillaDesk.

### Cited Findings

| PRD claim (about GorillaDesk) | Verdict | Evidence URL |
|---|---|---|
| Per route, unlimited office users | Confirmed | https://gorilladesk.com/pricing/ |
| $49 to $149 a month including 1 route | Confirmed | https://gorilladesk.com/pricing/ |
| Extra routes $30 to $100 | Confirmed (Basic $50 then $30; Pro $50; Growth $100 then $50; a help article says Basic is a flat $50) | https://gorilladesk.com/pricing/ ; https://intercom.help/gorilladesk/en/articles/431660-plans-pricing |
| "GorillaDesk starts at $49 a month" (price-led small buyers) | Confirmed on price; partly on segment (showcased customers have 13–27 techs) | https://gorilladesk.com/pricing/ ; https://gorilladesk.com/industries/pest-control-software/ |
| Offline mode caches only the current week | Confirmed (article dated Dec 18, 2024, older; job and invoice details read-only offline) | https://intercom.help/gorilladesk/en/articles/6993151-app-offline-mode |
| No Wisconsin support (CMP-08) | Confirmed (Unknown; Wisconsin never named) | https://gorilladesk.com/features/chemical-tracking-software/ |
| No full automatic pesticide notices (CMP-05) | Confirmed (Partial: completion triggers send work orders listing materials) | https://intercom.help/gorilladesk/en/articles/2164746-triggers |
| No full restricted-use controls (CMP-06) | Confirmed (Unknown; not mentioned) | https://gorilladesk.com/features/chemical-tracking-software/ |
| No full applicator license tracking (CMP-03) | Confirmed (Unknown; only a company Business License field) | https://intercom.help/gorilladesk/en/?q=license |
| No full catalog with EPA no., label and SDS (CMP-02) | Confirmed (Partial: EPA number yes, no SDS or label docs) | https://gorilladesk.com/features/chemical-tracking-software/ ; https://intercom.help/gorilladesk/en/?q=SDS |
| License-based assignment counts 2 of 8; GorillaDesk not one (SCH-04) | Partly (still not Yes, but now Partial: Mantis skill matching, Growth plan, beta, no licenses) | https://intercom.help/gorilladesk/en/articles/16069037-mantis-ai-routing-beta |
| No built-in general ledger (ACC-01) | Confirmed (No; QuickBooks Online sync on Pro) | https://intercom.help/gorilladesk/en/articles/431640-accounting-faq-quickbooks ; https://gorilladesk.com/pricing/ |
| No deferred revenue (ACC-04) | Confirmed (Unknown; nothing documented) | https://intercom.help/gorilladesk/en/articles/431640-accounting-faq-quickbooks |
| No full cancellation billing or proration (BIL-07) | Confirmed (Terminate Service voids the invoice; no proration articles) | https://intercom.help/gorilladesk/en/articles/10349402-job-status-terminate-service ; https://intercom.help/gorilladesk/en/?q=prorate |
| No full re-service tracking (AGR-07) | Confirmed (Partial: tags and notes, $0 invoice trigger, no cost) | https://gorilladesk.com/industries/mosquito-control-software/ |
| Seasonal programs: only 1 of 8 full; GorillaDesk not it (AGR-02) | Confirmed (Partial: season scheduling, prepay, Service Plans on Growth; no round or window model) | https://gorilladesk.com/industries/mosquito-control-software/ ; https://intercom.help/gorilladesk/en/articles/10165299-service-plans |
| No full price book with tiers and add-ons (AGR-03) | Confirmed (Partial: Estimate Packages on Growth; no size-based pricing) | https://intercom.help/gorilladesk/en/?q=package |
| No full retention analytics (RPT-02) | Confirmed (Partial: terminated counts and Kong AI; no rates by route, tech or service) | https://intercom.help/gorilladesk/en/articles/1090344-available-reports |
| Map dispatch board in all 8 (SCH-02) | Confirmed | https://intercom.help/gorilladesk/en/articles/8420909-gorilladesk-software-change-log-and-updates |
| Mobile app in all 8 (MOB-01) | Confirmed | https://apps.apple.com/us/app/gorilladesk/id978627591 |
| Field payments in all 8 (MOB-06) | Confirmed (Tap to Pay, Square reader, tipping) | https://intercom.help/gorilladesk/en/articles/8420909-gorilladesk-software-change-log-and-updates |
| Autopay in all 8 (BIL-02) | Confirmed (charge card on completion; subscriptions on Pro) | https://intercom.help/gorilladesk/en/articles/2164746-triggers |
| Standard reports in all 8 (RPT-01) | Confirmed (20 reports on Basic) | https://gorilladesk.com/pricing/ |
| Reminder and on-the-way texts (CX-02) | Confirmed (texts need the paid SMS package) | https://gorilladesk.com/features/appointment-confirmations-reminders/ |
| Customer portal (CX-01) | Confirmed as Add-on (Pro plan) | https://gorilladesk.com/pricing/ |
| Category complaint: add-on fees for SMS, GPS, card processing | Partly (SMS add-on yes; GPS gated to Pro; no processing markup documented except the tipping connect fee) | https://gorilladesk.com/pricing/ ; https://intercom.help/gorilladesk/en/articles/5342695-stripe-vs-square ; https://intercom.help/gorilladesk/en/articles/14711280-tipping |
| Category complaint: bugs after updates | Partly (one App Store complaint about a UI change; an older 2022 complaint of upgrade outages; G2 notes outage delays) | https://apps.apple.com/us/app/gorilladesk/id978627591?see-all=reviews&platform=iphone ; https://www.g2.com/compare/gorilladesk-vs-pestpac-by-workwave |
| Published pricing and no setup fee as a Bugsy differentiator | Contradicted for GorillaDesk (it already publishes prices, with no setup fee and free migration) | https://gorilladesk.com/pricing/ |
| Mosquito Police of Antigo, WI (8 techs) is a customer (baseline) | Confirmed (no other Wisconsin customer found) | https://gorilladesk.com/industries/mosquito-control-software/ |

### Inferences
- Suggested PRD edits:
  1. Mark GorillaDesk SCH-04 as Partial in `docs/competitors/gorilladesk.json`, and sharpen Bugsy's claim to "license, category and expiry enforced at dispatch".
  2. Reword the offline weakness: read-only job and invoice details, with photos, signatures and payments offline undocumented, rather than only "current week".
  3. Drop "published pricing" as a differentiator against GorillaDesk.
  4. Name GorillaDesk as a direct competitor for 3–15 tech companies, not just 1–2 tech ones.
  5. Pressure-test the $79–$99 per technician price against GorillaDesk's $449–$549 for 8 routes on Pro or Growth.

### Gaps
- Reddit sentiment, individually dated 2025–2026 Capterra and G2 reviews, Google Play review text, annual plan prices, ACH processing rates, and the exact tipping fee could not be verified from public pages.
