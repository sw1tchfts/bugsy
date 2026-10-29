# PestPac (WorkWave) vs the Bugsy PRD: fact base as of October 2026

Pages were accessed on 2026-10-29 from public pages only, with no logins. Baseline means `docs/competitors/pestpac.json` (researched 2026-10-20). G2, Capterra, Capterra UK, Software Advice and GetApp returned HTTP 403 to direct fetches, so figures from those sites come from search-result summaries and are marked that way. Statuses use the feature-taxonomy values (Yes, Partial, Add-on, No, Unknown).

## 1. PRD wedge claims, feature by feature

### Takeaway
None of the 13 wedge features moves to Yes for PestPac. The PRD's "0 or low of 8 at Yes" counts still hold for PestPac, and SCH-04 stays Yes, as the PRD already counts. The one material change since the baseline is RPT-02. On Oct 20, 2026, PestPac announced an AI "Customer Hub" that scores churn risk per account and shows callback rate by technician. That brings PestPac close to the retention-analytics and re-service wedge, but the packaging is unpublished and the vendor's own Wavelytics page still says "Coming Soon".

### Cited Findings
**CMP-08 Wisconsin compliance: Unknown (no Wisconsin support found)**
- The chemical tracking page names only "California Material Reports, California Cal-Ag reports, Arizona TARF reports" and "other state-specific compliance exports are built in". It does not mention Wisconsin, ATCP 29, registries, posting signs or neighbor notices. — [PestPac chemical tracking](https://www.pestpac.com/features/chemical-tracking-software)
- The regulatory forms hub lists only HUD NPMA-33, NPMA-99A and NPMA-99B, and no state forms. — [PestPac forms](https://www.pestpac.com/forms)
- No compliance or state-report item appears in any 2025 or 2026 newsroom entry. — [PestPac newsroom](https://www.pestpac.com/newsroom)

**CMP-05 Automatic customer pesticide notices: Partial**
- The vendor says it can "Automate the delivery of call, text or email service reminders and on the way messages", and service reports can be emailed "prior to or after posting". No pre-application pesticide notice, neighbor notice or registry notice is mentioned. — [PestPac customer communication](https://www.pestpac.com/features/customer-communication)
- The mobile app page does not mention pesticide notices or posting. — [PestPac mobile app](https://www.pestpac.com/features/pest-control-mobile-app)

**CMP-06 Restricted-use pesticide controls: Unknown**
- The chemical tracking page and the mobile app page do not mention restricted-use pesticides. The only controls documented are labeled-rate limits ("ensure every technician stays within labeled rates"). — [PestPac chemical tracking](https://www.pestpac.com/features/chemical-tracking-software); [PestPac mobile app](https://www.pestpac.com/features/pest-control-mobile-app)
- A search for PestPac help-center content on restricted-use products or license expiry returned only state regulator pages, with no public PestPac documentation. — (search returned no PestPac page; see Gaps)

**CMP-03 Applicator license tracking: Partial**
- "Attempting to assign a job to a technician without required licensing triggers an automatic warning." No license expiry alerts are mentioned. — [PestPac scheduling](https://www.pestpac.com/features/pest-control-scheduling-software)

**CMP-02 Catalog with EPA number, label and SDS: Partial**
- "Every chemical in PestPac includes its EPA registration number, concentration, and undiluted quantity", and "EPA numbers auto-populate" in the app. Label documents and SDS are not mentioned on this page. — [PestPac chemical tracking](https://www.pestpac.com/features/chemical-tracking-software)
- The baseline places SDS sheets in the CustomerConnect+ commercial portal library. I did not re-fetch that page this round. — [PestPac customer portal](https://www.pestpac.com/features/customer-portal)

**SCH-04 License or skill based assignment: Yes (unchanged)**
- The scheduler warns automatically on assignments that lack licensing. — [PestPac scheduling](https://www.pestpac.com/features/pest-control-scheduling-software)
- The baseline cites the routing page, where skill types such as a termite license or wildlife trapping drive RouteOp and the scheduler to block or warn. I did not re-fetch it this round. — [PestPac routing](https://www.pestpac.com/features/pest-control-routing-software)

**ACC-01 Built-in general ledger: No**
- "PestPac uses an export-based QuickBooks integration, not a live sync", and data is exported "to a general ledger package, such as QuickBooks". The same page claims PestPac's "built-in financial reports replace the need for QuickBooks entirely" for many smaller companies. It also has period lockdown ("transactions aren't released into a closed accounting period"). — [PestPac accounting](https://www.pestpac.com/features/accounting-software)
- "Advanced Accounting With General Ledger Export" appears only in the Professional and Enterprise packages. Small Business gets "Basic Accounting". — [PestPac pricing](https://www.pestpac.com/pricing)

**ACC-04 Deferred revenue: Unknown**
- The accounting page mentions only "Offer annual discounts and apply credits or adjustments". It does not mention deferred revenue or recognizing prepayments as visits are performed. — [PestPac accounting](https://www.pestpac.com/features/accounting-software)

**BIL-07 Prorated refunds and cancellation billing: Unknown**
- The accounting page does not mention proration or cancellation balances. The closest item is "Void invoices, enter payments and reverse payments easily". — [PestPac accounting](https://www.pestpac.com/features/accounting-software)

**AGR-07 Re-service and callback tracking: Unknown in core PestPac, with new callback analytics (recommend Partial with low confidence)**
- The scheduling and mobile pages mention only "Create follow-up and new services directly from the mobile app" and "schedule follow-ups". Neither mentions callbacks or cost capture. — [PestPac scheduling](https://www.pestpac.com/features/pest-control-scheduling-software); [PestPac mobile app](https://www.pestpac.com/features/pest-control-mobile-app)
- **New (Oct 20, 2026):** the Customer Hub in Wavelytics Decision Intelligence "identifies which technician has the highest callback rate, within minutes". — [PR Newswire, Oct 20 2026](https://www.prnewswire.com/news-releases/workwave-announces-two-new-ai-driven-analytics-decision-support-for-pestpac-and-realgreen-that-reduce-customer-churn-and-increase-services-per-tech-302913580.html)

**AGR-02 Seasonal programs and rounds: Unknown**
- The scheduling page lists recurring frequencies (weekly, bi-weekly, monthly, quarterly) and planning "a month, week or day at a time". It does not mention fixed rounds inside a seasonal window. — [PestPac scheduling](https://www.pestpac.com/features/pest-control-scheduling-software)

**AGR-03 Price book with tiers and add-ons: Partial (baseline, not re-fetched)**
- The baseline rates this Partial: proposal templates hold service levels and price points by branch or division, and pricing by property size is not documented. — [PestPac forms software](https://www.pestpac.com/features/pest-control-forms-software)

**RPT-02 Retention and churn analytics: changed from Unknown to Partial, possibly Add-on**
- The standard reporting page still has no retention, churn or cancellation-rate reports. It lists only "Renewals", AR aging, "sales by service and zip code", and Technician Production and Timecards. The scheduling page adds "Report on all orders scheduled but canceled". — [PestPac reporting](https://www.pestpac.com/features/pest-control-reporting-software); [PestPac scheduling](https://www.pestpac.com/features/pest-control-scheduling-software)
- **New (Oct 20, 2026):** the Customer Hub "scores each account's risk of canceling", shows the top reasons behind the risk and the recurring revenue at stake, and refreshes in near real time. It was shown at PestWorld that week. The release does not say whether it is included in PestPac or priced separately, and it does not mention retention rates by route, technician or service. — [PR Newswire, Oct 20 2026](https://www.prnewswire.com/news-releases/workwave-announces-two-new-ai-driven-analytics-decision-support-for-pestpac-and-realgreen-that-reduce-customer-churn-and-increase-services-per-tech-302913580.html); [Landscape Management coverage](https://www.landscapemanagement.net/workwave-launches-ai-analytics-hubs-for-pestpac-and-realgreen-and-adds-two-new-executives/)
- **Conflict:** the release calls Decision Intelligence "the analytics layer built into PestPac", but the Wavelytics page still labels Decision Intelligence and Benchmarking "Coming Soon". Data Factory is described as something you "purchase", with no price. — [PestPac Wavelytics](https://www.pestpac.com/wavelytics)

### Inferences
- The core of the wedge still holds for PestPac: Wisconsin rules, automatic pesticide notices, restricted-use controls, a built-in GL, deferred revenue and cancellation billing. None of these appears in any 2025 or 2026 vendor material.
- Retention analytics is the weakest wedge claim against PestPac. PestPac now markets AI churn-risk scoring and callback rate per technician directly to pest operators. Bugsy's planned "retention by service line and technician" (proposed spec 12) is descriptive and has no spec today. The PRD should not present retention analytics as uncontested.
- The accounting page claim that its "built-in financial reports replace the need for QuickBooks entirely" means PestPac sells against the GL wedge in its messaging, even without double-entry accounting. Bugsy's GL pitch needs to show contract positions and deferred revenue, which a report-only approach cannot.

### Gaps
- I found no public PestPac help-center pages on restricted-use pesticides, license expiry, callbacks or seasonal rounds, so CMP-06, AGR-02 and BIL-07 remain Unknown rather than No.
- Whether the Customer Hub is included in the Professional or Enterprise package or sold as an extra could not be verified.
- I did not re-fetch the routing, forms-software and customer-portal pages this round, so SCH-04, AGR-03 and the SDS part of CMP-02 rest on the baseline.

## 2. PRD table-stakes claims

### Takeaway
PestPac has every table-stakes feature the PRD lists. Reminder and on-the-way texts and two-way SMS are gated to Professional and above and metered by notification credits, so the baseline's Add-on rating for CX-02 stands. The vendor claims full-capacity offline, the deepest of the competitors the PRD names. Store ratings, however, cite crashes and data loss.

### Cited Findings
- **SCH-02 map dispatch board: Yes.** "The appointment scheduler lists technicians across the top with hour-by-hour time slots", "You can drag and drop appointments between technicians or time slots", and "See appointments alongside technician location with the integrated GPS map." — [PestPac scheduling](https://www.pestpac.com/features/pest-control-scheduling-software)
- **MOB-01 mobile app: Yes.** PestPac Mobile (version 3) by WorkWave LLC is rated 2.4 from 150 ratings on the US App Store (baseline: 148). The latest version is 3.28.3, released Oct 21 (2026, year inferred from the version sequence). — [App Store](https://apps.apple.com/us/app/-/id1211298978)
- **MOB-06 field payments: Yes.** Technicians can accept "cash, check, credit cards and ACH payments in the field", and the page does not mention tap to pay. App version 3.26.4 (Apr 6, 2026) added Pay Over Time options. — [PestPac mobile app](https://www.pestpac.com/features/pest-control-mobile-app); [App Store](https://apps.apple.com/us/app/-/id1211298978)
- **BIL-02 autopay: Yes.** "Auto-pay — card on file charged automatically after service", and "Card Capture on Forms — customers add card info at time of digital signature". — [PestPac accounting](https://www.pestpac.com/features/accounting-software)
- **RPT-01 standard reports: Yes.** The reports include AR aging, "sales by service and zip code", Technician Production and Timecards, and Renewals. Report Writer automates recurring report delivery. The Small Business package lists "Basic Reporting", and Professional and Enterprise add "Custom Reporting". — [PestPac reporting](https://www.pestpac.com/features/pest-control-reporting-software); [PestPac pricing](https://www.pestpac.com/pricing)
- **CX-02 reminders and on-the-way texts: Add-on.** The feature exists ("call, text or email service reminders and on the way messages"). "Customer Communications" is listed only in the Professional and Enterprise packages, and the FAQ describes a credit model with a free allotment, where "Additional credits are available at tiered rates depending on your notification volume". — [PestPac customer communication](https://www.pestpac.com/features/customer-communication); [PestPac pricing](https://www.pestpac.com/pricing)
- **New in the app:** version 3.28 (Jun 24, 2026) added Technician Tracker, which sends customers an "On My Way" notification with live tracking. Version 3.28.3 fixed a crash on "Notify Customer" when Precise Location is off. The mobile page also describes a one-tap "en route" text button. — [App Store](https://apps.apple.com/us/app/-/id1211298978); [PestPac mobile app](https://www.pestpac.com/features/pest-control-mobile-app)
- **CX-01 customer portal: Yes.** "Customer Portal" is listed in all three packages, including Small Business. — [PestPac pricing](https://www.pestpac.com/pricing)
- **MOB-02 offline depth: Yes (deep, per the vendor).** The app "works at full capacity without cell service". Technicians can complete work orders, log materials, take payments, fill out forms and capture signatures offline, with data "stored locally" until it syncs automatically. Service history and digital forms are available "even when offline". The page does not say whether photos work offline. — [PestPac mobile app](https://www.pestpac.com/features/pest-control-mobile-app)
- A third-party app aggregator attributes the low store ratings mainly to "frequent application crashes and data loss" (2.39 average across 475 iOS and Android reviews, report dated Jun 12, 2026). — [Marlvel.ai report](https://marlvel.ai/apps/pestpac-mobile-version-3) (search-result summary, not fetched)
- **Two-way SMS (CX-03):** the Communication Center offers "two-way SMS and MMS", email and webchat, with "AI-powered summaries and insights available for every interaction". — [PestPac customer communication](https://www.pestpac.com/features/customer-communication)

### Inferences
- For PestPac, the PRD table-stakes counts are consistent: Yes for the map board, app, field payments, autopay and reports, and Add-on (not counted) for reminders. PestPac is not one of the PRD's "5 of 8" with reminder texts at Yes.
- The vendor offers more offline depth than Bugsy's Phase 1 web app is likely to match on iOS. The low store ratings, which cite crashes and data loss, suggest reliability rather than offline scope is PestPac's weak point. Bugsy's "0 lost visits" pilot metric targets exactly that.

### Gaps
- Whether the one-tap "en route" text works in the Small Business package without Customer Communications could not be verified.
- Whether photos can be captured offline is not stated on the vendor page.

## 3. State regulatory reports supported (and any added in 2025 or 2026)

### Takeaway
PestPac names the same three states as the baseline: California (Material and Cal-Ag), Arizona (TARF) and New York (Material), plus generic "other state-specific compliance exports". I found no new state reports in 2025 or 2026 and no Wisconsin support.

### Cited Findings
- The chemical tracking page names "California Material Reports, California Cal-Ag reports, Arizona TARF reports", plus "other state-specific compliance exports are built in". New York is not named on this page. — [PestPac chemical tracking](https://www.pestpac.com/features/chemical-tracking-software)
- The reporting page lists "State-specific forms, including California and New York Material Reports", and its FAQ mentions "Arizona TARF reports". It also lists federal WDO and WDI forms (NPMA-33, NPMA-99-A, NPMA-99-B). — [PestPac reporting](https://www.pestpac.com/features/pest-control-reporting-software)
- The forms hub lists only HUD NPMA-33, 99A and 99B, and names no states. — [PestPac forms](https://www.pestpac.com/forms)
- App version 3.26.2 (Nov 18, 2025) fixed "California WDO form crashes". This is the only state-specific item in the 2025 and 2026 app notes. — [App Store](https://apps.apple.com/us/app/-/id1211298978)
- The 2025 and 2026 newsroom entries include no compliance or state-report announcements. — [PestPac newsroom](https://www.pestpac.com/newsroom)

### Inferences
- The PRD line "The only state reports named are California, Arizona and New York (PestPac)" is still accurate. Different PestPac pages name different subsets, but together they name these three.
- The generic "other state-specific compliance exports" wording could be used in a sales conversation to claim broad state coverage. Bugsy should be ready to show ATCP 29 specifics, such as the landscape registry advance notice and Appendix D posting, that a generic export would not cover.

### Gaps
- What the "other state-specific compliance exports" cover could not be determined from public pages.

## 4. Does current evidence still support "PestPac users report QuickBooks reconciliation discrepancies"?

### Takeaway
Could not verify. I found no 2025 or 2026 user review that mentions reconciliation, partly because G2, Capterra, Software Advice and GetApp blocked direct fetches. The structural cause is confirmed by the vendor: an export-only, non-live QuickBooks link. Third-party sources contradict each other on how the link works.

### Cited Findings
- Vendor: "PestPac uses an export-based QuickBooks integration, not a live sync." — [PestPac accounting](https://www.pestpac.com/features/accounting-software)
- A competitor's blog argues that PestPac exports financial totals, so "your books get a summary" and invoice-level detail stays in PestPac, which makes it harder to match deposits to invoices. This is an argument from a vendor with a commercial interest, not a user report. — [FieldCommerce blog](https://fieldcommerce.ai/blog/pest-control-software-quickbooks) (search-result summary)
- **Contradictory third-party claims:** Field Service Guide (April 2026) describes QuickBooks Online and Desktop support with two-way sync, which the vendor's own "not a live sync" wording contradicts. — [Field Service Guide](https://fieldserviceguide.com/pestpac/) (search-result summary; the page body came back empty when fetched). Connecteam says PestPac has no accounting integrations such as QuickBooks, which the vendor page also contradicts. — [Connecteam review](https://connecteam.com/reviews/pestpac/) (search-result summary)
- The two 2025 reviews I could read (both January 2025, rated 4.0 and 5.0) do not mention QuickBooks or accounting. — [Software Finder reviews](https://softwarefinder.com/field-service/pestpac/reviews)
- ITQlick's page, dated "Reviewed and Audited: Oct 29, 2026", does not mention QuickBooks complaints. — [ITQlick](https://www.itqlick.com/pestpac)

### Inferences
- The PRD should soften the sentence to one that is verifiable. For example: "PestPac feeds QuickBooks through a periodic GL export, not a live sync", citing the vendor page. Alternatively, it can cite the specific review behind the reconciliation claim, if the original competitor research kept one.

### Gaps
- I could not access the G2 or Capterra review text to search for "reconcil" in 2025 and 2026 reviews (HTTP 403).
- I found no Reddit threads on r/pestcontrol about PestPac and QuickBooks.

## 5. Current pricing (2025 and 2026)

### Takeaway
PestPac still publishes no prices: there are three quote-only packages (Small Business, Professional, Enterprise). Third-party estimates from 2026 still center on about $100 per user per month with about $1,500 setup and annual auto-renewing contracts, but the evidence is thin and inconsistent. SMS is metered by notification credits, and card-processing rates vary with volume.

### Cited Findings
- **Packages (vendor, undated page, accessed 2026-10-29):** Small Business, Professional and Enterprise, with "Speak with a consultant" for pricing and no prices, per-user costs, setup fees or contract terms shown.
  - Small Business: Basic Scheduling and Routing, Basic Accounting, Basic Reporting, Customer Portal, Mobile App, Billing and Payments, Termite Inspection.
  - Professional adds: Smart Scheduling and Route Optimization, IPM and Multi-Unit, Digital Forms, Advanced Accounting With GL Export, Custom Reporting, Customer Communications, Lead Management, eCommerce, Logbook and Marketing Automation.
  - Enterprise adds: Multi-Branch, Logbook and Auditor Reports, and API Integrations.

  — [PestPac pricing](https://www.pestpac.com/pricing)
- **Per user:** about $100 per user per month, an "estimated range" from 5 public sources. The page says it was last verified June 14, 2026, though its Quick Answer says "as of October 2026", and it rates its own confidence "Medium". — [CostBench](https://costbench.com/software/pest-control-software/pestpac/)
- **Setup:** $1,500, reported by one Reddit user. Implementation, customization, training and migration cost "several thousand dollars" (citing itqlick), and one user reported the onboarding fee was waived. — [CostBench](https://costbench.com/software/pest-control-software/pestpac/)
- **Implementation estimate:** $750 to $1,500 per user, plus about $500 per user for training. — [CostBench calculator](https://costbench.com/software/pest-control-software/pestpac/calculator/) (search-result summary, not fetched)
- **Contract terms:** annual increases of 3 to 5%, auto-renewal with cancellation required 30 days before renewal, better rates for annual commitment, some users "locked in for up to 2.5 years", and an average discount of 7%. — [CostBench](https://costbench.com/software/pest-control-software/pestpac/)
- **Other estimates (low quality, conflicting):**
  - A 2026 marketing blog estimates about $150 per user per month. — [Pipeline Marketing blog](https://pipeline-marketing.pages.dev/blog/pest-control-software/) (search-result summary)
  - Capterra shows "$1 per user per month", an implausible placeholder. — [Capterra pricing](https://www.capterra.com/p/23130/PestPac/pricing/) (search-result summary)
  - A search snippet attributed "starts at $80 per user/month" to ITQlick, but the live ITQlick page (Oct 29, 2026) says "Contact for pricing" and "found no public price list". — [ITQlick](https://www.itqlick.com/pestpac)
  - ToolRadar says every tier needs a custom quote. — [ToolRadar](https://toolradar.com/tools/pestpac/pricing) (search-result summary)
- **SMS add-on:** a credit model with a free allotment in the subscription, and "Additional credits are available at tiered rates depending on your notification volume". No rates are published. — [PestPac customer communication](https://www.pestpac.com/features/customer-communication)
- **Payments:** "Processing rates vary based on your business's annual volume." WorkWave Payments covers card, ACH and contactless and is described as "PCI Level 1 certified". — [PestPac accounting](https://www.pestpac.com/features/accounting-software)
- Search-result snippets from review aggregators also report that an annual contract is required, there is no free trial, and reviewers complain of "modules on top of modules". — (see section 7; pages blocked, dates unverified)

### Inferences
- The PRD row "About $100 per user a month, setup about $1,500, annual contracts" matches the best available 2026 estimate (CostBench). The setup figure rests on a single Reddit report, and the per-user number has a credible range of about $80 to $150. The PRD should present it as "reported, unverified".
- Feature gating strengthens Bugsy's "everything included" pitch. A Small Business PestPac customer does not get reminder texts, GL export, lead management or route optimization, according to the vendor's own package list.

### Gaps
- No 2025 or 2026 primary pricing (a vendor quote or a dated user report with numbers) was found.
- The prices of notification credits, RouteOp, the Decision Intelligence hubs and Data Factory are unpublished.

## 6. Product changes in 2025 and 2026 (releases, AI, mobile, modules, ownership)

### Takeaway
2026 was an AI and analytics year for WorkWave:
- WAIve (January): an AI optimization layer and agents.
- Wavelytics Decision Intelligence (February): prescriptive analytics.
- A built-in door-to-door sales engine (June).
- AI churn and callback hubs (October).

I found no acquisition or ownership change, and no new compliance features.

### Cited Findings
- **Sep 10, 2025:** Knox Pest Control selected PestPac. **Nov 5, 2025:** John Ortwerth was appointed Chief Revenue Officer. — [PestPac newsroom](https://www.pestpac.com/newsroom)
- **Jan 27, 2026, WAIve:** an AI layer across the WorkWave suite, built on Wavelytics, with two modes, "Overnight Optimization" (refines schedules and routes before the next day) and "Daytime Teammate".
  - "WAIve Teammates" agents roll out "throughout the year, starting Q2 2026", and "Ask WAIve" natural-language queries launch in Q2 2026.
  - The release does not say which features reach PestPac or whether they cost extra.

  — [Field Technologies Online, Jan 27 2026](https://www.fieldtechnologiesonline.com/doc/workwave-transforms-field-service-operations-with-waive-always-on-ai-optimization-that-listens-learns-and-acts-0001)
- A third-party consultancy post advises checking with a WorkWave rep about which WAIve agents are actually live for PestPac. I found no official list. — [dev.to post](https://dev.to/cortexai/ai-agents-inside-pestpac-52kp) (search-result summary)
- **Feb 2, 2026:** Wavelytics Decision Intelligence was announced ("evolving traditional reporting into prescriptive action") and unveiled at the Beyond Service conference on Feb 10. **Feb 9, 2026:** Coalmarch launched an ROI reporting integration for PestPac users. — [PestPac newsroom](https://www.pestpac.com/newsroom)
- **Jun 25, 2026:** an integrated door-to-door sales engine. Sales Center is "integrated directly into PestPac, rather than using a third-party app", and reps can prospect, price, sign and book "in as little as 3.5 minutes". It includes field-sales performance and ROI dashboards. The release does not say whether it costs extra. — [PR Newswire, Jun 25 2026](https://www.prnewswire.com/news-releases/pestpac-by-workwave-extends-field-capabilities-with-door-to-door-sales-integration-302811186.html)
- **Oct 20, 2026:** the Customer Hub (churn-risk scores, reasons, revenue at risk, callback rate by technician, services-per-tech opportunities, with "Some customers reportedly saw 40% more per tech") and a RealGreen Sales Hub.
  - The CEO claims about an 80% cut in data engineering costs "based on internal analysis".
  - New executives: Cristine Kao (CMO) and Kiran Dhanuka (Chief Customer Officer).

  — [PR Newswire, Oct 20 2026](https://www.prnewswire.com/news-releases/workwave-announces-two-new-ai-driven-analytics-decision-support-for-pestpac-and-realgreen-that-reduce-customer-churn-and-increase-services-per-tech-302913580.html)
- **Communication Center:** "AI-powered summaries and insights available for every interaction". — [PestPac customer communication](https://www.pestpac.com/features/customer-communication)
- **Mobile app 2025 and 2026 notes:**
  - 3.25.2 (Jan 27, 2025): launch Sales Center forms.
  - 3.25.4 (Apr 2025): modernized login.
  - 3.26.1 (Oct 1, 2025): groundwork for single sign-on through WorkWave Authentication.
  - 3.26.4 (Apr 6, 2026): Pay Over Time.
  - 3.27 (Jun 15, 2026): training resources and a leads crash fix.
  - 3.28 (Jun 24, 2026): Technician Tracker live "On My Way".
  - 3.28.1 to 3.28.3 (Jul to Oct 2026): crash and scanner fixes.
  - The US App Store rating is unchanged at 2.4 (150 ratings).

  — [App Store](https://apps.apple.com/us/app/-/id1211298978)
- **Google Play:** 2.26 from 336 ratings, about 57K installs, last updated Oct 15, 2026, per an aggregator crawl on Oct 28, 2026. An April 2026 figure from the same aggregator was 2.39 from 329, according to a search-result summary. — [AppGoblin, Android](https://appgoblin.info/apps/com.workwave.pestpacmobile3)
- **Older context (2024):** in March 2024, the core app was modernized with a new UI, PCI and SOC compliance, Canadian English, and planned French-Canadian, Spanish, UK, EMEA and APAC expansion. — [PestPac newsroom, Mar 26 2024](https://www.pestpac.com/newsroom/workwave-announces-modernization-internationalization-of-pestpac)
- **Ownership:** a search for 2026 WorkWave acquisitions found only older deals (Real Green Systems in June 2021, TEAM Software in September 2021). The 2025 and 2026 newsroom items mention no ownership change. — [StreetInsider: Real Green (2021)](https://www.streetinsider.com/PRNewswire/WorkWave+Acquires+Real+Green+Systems%2C+Joining+Together+Two+Leading+Providers/18588393.html); [SDM: TEAM Software (2021)](https://www.sdmmag.com/articles/99933-workwave-to-acquire-team-software); [PestPac newsroom](https://www.pestpac.com/newsroom)
- The pricing page advertises a "WORKWAVE AMPLIFY" community event on Jan 31, 2027. — [PestPac pricing](https://www.pestpac.com/pricing)

### Inferences
- PestPac's investment is going into AI optimization, analytics and sales. None of the 2025 and 2026 items touch pesticide compliance, notices or accounting depth. The compliance and books wedge is not where PestPac is moving.
- The PRD lists "AI features" as out of Phase 1. PestPac's churn-risk and callback hubs, if bundled, will become part of the comparison set for owner dashboards. Bugsy's spec 12 should at least show cancellations, re-service rate and cost clearly.

### Gaps
- WAIve availability for PestPac, its pricing, and the general availability date of the Customer Hub could not be verified. The vendor's Wavelytics page still says "Coming Soon".
- Current ownership was not re-verified; there is no evidence of a change since EQT's 2021 standalone launch noted in the baseline.

## 7. Review sentiment in 2025 and 2026

### Takeaway
I could verify very little 2025 and 2026 review text because the major review sites blocked fetching. The available signals agree:
- Praise goes to depth: chemical tracking, multi-branch and enterprise features.
- Complaints cover cost and modular pricing, a steep learning curve, slow support, and a dated, low-rated mobile app (about 2.3 to 2.4 on both stores).

### Cited Findings
- **Aggregate ratings (search-result summaries, dates unknown):**
  - G2: 4.1 out of 5 across 126 reviews. — [G2](https://www.g2.com/products/pestpac-by-workwave/reviews)
  - Capterra: 73% positive sentiment from 253 reviews, and customer service 3.9 (238). — [Capterra reviews](https://capterra.com/p/23130/PestPac/reviews/)
- **App stores (October 2026):**
  - iOS: 2.4 from 150 ratings. — [App Store](https://apps.apple.com/us/app/-/id1211298978)
  - Android: 2.26 from 336 ratings (crawled Oct 28, 2026). — [AppGoblin](https://appgoblin.info/apps/com.workwave.pestpacmobile3)
  - The US App Store page shows only old reviews (2018 to 2020): double billing, crashes, freezing and lost data. — [App Store](https://apps.apple.com/us/app/-/id1211298978)
- **Complaints quoted in search snippets from the Capterra, Software Advice and GetApp family (pages blocked, dates and page mapping not verified):**
  - "modules on top of modules" pricing.
  - Being "charged for every month past our 3 months of onboarding time" for a module that "never worked for them".
  - Support "very slow to respond to inquiries (like weeks)".
  - "not really easy to learn and the only way to learn is by trial and error".
  - "service has definitely gotten slower".
  - The "customer facing side is lacking for multi unit module".

  — [Capterra reviews](https://capterra.com/p/23130/PestPac/reviews/); [Software Advice reviews](https://www.softwareadvice.com/field-service/pestpac-profile/reviews/)
- **Praise in the same snippets:**
  - "loaded with features that the larger companies would die to have".
  - "relatively easy to train users on".
  - Strong chemical tracking, multi-branch support and BI.

  — [Capterra reviews](https://capterra.com/p/23130/PestPac/reviews/); [GetApp](https://www.getapp.com/operations-management-software/a/pestpac/)
- **Verified dated reviews (Software Finder, 2.7 out of 5 from 7 reviews overall):**
  - Jan 2025, rated 4.0: "a bit tricky to use, especially when it comes to scheduling".
  - Jan 2025, rated 5.0: "super easy to use"; the scheduler colors "could use some improvement".
  - No 2026 reviews.

  — [Software Finder reviews](https://softwarefinder.com/field-service/pestpac/reviews)
- ITQlick (Oct 29, 2026) lists cons as "Higher cost, potential hidden fees" and "High initial integration cost for legacy systems". — [ITQlick](https://www.itqlick.com/pestpac)
- Connecteam calls PestPac "behind in user experience and dynamic scheduling" and cites low Google Play and App Store ratings due to usability and performance. — [Connecteam review](https://connecteam.com/reviews/pestpac/) (search-result summary)
- **Reddit:** two searches returned no r/pestcontrol threads about PestPac. The only Reddit-sourced data point is the $1,500 setup fee that CostBench cites. — [CostBench](https://costbench.com/software/pest-control-software/pestpac/)

### Inferences
- The PRD's category complaints match what reviewers say about PestPac: opaque pricing with add-on fees, dated interfaces, and bugs. "Bugs after updates" specifically is not evidenced for 2025 and 2026 in what I could read. The app notes do show a steady stream of crash fixes through 2025 and 2026.
- The Android rating appears to have slipped from 2.39 (April 2026) to 2.26 (October 2026), even after the June 2026 Technician Tracker release. This is a usable talking point if confirmed on the live Play Store listing.

### Gaps
- I could not get counts of 2025 and 2026 reviews, or any per-year rating trend, from G2 or Capterra (HTTP 403).
- The live Google Play listing could not be fetched (HTTP 404 on the guessed package ID). The Android figures come from an aggregator.

## 8. Evidence of Wisconsin customers

### Takeaway
I found no evidence of Wisconsin customers. No vendor case study, press release or third-party source ties a Wisconsin pest company to PestPac, and no PestPac page mentions Wisconsin.

### Cited Findings
- A search for PestPac and Wisconsin pest control companies returned only Wisconsin company and chamber listings (Pest Badger, Pest Patrol, Batzner, Terminix Wil-Kil, Safeway Pest Management), none of which mentions PestPac. — [Terminix Wil-Kil](https://wil-kil.com/pests/pest-info-library); [Safeway Pest Management (Waukesha chamber)](https://business.waukesha.org/list/member/safeway-pest-management-inc-3571)
- The 2025 and 2026 customer announcement (Knox Pest Control, Sep 10, 2025) is not identified as a Wisconsin company. — [PestPac newsroom](https://www.pestpac.com/newsroom)
- The chemical tracking, reporting and forms pages name no Wisconsin reports. — [PestPac chemical tracking](https://www.pestpac.com/features/chemical-tracking-software); [PestPac reporting](https://www.pestpac.com/features/pest-control-reporting-software); [PestPac forms](https://www.pestpac.com/forms)

### Inferences
- The baseline names Terminix as a PestPac user (third-party data), and Terminix Wil-Kil operates in Wisconsin. That could mean PestPac runs at one large Wisconsin operator, but nothing I found confirms that Terminix Wil-Kil uses PestPac. Treat it as a hypothesis to check in pilot interviews.

### Gaps
- No customer list, case study or job posting linking a Wisconsin firm to PestPac was found. Job boards and LinkedIn were not searched.

## 9. Verdicts on PRD claims about PestPac

### Takeaway
Of the PRD's PestPac-related claims, most are confirmed. One is partly contradicted: retention analytics, now that PestPac markets AI churn-risk scoring. Two are only partly supported: pricing figures, which rest on thin third-party estimates, and the state-report list, where pages name different subsets. One cannot be verified: QuickBooks reconciliation complaints.

### Inferences
- Recommended PRD edits:
  1. Qualify the retention-analytics wedge row and the "11 of 13" framing, citing the Oct 20, 2026 Customer Hub.
  2. Restate the QuickBooks point as "export-only, not a live sync" (vendor-sourced), or cite the specific review behind it.
  3. Label the PestPac price row "third-party estimate, June 2026".

### Gaps
- The verdicts for SCH-04, AGR-03 and the SDS part of CMP-02 rely on baseline sources that were not re-fetched this round.

### Cited Findings

| PRD claim | Verdict | Evidence URL |
| --- | --- | --- |
| No competitor fully supports Wisconsin compliance (CMP-08): PestPac not Yes | Confirmed (Unknown; no Wisconsin named) | https://www.pestpac.com/features/chemical-tracking-software |
| Automatic pesticide notices (CMP-05): PestPac not Yes | Confirmed (Partial: reminders and service reports only) | https://www.pestpac.com/features/customer-communication |
| Restricted-use controls (CMP-06): PestPac not Yes | Confirmed (Unknown; not mentioned) | https://www.pestpac.com/features/chemical-tracking-software |
| Applicator license tracking (CMP-03): 0 of 8 Yes | Confirmed (Partial: warning on assignment, no expiry alerts) | https://www.pestpac.com/features/pest-control-scheduling-software |
| Catalog with EPA no., label, SDS (CMP-02): 0 of 8 Yes | Confirmed (Partial: EPA no. yes; label and SDS documents not on catalog page) | https://www.pestpac.com/features/chemical-tracking-software |
| License-based assignment (SCH-04): 2 of 8 Yes (PestPac among them) | Confirmed (Yes) | https://www.pestpac.com/features/pest-control-scheduling-software |
| Built-in general ledger (ACC-01): 0 of 8 | Confirmed (No: "export-based ... not a live sync") | https://www.pestpac.com/features/accounting-software |
| Deferred revenue (ACC-04): 0 of 8 | Confirmed (Unknown; not documented) | https://www.pestpac.com/features/accounting-software |
| Cancellation billing (BIL-07): 0 of 8 | Confirmed (Unknown; not documented) | https://www.pestpac.com/features/accounting-software |
| Re-service tracking (AGR-07): 0 of 8 | Confirmed for Yes count; partly eroded (callback rate by technician in new Customer Hub) | https://www.prnewswire.com/news-releases/workwave-announces-two-new-ai-driven-analytics-decision-support-for-pestpac-and-realgreen-that-reduce-customer-churn-and-increase-services-per-tech-302913580.html |
| Seasonal programs and rounds (AGR-02): 1 of 8, not PestPac | Confirmed (Unknown) | https://www.pestpac.com/features/pest-control-scheduling-software |
| Price book with tiers and add-ons (AGR-03): 0 of 8 | Confirmed (Partial, baseline; not re-fetched) | https://www.pestpac.com/features/pest-control-forms-software |
| Retention analytics (RPT-02): 0 of 8 | Partly (still not Yes, but PestPac now markets AI churn-risk scoring; packaging unknown, Wavelytics page says "Coming Soon") | https://www.prnewswire.com/news-releases/workwave-announces-two-new-ai-driven-analytics-decision-support-for-pestpac-and-realgreen-that-reduce-customer-churn-and-increase-services-per-tech-302913580.html |
| Map dispatch board (SCH-02) in all 8 | Confirmed (Yes) | https://www.pestpac.com/features/pest-control-scheduling-software |
| Mobile app (MOB-01) in all 8 | Confirmed (Yes; iOS 2.4 from 150) | https://apps.apple.com/us/app/-/id1211298978 |
| Field payments (MOB-06) in all 8 | Confirmed (Yes: cash, check, card, ACH; Pay Over Time) | https://www.pestpac.com/features/pest-control-mobile-app |
| Autopay and card on file (BIL-02) in all 8 | Confirmed (Yes) | https://www.pestpac.com/features/accounting-software |
| Standard reports (RPT-01) in all 8 | Confirmed (Yes) | https://www.pestpac.com/features/pest-control-reporting-software |
| Reminder and on-the-way texts (CX-02) in 5 of 8 at Yes (PestPac Add-on) | Confirmed (Add-on: Professional tier and up, credit-metered) | https://www.pestpac.com/pricing |
| Customer portal (CX-01) in 5 of 8 | Confirmed (Yes, all packages) | https://www.pestpac.com/pricing |
| Offline mode depth (PRD singles out HCP and GorillaDesk as weak) | Confirmed: PestPac claims full offline (work orders, materials, payments, forms, signatures) | https://www.pestpac.com/features/pest-control-mobile-app |
| Only state reports named are California, Arizona, New York (PestPac) | Confirmed (no new states in 2025 or 2026; pages name different subsets) | https://www.pestpac.com/features/pest-control-reporting-software |
| PestPac users report QuickBooks reconciliation gaps | Could not verify (export-only link confirmed; no 2025 or 2026 review found) | https://www.pestpac.com/features/accounting-software |
| Opaque pricing with add-on fees for SMS and card processing (category complaint) | Confirmed for PestPac (no published prices; SMS credits at tiered rates; processing varies by volume) | https://www.pestpac.com/features/customer-communication |
| PestPac price: about $100 per user a month | Partly (2026 third-party estimate; range about $80 to $150; not vendor-published) | https://costbench.com/software/pest-control-software/pestpac/ |
| PestPac setup about $1,500 | Partly (single Reddit report cited by CostBench; may be waived) | https://costbench.com/software/pest-control-software/pestpac/ |
| PestPac annual contracts | Confirmed (third-party: auto-renew, 30-day notice, 3 to 5% yearly increases) | https://costbench.com/software/pest-control-software/pestpac/ |
| No competitor shows Wisconsin support (PestPac part) | Confirmed (no Wisconsin customers, forms or rules found) | https://www.pestpac.com/forms |
