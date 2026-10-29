# FieldRoutes and ServSuite (ServiceTitan) vs the Bugsy PRD, as of October 2026

Scope and method notes (read first):
- Research done 2026-10-29 from public pages only. Baselines (`docs/competitors/fieldroutes.json`, `servsuite.json`, researched 2026-10-20) were treated as claims to verify.
- Blocked on direct fetch: Capterra (all regions), G2, GetApp, GlobeNewswire and Reddit (reddit.com is not accessible to the research crawler). Ratings from those sites below come from search-result snippets and are labeled that way.
- App Store version dates shown without a year are current-year (2026) dates under Apple's display convention; years for those entries are inferred, not printed on the page.
- "Older" marks any source dated before 2025.
- Status values follow `feature-taxonomy.json`: Yes, Partial, Add-on, No, Unknown. CMP-08 stays Unknown unless the vendor names Wisconsin.

## 1. ServSuite sunset: status, end date, support, migration offers, customers affected

### Takeaway
FieldRoutes still says publicly that "ServSuite by FieldRoutes is sunsetting" but gives no end-of-life date, no support policy and no discount amounts. It is running numbered migration cohorts ("cohort-4") with an "updated incentive", and ServSuite's mobile app was still getting fix releases in October 2026. So migration is being pushed but is not yet forced by any public deadline. The buying moment is real but soft, and Bugsy would be competing against an unpublished FieldRoutes switch discount.

### Cited Findings
- The FieldRoutes migration landing page reads: "ServSuite by FieldRoutes is sunsetting. It's time to move to FieldRoutes software." It offers a "tailor-made migration plan and your preferred discounts". It gives no end-of-life date, no support end date, no discount amount and no deadline. — [FieldRoutes SS migration page](https://fieldroutes.com/lp/ss-migration/free-demo)
- The same page carries a testimonial: "FieldRoutes is 10 times easier to use than ServSuite." Its banners read both "JOIN 5,000+ COMPANIES" and "JOIN 1,700+ COMPANIES", and the two figures conflict. — [FieldRoutes SS migration page](https://fieldroutes.com/lp/ss-migration/free-demo)
- A second migration page under `/lp/ss-migration/cohort-4/` has the headline "New, Updated Offer Now Available" and says "you're eligible for an updated incentive!" It does not describe the incentive. This is evidence of a staged, cohort-based migration campaign (at least 4 cohorts). — [FieldRoutes SS migration cohort 4](https://fieldroutes.com/lp/ss-migration/cohort-4/free-demo)
- **Contradiction on the vendor's own site:** the ServSuite product page still says "ServSuite is now ServSuite by FieldRoutes, but there is no change to your software or service". It says nothing about a sunset. — [ServSuite by FieldRoutes page](https://www.fieldroutes.com/servsuite-by-fieldroutes)
- ServSuite Mobile is still maintained. Version 20.12.110 shipped about 3 days before 2026-10-29 and fixed duplicate credit card charges and blank work-order PDFs. Earlier fix releases came on Jan 22, Mar 16, May 11, Jul 6, Aug 13 and Sep 23 (2026, inferred). The listing has no end-of-support notice. — [ServSuite Mobile, App Store](https://apps.apple.com/us/app/servsuite-mobile/id534271165)
- Customers already moved: a FieldRoutes case study published Oct 5, 2023 (older) says Kwik Kill Pest Control is "among the more than 400 companies that have made the shift to FieldRoutes" from ServSuite. Kwik Kill demoed at PestWorld in Oct 2022 and finished implementation by the end of March 2023. — [FieldRoutes Kwik Kill case study (2023)](https://www.fieldroutes.com/resources/case-studies/kwik-kill-pest-control-case-study)
- Combined footprint: "40 of the Top 100 pest control companies use FieldRoutes or ServSuite, including six of the Top 10" (PestWorld 2025 release, Oct 15, 2025). The release gives no split between the two products. — [FieldRoutes PestWorld 2025 release (Finviz)](https://finviz.com/news/193322/fieldroutes-showcases-continued-customer-growth-and-future-vision-at-pestworld-2025)
- Historical scale (older): ServSuite had "over 50,000 users" at ServiceTitan's Feb 2021 acquisition of ServicePro, per the baseline profile. — [ServiceTitan press release (2021, older)](https://www.servicetitan.com/press/st-servicepro)
- A competitor's comparison page says new buyers "are generally pointed at the flagship FieldRoutes product" and that ServSuite "remains available under FieldRoutes". It is a competitor source. — [Autopilot vs ServSuite](https://www.autopilotapp.io/vs/servsuite/)
- I found no ServSuite sunset or end-of-life coverage in PCT Online, PMP or ServiceTitan investor materials. A general search for a sunset date returned only the rebrand and the 2023 migration case study. — [search result: SoftwareConnect ServSuite listing](https://softwareconnect.com/reviews/servsuite-by-fieldroutes/)

### Inferences
- The PRD's statement ("sunsetting ServSuite with no public end date") is accurate as of 2026-10-29. "Its users must migrate anyway" is directionally right but not yet forced: there is no public deadline, the product page still promises "no change", and the app is still maintained.
- The cohort numbering plus an "updated incentive" suggests FieldRoutes has run at least 4 waves of migration outreach, and that remaining ServSuite customers are the ones who have not moved yet, possibly the least willing. That group is Bugsy's realistic target. Expect to compete against a FieldRoutes discount and the low-friction "same vendor" path.
- Remaining ServSuite users are probably skewed toward long-tenured, multi-branch or commercial operators. ServSuite's strengths were commercial bait-station tracking and branch support, which are outside Bugsy's Phase 1 first-tenant profile. This is inference, not sourced.

### Gaps
- End-of-life date, end-of-support date and data-export policy: none published. Could not verify.
- Size and terms of the migration discount: not published. Could not verify.
- How many ServSuite customers remain, and how many are in Wisconsin: no source found.
- Where departing ServSuite customers go other than FieldRoutes: no public source found (Reddit not accessible).

## 2. PRD wedge claims, feature by feature

### Takeaway
None of the 13 wedge features is newly "Yes" for either product as of 2026-10-29. FieldRoutes stays "Yes" only on SCH-04 (skill- and qualification-based routing, not license validity), which matches the PRD's count of 2 of 8. The main change since the baseline is that FieldRoutes publicly announced "Revenue Retention" churn indicators on Oct 8, 2026. They are labeled "upcoming" with no date, so RPT-02 is the wedge item most at risk. ServSuite's public documentation is too thin to show any wedge feature, so it is Unknown everywhere.

### Cited Findings
**FieldRoutes**
- CMP-08 Wisconsin compliance: **Unknown**. The termite page names only "California Branch 3 Structural Pest Control for WDOs" and the national NPMA-33 form, and no FieldRoutes page found mentions Wisconsin, ATCP 29 or the landscape registry. — [FieldRoutes termite page](https://www.fieldroutes.com/solutions/termite-pest-control)
- CMP-05 automatic pesticide notices: **Unknown**. The vendor documents automated appointment reminders ("text messages and phone calls") and payment reminders, but no pre- or post-application pesticide notices. — [FieldRoutes pest control software page](https://www.fieldroutes.com/solutions/pest-control-software); [termite page](https://www.fieldroutes.com/solutions/termite-pest-control)
- CMP-06 restricted-use controls: **Unknown**. FieldRoutes' own pesticide page covers usage capture, inventory and a dilution calculator, and never mentions restricted-use pesticides (published Apr 8, 2024, older). — [FieldRoutes pesticide tracking blog (2024)](https://www.fieldroutes.com/blog/pest-control-pesticide-usage-tracking-apps)
- CMP-03 applicator license tracking: **Partial**. Routing considers technician "qualifications for jobs like termite inspections". No license numbers, categories or expiry alerts are documented. — [FieldRoutes routing page](https://www.fieldroutes.com/operations-suite/field-service-routing)
- CMP-02 catalog with EPA numbers, labels and SDS: **Unknown**. The vendor pesticide page has no EPA registration numbers, labels or SDS. — [FieldRoutes pesticide tracking blog (2024)](https://www.fieldroutes.com/blog/pest-control-pesticide-usage-tracking-apps)
- SCH-04 license or skill based assignment: **Yes, for skills**. The routing page says "Organize routes based on skillset and take into account their qualifications for jobs like termite inspections", and the termite page has "Route By Technician Skillset". The Dec 9, 2025 release also limits the mobile schedule view to technicians a rep is permitted to book. Licenses are not checked for validity. — [Routing page](https://www.fieldroutes.com/operations-suite/field-service-routing); [Dec 2025 release](https://www.fieldroutes.com/blog/fieldroutes-december-release-driving-new-efficiency-in-the-field-and-office)
- ACC-01 built-in general ledger: **No**. The vendor positions a "QuickBooks Online Integration" for accounting, and the Ignite 2026 announcements contain no ledger features. — [pest control software page](https://www.fieldroutes.com/solutions/pest-control-software); [baseline source: API and integrations page](https://www.fieldroutes.com/operations-suite/api-integrations)
- ACC-04 deferred revenue: **Unknown**. The Ignite 2026 release promises "enhancements to billing, prepayments, autopay" but says nothing about deferred revenue or recognition. — [Ignite 2026 release (StockTitan copy)](https://www.stocktitan.net/news/TTAN/field-routes-to-unveil-next-phase-of-product-innovation-at-ignite-p5x81stcr2wc.html)
- BIL-07 prorated refunds and cancellation billing: **Unknown**. Neither the payments page nor the Dec 2025 release mentions proration, refunds or cancellation balances. The Dec 2025 release does add enforcement of minimum contract lengths in the field. — [FieldRoutes payments page](https://www.fieldroutes.com/operations-suite/payments); [Dec 2025 release](https://www.fieldroutes.com/blog/fieldroutes-december-release-driving-new-efficiency-in-the-field-and-office)
- AGR-07 re-service and callback tracking: **Unknown**. The pest software page and payments page do not mention re-services or callbacks, and no help-center article was publicly findable. — [pest control software page](https://www.fieldroutes.com/solutions/pest-control-software)
- AGR-02 seasonal programs and rounds: **Partial** (baseline, third-party source). Rounds are modeled as subscriptions. The vendor page mentions "mosquito season" only as a door-to-door sales use case. — [baseline: Integrate IQ comparison](https://integrateiq.com/comparisons/realgreen-vs-fieldroutes/); [pest control software page](https://www.fieldroutes.com/solutions/pest-control-software)
- AGR-03 price book with tiers and add-ons: **Partial** (baseline). Bundled plans and measurement-based pricing are reported, with no central tiered price book. The vendor page says only "a pricing structure that empowers growth". — [baseline: Landscape Management](https://www.landscapemanagement.net/fieldroutes-expands-software-service-into-lawn-care/); [pest control software page](https://www.fieldroutes.com/solutions/pest-control-software)
- RPT-02 retention and churn analytics: **Unknown, announced as upcoming**. The Oct 8, 2026 Ignite release lists "Revenue Retention (upcoming)", described as data-driven indicators of potential churn. It gives no date, and the release's forward-looking statements say upcoming features may not arrive "at all". — [Ignite 2026 release (StockTitan copy)](https://www.stocktitan.net/news/TTAN/field-routes-to-unveil-next-phase-of-product-innovation-at-ignite-p5x81stcr2wc.html); [original GlobeNewswire release](https://www.globenewswire.com/news-release/2026/10/08/3377127/0/en/fieldroutes-to-unveil-next-phase-of-product-innovation-at-ignite-2026.html)

**ServSuite** (no new 2025 or 2026 vendor documentation found; the current vendor page lists no compliance or accounting features)
- CMP-08, CMP-05, CMP-06, CMP-03, CMP-02: **Unknown**. Neither the vendor page nor the 2025–2026 App Store notes mention Wisconsin, notices, RUP or licenses. The only related item is a Nov 4, 2025 fix for "missing registration number display", with no context on whether it means EPA registration. — [ServSuite page](https://www.fieldroutes.com/servsuite-by-fieldroutes); [ServSuite Mobile, App Store](https://apps.apple.com/us/app/servsuite-mobile/id534271165)
- SCH-04, AGR-02, AGR-03, AGR-07, BIL-07, ACC-04, RPT-02: **Unknown**, with no public evidence. — [baseline: Capterra ServSuite feature list](https://capterra.com/p/25008/ServSuite/)
- ACC-01: **Unknown**, leaning No. Review sites list a QuickBooks integration instead of a ledger. — [baseline: Capterra ServSuite](https://capterra.com/p/25008/ServSuite/)

### Inferences
- The PRD's wedge counts in the positioning table hold for both products today. For ServSuite they rest on missing documentation, not on vendor statements, so "no full support documented" is more accurate than "does not support".
- RPT-02 should be reworded in the PRD from "0 competitors" to "0 shipped; FieldRoutes announced churn-risk indicators in Oct 2026". FieldRoutes' framing is predictive churn signals. Bugsy can still differ with retention by service line, technician and route tied to cancellation reasons, which the PRD already proposes in spec 12.
- SCH-04 is a weak differentiator against FieldRoutes on its own. Bugsy's real edge is hard blocking on license validity, category and expiry (spec 05 and spec 07), which FieldRoutes does not document.
- The Ignite "prepayments" work could move toward deferred-revenue handling. Watch the next FieldRoutes release notes.

### Gaps
- FieldRoutes help center content (re-service, cancellation proration, product catalog fields) appears to be login-gated or not indexed. Statuses marked Unknown could be Partial in practice.
- I could not confirm whether FieldRoutes product records hold EPA registration numbers (for example through the API schema). No public developer docs were found in this pass.

## 3. PRD table-stakes claims

### Takeaway
FieldRoutes meets every table-stakes item the PRD lists, all documented by the vendor, and its on-the-way support is stronger than the baseline's Partial. ServSuite meets mobile app and field payments with 2025–2026 evidence. Its dispatch board, autopay and reports rest on older sources, and its portal and on-the-way messaging are email-only or partial.

### Cited Findings
**FieldRoutes**
- SCH-02 dispatch board with map: **Yes**. "Build technician routes by clicking, dragging, and dropping." Jobs can be scheduled "using an interactive map view or automatic bulk optimization." — [pest control software page](https://www.fieldroutes.com/solutions/pest-control-software)
- MOB-01 mobile app: **Yes**. The FieldRoutes app (developer PestRoutes LLC) is on iOS and is rated 3.3 from 25 ratings. Releases were frequent through 2026, the latest being 1.25.3 in late Oct 2026. — [FieldRoutes App Store](https://apps.apple.com/us/app/-/id1583053577)
- MOB-06 field payments: **Yes (card)**. Version 1.25.2 (Oct 19, 2026) says "Credit card payments started offline stay pending to help prevent duplicate charges," and the Dec 2025 release revamped door-to-door payments. Cash and check are not documented. — [App Store](https://apps.apple.com/us/app/-/id1583053577); [Dec 2025 release](https://www.fieldroutes.com/blog/fieldroutes-december-release-driving-new-efficiency-in-the-field-and-office)
- BIL-02 autopay: **Yes**. "Provide customers with AutoPay." AutoPay is on by default for new door-to-door sign-ups (Dec 2025). — [pest control software page](https://www.fieldroutes.com/solutions/pest-control-software); [Dec 2025 release](https://www.fieldroutes.com/blog/fieldroutes-december-release-driving-new-efficiency-in-the-field-and-office)
- RPT-01 standard reports: **Yes**. The vendor advertises "Real-time numbers, portrayed in graphs and charts", and the Dec 2025 release lets users save custom filters across 15 reports. Reviewers still call reporting limited (section 7). — [pest control software page](https://www.fieldroutes.com/solutions/pest-control-software); [Dec 2025 release](https://www.fieldroutes.com/blog/fieldroutes-december-release-driving-new-efficiency-in-the-field-and-office)
- CX-02 reminders and on-the-way: **Yes, upgraded from the baseline's Partial**. Reminders go by "text messages and phone calls", and app 1.23.2 (Jun 17, 2026, inferred year) added "'On my way' for multi-service appointments", which implies an existing On-my-way action. The page does not say whether that action sends a text. — [pest control software page](https://www.fieldroutes.com/solutions/pest-control-software); [App Store](https://apps.apple.com/us/app/-/id1583053577)
- CX-01 customer portal: **Yes**. Customers "pay invoices when and where they want with the FieldRoutes online portal" and "check their payment history". — [pest control software page](https://www.fieldroutes.com/solutions/pest-control-software); [payments page](https://www.fieldroutes.com/operations-suite/payments)
- MOB-02 offline mode depth: **Yes, but the depth is undocumented**. Version 1.23.2 added offline photo queuing and retry. Version 1.25.2 (Oct 19, 2026) improved "offline reliability", syncing, offline appointment edits and connection status, and keeps offline card payments pending. An App Store review on Oct 2, 2026 reports "documents not saving" and reports "wiped by auto-sync". — [FieldRoutes App Store](https://apps.apple.com/us/app/-/id1583053577)

**ServSuite**
- MOB-01: **Yes**. There are phone and tablet apps, with fix releases through Oct 2026, rated 1.0 from 13 ratings. — [ServSuite Mobile, App Store](https://apps.apple.com/us/app/servsuite-mobile/id534271165)
- MOB-06: **Yes**. 2025–2026 release notes fix check-payment email receipts, credit card invoice payments and Worldpay sync of declined transactions. — [ServSuite Mobile, App Store](https://apps.apple.com/us/app/servsuite-mobile/id534271165)
- MOB-02: **Partial**. Version 20.12.106 (Jul 6, 2026, inferred) fixed "payment processing button states when offline". Full offline completion is not documented, and a review on 12/12/2025 says the app is "unusable during sync". — [ServSuite Mobile, App Store](https://apps.apple.com/us/app/servsuite-mobile/id534271165)
- SCH-02: **Yes, older source only**. Visual map routing appears in the 2016 PestWorld exhibit listing. — [PMP 2016 exhibit PDF (older)](https://www.mypmp.net/wp-content/uploads/2016/10/ServicePro_PestWorld_Exhibits_2016.pdf)
- BIL-02 and RPT-01: **Yes, older or undated vendor-sponsored sources only**. — [PPM sponsored article](https://professionalpestmanager.com/nz/?p=10938); [PMP Oct 2021 (older)](https://editions.mydigitalpublication.com/article/ServicePro/4130998/724108/article.html)
- CX-02: **Partial**. The app sends on-my-way emails, and text reminders are not confirmed (baseline). — [ServSuite Mobile, App Store](https://apps.apple.com/us/app/servsuite-mobile/id534271165)
- CX-01: **Partial**. The E-Connect portal shows services and payments, and online payment is not confirmed (baseline, undated). — [PPM sponsored article](https://professionalpestmanager.com/nz/?p=10938)

### Inferences
- For FieldRoutes, the PRD's "8 of 8" table-stakes counts and its CX-01 and CX-02 counts hold, and FieldRoutes counts toward them. Recounting CX-02 with FieldRoutes as Yes may raise the PRD's "5 of 8" if the baseline scored FieldRoutes as Partial. Recheck the crosswalk.
- FieldRoutes' 2026 release notes show offline is still being hardened in Oct 2026, and an Oct 2026 review reports sync data loss. Bugsy's NFR (durable on device, idempotent sync, a full day offline) is a credible differentiator if it is demonstrated, not just claimed.

### Gaps
- Whether FieldRoutes' "On my way" sends an SMS to the customer is not stated on the vendor pages I could reach.
- FieldRoutes cash and check capture in the app: not documented.

## 4. FieldRoutes state regulatory reports

### Takeaway
No change. The vendor names only California Branch 3 (WDO) and the national NPMA-33 form, plus generic "state chemical reports" with no states named. I found nothing new in 2025 or 2026, and nothing for Wisconsin.

### Cited Findings
- "Specifically designed for California Branch 3 Structural Pest Control for WDOs", and "In states using NPMA's Standard National Wood Destroying Insect (WDI) Report form NPMA-33, FieldRoutes provides a paperless, pre-built form". The page does not mention Texas, Florida, Arizona or Wisconsin. — [FieldRoutes termite page](https://www.fieldroutes.com/solutions/termite-pest-control)
- Office staff can "pull reports related to products, such as inventory, chemical tracking, and state chemical reports". No states are named, and the page was published Apr 8, 2024 (older). — [FieldRoutes pesticide tracking blog (2024)](https://www.fieldroutes.com/blog/pest-control-pesticide-usage-tracking-apps)
- The pest page ties "maintaining compliance and license renewals with NPMA-33 access" to Sentricon. — [pest control software page](https://www.fieldroutes.com/solutions/pest-control-software)
- Neither the Dec 2025 release nor the Ignite 2026 release mentions compliance or state reports. — [Dec 2025 release](https://www.fieldroutes.com/blog/fieldroutes-december-release-driving-new-efficiency-in-the-field-and-office); [Ignite 2026 (StockTitan)](https://www.stocktitan.net/news/TTAN/field-routes-to-unveil-next-phase-of-product-innovation-at-ignite-p5x81stcr2wc.html)

### Inferences
- The PRD's "California WDO (FieldRoutes)" is accurate. NPMA-33 is a national lender form, not a state report, so the PRD is right not to count it as state support.
- FieldRoutes' 2025–2026 roadmap (AI, dispatch, billing, retention) shows no compliance investment. A Wisconsin-specific feature from FieldRoutes in the near term looks unlikely.

### Gaps
- What the generic "state chemical reports" contain and which state formats they match: could not verify (help center not reachable).

## 5. Current pricing (2025–2026)

### Takeaway
FieldRoutes still publishes no prices. It has Growth and Corporate tiers, both "Request Pricing", billed by active customers. Third-party listings in 2026 put the entry price at $350 a month, which G2 qualifies as "per 1,000 active customers"; older listings say $199. Marketing Pro and Fleet Pro (GPS) are separate add-ons with no published prices. Reviewers report per-message SMS fees and lock-in to the payment processor. I could not reverify ServSuite's "$55 per user".

### Cited Findings
- Vendor: two packages, Growth ("Ideal for Small Businesses") and Corporate ("Perfect for Scaling"), both "Request Pricing". "The monthly subscription is based on the number of active customers." Both list the same 10 included features: mobile sales, commercial trend reporting, Premium API, route optimization, technician app, automated communication and reminders, lead management, customer payment portal, real-time reporting and Sentricon. There is no free trial. The page is undated (© 2026). — [FieldRoutes pricing](https://fieldroutes.com/pricing)
- Add-ons named on the pricing page with no prices: Marketing Pro (marketing automation) and Fleet Pro (fleet and GPS). — [FieldRoutes pricing](https://fieldroutes.com/pricing); [Fleet Pro](https://www.fieldroutes.com/pro/fleet)
- G2 (2026): "starting at $350.00 per month per 1,000 active customers". This is a search snippet, since G2 blocked a direct fetch. — [G2 FieldRoutes pricing](https://www.g2.com/products/fieldroutes-a-servicetitan-company/pricing)
- Capterra and Software Advice list the same $350 starting price (search snippet). — [Capterra FieldRoutes pricing](https://www.capterra.com/p/146076/FieldRoutes/pricing/); [Software Advice](https://www.softwareadvice.com/field-service/pestroutes-profile/)
- Older or conflicting figure: $199 a month, which Slashdot ties to the first 1,000 active customers (search snippet). — [SoftwareConnect](https://softwareconnect.com/reviews/fieldroutes/); [Slashdot](https://slashdot.org/software/p/FieldRoutes/)
- A third-party "alternatives" article reports $199 to $350+ a month and implementation fees "from $1,300". It is secondhand and was seen only in a search snippet. — [Service Business Academy (2026)](https://servicebusinessacademy.org/best-fieldroutes-alternatives-pest-control-2026/)
- A review roundup "accurate as of September 2026" cites Capterra reviewers on "per-message fees" and "payment-processing lock-in", with no amounts. — [One House Marketing FieldRoutes review (Oct 12, 2026)](https://onehousemarketing.com/fieldroutes-review/)
- ServSuite: G2 says the vendor has not published pricing. — [G2 ServSuite pricing](https://g2.com/products/servsuite-by-fieldroutes/pricing). The baseline "$55 per user per month" (Capterra) could not be reverified because Capterra blocked the fetch. — [Capterra ServSuite (baseline)](https://www.capterra.com/p/25008/ServSuite/reviews/)

### Inferences
- If G2's "per 1,000 active customers" is right, a residential company with 1,500 to 2,500 recurring customers (a plausible 5 to 8 technician firm) could pay well above $350, for example around $700 or more, before SMS and processing. That estimate assumes linear scaling, which is not sourced. It still puts Bugsy's $632 to $792 for 8 technicians in the same range, not clearly cheaper.
- Fees for SMS (reviewer-reported) and GPS (a separate Fleet Pro product) support the PRD's "add-on fees" complaint and its all-inclusive positioning.

### Gaps
- No vendor-dated FieldRoutes price, no per-customer increments, no SMS per-message rate and no processing rates found.
- ServSuite current price: could not verify.

## 6. Product changes in 2025–2026 and ServiceTitan corporate news

### Takeaway
In 2025 and most of 2026, FieldRoutes focused on reliability and incremental workflow fixes: door-to-door sales controls, report filters, Sentricon renewals, offline hardening and photos. At Ignite on Oct 8, 2026, it announced an AI "Command Center", "Revenue Retention" churn signals and intelligent same-day dispatch, all labeled upcoming. ServiceTitan's Sept 2026 earnings call did not mention FieldRoutes, and the company is prioritizing its AI "Max" platform over expansion into new trades.

### Cited Findings
- Dec 9, 2025 release: mobile scheduling limited to permitted technicians; door-to-door payment revamp with AutoPay on by default; field-level access controls for tax-exempt status, billing settings and contract terms, including minimum contract lengths; zip-code territories; bulk task and alert updates; saved filters across 15 reports; Sentricon renewal report filters. — [Dec 2025 release](https://www.fieldroutes.com/blog/fieldroutes-december-release-driving-new-efficiency-in-the-field-and-office)
- 2026 app releases. 1.23.2 (Jun 17): up to 100 photos with offline queuing, map clustering, inline signatures, On-my-way for multi-service appointments, default product button, Bluetooth scanner. 1.24.2 (Sep 8): resume where you left off, sales dashboard tab, linear-footage products. 1.25.2 (Oct 19): offline reliability and pending offline card payments. Most other 2025–2026 versions are "bug fixes only". — [FieldRoutes App Store](https://apps.apple.com/us/app/-/id1583053577)
- Ignite 2026 (Oct 8, 2026, Orlando). The release says FieldRoutes spent 18 months on "reliability, architecture, data infrastructure, and core workflows". Upcoming: an AI Command Center (conversational analytics, customizable dashboards, proactive monitoring), Revenue Retention (churn indicators) and intelligent dispatch to fill same-day openings. Also announced: improvements to route visibility, map performance and scheduling, and enhancements to billing, prepayments, autopay, territory management and sales controls. The release gives no dates. Spokesperson: Scott Traina, "General Manager of Property Care at ServiceTitan". — [Ignite 2026 (StockTitan)](https://www.stocktitan.net/news/TTAN/field-routes-to-unveil-next-phase-of-product-innovation-at-ignite-p5x81stcr2wc.html)
- The FieldRoutes site carries the teasers "Atlas-powered Command Center is coming to FieldRoutes" and a PestWorld item on "a staged AI rollout" for ServiceTitan's Property Care. — [pest control software page](https://www.fieldroutes.com/solutions/pest-control-software); [ServSuite page](https://www.fieldroutes.com/servsuite-by-fieldroutes)
- ServiceTitan also announced a Command Center for Aspire (landscape) at the same Ignite 2026. — [Aspire Command Center release](https://www.globenewswire.com/news-release/2026/10/08/3377130/0/en/aspire-to-unveil-command-center-at-ignite-2026-bringing-ai-powered-insights-and-action-together-for-landscape-contractors.html)
- PestWorld 2025 (Oct 15, 2025). Dylan Henryson was "general manager, FieldRoutes". FieldRoutes customers grew at a median rate 1.5x faster than non-FieldRoutes companies (2025 PCT Top 100 data). The release cites ServiceTitan's "Titan Intelligence" AI and a continued NPMA Strategic Partnership. — [PestWorld 2025 release (Finviz)](https://finviz.com/news/193322/fieldroutes-showcases-continued-customer-growth-and-future-vision-at-pestworld-2025)
- ServiceTitan fiscal Q2 2027 (quarter ended Jul 31, 2026, reported Sep 8, 2026): revenue $292.8M, up 21%; FY2027 revenue guidance $1.139–1.144B. Management is prioritizing its "Max" agentic operating system and pausing expansion into new trades. The call did not mention FieldRoutes, pest control, ServSuite, Aspire or Command Center. — [Motley Fool transcript](https://www.fool.com/earnings/call-transcripts/2026/09/09/servicetitan-ttan-q2-2027-earnings-call-transcript/); [8-K summary (StockTitan)](https://www.stocktitan.net/sec-filings/TTAN/8-k-service-titan-inc-reports-material-event-f44e975b3277.html)
- FieldRoutes published a vendor "2026 Pest Control Industry Report" (July 2026, 1,000+ operators surveyed, covering material costs and AI adoption). It was seen in search only and not fetched. — [FieldRoutes 2026 industry report](https://www.fieldroutes.com/resources/reports/pest-control-industry-report); [Yahoo Finance coverage](https://finance.yahoo.com/small-business/articles/fieldroutes-report-finds-growth-optimism-130000494.html)

### Inferences
- The FieldRoutes spokesperson changed from "GM, FieldRoutes" (Oct 2025) to "GM of Property Care at ServiceTitan" (Oct 2026), and Command Center launched in parallel for Aspire. Together these suggest FieldRoutes now sits in a combined Property Care unit with shared AI tooling. That is inference from titles, not a stated reorganization.
- Pest is not a headline topic in ServiceTitan's earnings, and corporate focus is on Max for the core trades. FieldRoutes is unlikely to get a large compliance build-out soon; its roadmap is AI analytics and revenue workflows.
- The PRD lists AI features as a non-goal for Phase 1. FieldRoutes' AI work is mostly announced, not shipped, so this is not yet a table-stakes gap, but it will be a sales objection.

### Gaps
- GA dates for Command Center, Revenue Retention and intelligent dispatch: not published. One search summary claimed a FieldRoutes blog said Command Center "launched" at Ignite, which conflicts with the "upcoming" press release. I could not verify that blog.
- 10-Q or 10-K segment commentary on FieldRoutes: not checked on EDGAR in this pass. The earnings call was silent on it.

## 7. Review sentiment 2025–2026

### Takeaway
FieldRoutes has mostly positive aggregate ratings (about 4.2 to 4.3 out of 5 on Capterra and GetApp, with 337 to 404 reviews) and a weak mobile app rating (3.3 on the App Store). Repeated complaints are support responsiveness, glitches and freezing, updates that remove features, a mobile app that lags the desktop, limited reporting, and fees and processor lock-in. ServSuite's ratings are poor (G2 3.1, App Store 1.0), with complaints about an outdated system and slow, crashing sync.

### Cited Findings
- Capterra US: FieldRoutes 4.2 (337 reviews), ease of use 4.1, customer service 4.2, page updated Mar 13, 2026 (search snippet). — [Capterra FieldRoutes reviews](https://capterra.com/p/146076/FieldRoutes/reviews/). Conflicting count: "84% positive based on 404 user reviews". — [Capterra FieldRoutes](https://www.capterra.com/p/146076/FieldRoutes/); Capterra AU shows 84% positive, 9% neutral and 7% negative. — [Capterra AU](https://www.capterra.com.au/software/146076/fieldroutes)
- GetApp comparison (2026, snippet): FieldRoutes 4.3 out of 5 (400 reviews) vs ServSuite 2.5 out of 5 (2 reviews). — [GetApp AU compare](https://www.getapp.com.au/compare/104739/111327/servsuite/vs/pestroutes)
- A 2026 Capterra reviewer rated FieldRoutes 2.0 and said they "invested a lot of time building workarounds". Another 2026 reviewer said the transition was smooth. Other themes: customer support ("good luck getting any help"), limited reporting, and mobile app hard to use (search snippet). — [Capterra FieldRoutes reviews](https://capterra.com/p/146076/FieldRoutes/reviews/)
- A review roundup "accurate as of September 2026" lists cons: support responsiveness, "Mobile app lags the desktop, with functionality gaps and Android crash reports", long implementations, payment-processing lock-in and per-message fees, and no Zapier. Pros: routing, automated text, email and voice, branded payment portal, review capture, dashboards. — [One House Marketing (Oct 12, 2026)](https://onehousemarketing.com/fieldroutes-review/)
- FieldRoutes App Store (3.3 from 25 ratings). Oct 2, 2026: "Worst App 4 years in a row!" (documents not saving, crashes, reports wiped by auto-sync). Sep 9, 2026: an update removed the daily production value; the developer promised a fix on Sep 16. Aug 13, 2026: praise for scheduling. Jan 9, 2026: an "11 year tech", positive overall but complaining of lag. — [FieldRoutes App Store](https://apps.apple.com/us/app/-/id1583053577)
- G2 ServSuite: 3.1 out of 5 (17 reviews). Praise for ease of use and the support team; complaints of slowness (search snippet; most reviews older). — [G2 ServSuite](https://www.g2.com/products/servsuite-by-fieldroutes/reviews)
- ServSuite App Store (1.0 from 13 ratings). Dec 12, 2025: "outdated" system, slow sync with the app unusable during sync, required-field forms hard to navigate. Aug 12 (2026, inferred): frequent crashes, job information fails to load, jobs not sorted within time slots. — [ServSuite Mobile, App Store](https://apps.apple.com/us/app/servsuite-mobile/id534271165)
- Reddit r/pestcontrol: could not access (reddit.com is blocked for the research crawler).

### Inferences
- The PRD's category complaints are confirmed for FieldRoutes in 2026 sources: bugs after updates, opaque pricing with add-on fees (SMS, GPS through Fleet Pro, processing lock-in) and weak reporting.
- ServSuite users' main pain is dated software and unreliable mobile sync. That matches Bugsy's offline-first technician app and a modern UI as the pitch to them.

### Gaps
- No verified 2025–2026 G2 rating for FieldRoutes (G2 blocked).
- Reddit sentiment: could not verify.
- The Capterra review count conflicts (337 vs 404) because the snippets come from different snapshots.

## 8. Evidence of Wisconsin customers

### Takeaway
This contradicts the baseline for both products. A Madison, Wisconsin pest company, Kwik Kill Pest Control, was a ServSuite customer (from 2013) and moved to FieldRoutes in 2023, according to a FieldRoutes case study. So FieldRoutes and ServSuite do have Wisconsin pest customers, even though neither documents Wisconsin compliance.

### Cited Findings
- FieldRoutes case study (published Oct 5, 2023, older): Kwik Kill Pest Control of Madison, Wisconsin used ServSuite from 2013. Operations manager Breanna Neerland demoed at PestWorld in Oct 2022, went live on FieldRoutes by the end of March 2023, called the transition "a cakewalk", and technicians found the app "So much smoother and more streamlined" than ServSuite's. — [FieldRoutes Kwik Kill case study](https://www.fieldroutes.com/resources/case-studies/kwik-kill-pest-control-case-study); [CaseStudies.com mirror](https://www.casestudies.com/company/fieldroutes-servicetitan/case-study/kwik-kill-pest-control-customer-case-study)
- Kwik Kill independently located in the Madison area: Angi lists it under Verona, WI. Lantern describes it as family-owned since 1979, serving Dane County with insect, rodent and wildlife control and recurring plans, at $39–$60 a month. — [Angi listing](https://angi.com/companylist/us/wi/verona/kwik-kill-pest-control-inc-reviews-5675683.htm); [Lantern listing](https://lantern.llc/b/kwik-kill-pest-control-madison/book)
- No FieldRoutes or ServSuite page names Wisconsin compliance (ATCP 29, landscape registry, posting). — [FieldRoutes termite page](https://www.fieldroutes.com/solutions/termite-pest-control); [ServSuite page](https://www.fieldroutes.com/servsuite-by-fieldroutes)

### Inferences
- Wisconsin operators of Bugsy's target profile (single-branch, residential-first, Dane County) already run FieldRoutes without Wisconsin compliance support. The wedge has to beat a working incumbent, not fill empty space. Kwik Kill would also be a useful interview or reference target for the PRD's 3 to 5 discovery companies.
- Kwik Kill's switch shows that a ServSuite-to-FieldRoutes migration can be easy in the customer's telling. That weakens the "forced migration is a buying moment" argument for any ServSuite user FieldRoutes reaches first.

### Gaps
- No count of Wisconsin FieldRoutes or ServSuite customers found. Whether Kwik Kill is still on FieldRoutes in 2026: could not verify.

## 9. PRD claim verdict tables

### Takeaway
Most PRD claims about FieldRoutes and ServSuite hold. The corrections: (1) Wisconsin customers exist for both products (Kwik Kill, Madison); (2) retention analytics is announced by FieldRoutes, so "0 competitors" will age; (3) the ServSuite sunset is real but has no date, and ServSuite is still maintained with migration incentives; (4) FieldRoutes' "$350" is per 1,000 active customers per G2; (5) ServSuite's "$55 per user" could not be reverified.

### Cited Findings

#### FieldRoutes

| PRD claim | Verdict | Evidence URL |
| --- | --- | --- |
| No competitor shows Wisconsin support (CMP-08 not Yes) | Confirmed (Unknown; Wisconsin never named) | https://www.fieldroutes.com/solutions/termite-pest-control |
| Only state report named is California WDO | Confirmed (CA Branch 3, plus national NPMA-33 and unnamed "state chemical reports", 2024) | https://www.fieldroutes.com/solutions/termite-pest-control ; https://www.fieldroutes.com/blog/pest-control-pesticide-usage-tracking-apps |
| FieldRoutes is sunsetting ServSuite with no public end date | Confirmed (cohort campaign with incentives; product page still says "no change") | https://fieldroutes.com/lp/ss-migration/free-demo ; https://fieldroutes.com/lp/ss-migration/cohort-4/free-demo ; https://www.fieldroutes.com/servsuite-by-fieldroutes |
| CMP-05 automatic pesticide notices: not Yes | Confirmed (Unknown; only appointment and payment reminders) | https://www.fieldroutes.com/solutions/pest-control-software |
| CMP-06 restricted-use controls: not Yes | Confirmed (Unknown) | https://www.fieldroutes.com/blog/pest-control-pesticide-usage-tracking-apps |
| CMP-03 license tracking: not Yes | Confirmed (Partial: qualifications in routing; no license expiry) | https://www.fieldroutes.com/operations-suite/field-service-routing |
| CMP-02 catalog with EPA no., label, SDS: not Yes | Confirmed (Unknown) | https://www.fieldroutes.com/blog/pest-control-pesticide-usage-tracking-apps |
| SCH-04 license or skill assignment: 2 of 8 Yes | Confirmed (FieldRoutes Yes for skills or qualifications; not license validity) | https://www.fieldroutes.com/operations-suite/field-service-routing |
| ACC-01 built-in GL: none | Confirmed (No; QuickBooks Online integration) | https://www.fieldroutes.com/solutions/pest-control-software |
| ACC-04 deferred revenue: none | Confirmed (Unknown; Ignite 2026 promises "prepayments" enhancements only) | https://www.stocktitan.net/news/TTAN/field-routes-to-unveil-next-phase-of-product-innovation-at-ignite-p5x81stcr2wc.html |
| BIL-07 cancellation billing: none | Confirmed (Unknown) | https://www.fieldroutes.com/operations-suite/payments |
| AGR-07 re-service tracking: none | Confirmed (Unknown) | https://www.fieldroutes.com/solutions/pest-control-software |
| AGR-02 seasonal rounds: 1 of 8 Yes (not FieldRoutes) | Confirmed (Partial; third-party source) | https://integrateiq.com/comparisons/realgreen-vs-fieldroutes/ |
| AGR-03 price book with tiers and add-ons: none | Confirmed (Partial) | https://www.landscapemanagement.net/fieldroutes-expands-software-service-into-lawn-care/ |
| RPT-02 retention analytics: none | Partly (none shipped; "Revenue Retention" churn indicators announced as upcoming Oct 8, 2026) | https://www.stocktitan.net/news/TTAN/field-routes-to-unveil-next-phase-of-product-innovation-at-ignite-p5x81stcr2wc.html |
| SCH-02 map dispatch board (table stakes) | Confirmed | https://www.fieldroutes.com/solutions/pest-control-software |
| MOB-01 mobile app | Confirmed | https://apps.apple.com/us/app/-/id1583053577 |
| MOB-06 field payments | Confirmed (card; cash and check undocumented) | https://apps.apple.com/us/app/-/id1583053577 |
| BIL-02 autopay | Confirmed | https://www.fieldroutes.com/blog/fieldroutes-december-release-driving-new-efficiency-in-the-field-and-office |
| RPT-01 standard reports | Confirmed (reviewers call them limited) | https://www.fieldroutes.com/solutions/pest-control-software |
| CX-02 reminders and on-the-way texts | Confirmed (reminders by text and phone; On-my-way in app since at least Jun 2026; SMS delivery of it not stated) | https://www.fieldroutes.com/solutions/pest-control-software ; https://apps.apple.com/us/app/-/id1583053577 |
| CX-01 customer portal | Confirmed | https://www.fieldroutes.com/operations-suite/payments |
| Offline mode depth | Partly (offline work and payments supported and hardened in Oct 2026; full-day depth undocumented; Oct 2026 review reports sync data loss) | https://apps.apple.com/us/app/-/id1583053577 |
| Pricing: active customers, from about $350 a month | Partly (model confirmed by vendor; $350 is third-party and per 1,000 active customers per G2; older $199) | https://fieldroutes.com/pricing ; https://www.g2.com/products/fieldroutes-a-servicetitan-company/pricing |
| Complaints: bugs after updates, opaque pricing, add-on fees (SMS, GPS, processing), weak reporting, no GL | Confirmed (2026 App Store reviews, pricing page, Fleet Pro add-on, review roundup) | https://apps.apple.com/us/app/-/id1583053577 ; https://fieldroutes.com/pricing ; https://onehousemarketing.com/fieldroutes-review/ |
| No Wisconsin customers (baseline, implied by PRD) | Contradicted (Kwik Kill Pest Control, Madison WI, FieldRoutes customer since 2023) | https://www.fieldroutes.com/resources/case-studies/kwik-kill-pest-control-case-study |

#### ServSuite

| PRD claim | Verdict | Evidence URL |
| --- | --- | --- |
| Being sunset by FieldRoutes with no public end date | Confirmed (no date; app still updated Oct 2026; vendor product page says "no change") | https://fieldroutes.com/lp/ss-migration/free-demo ; https://apps.apple.com/us/app/servsuite-mobile/id534271165 ; https://www.fieldroutes.com/servsuite-by-fieldroutes |
| Its users must migrate anyway, so a buying moment | Partly (migration pushed in cohorts with incentives; no forced deadline public; 400+ had moved by 2023) | https://fieldroutes.com/lp/ss-migration/cohort-4/free-demo ; https://www.fieldroutes.com/resources/case-studies/kwik-kill-pest-control-case-study |
| CMP-08 Wisconsin compliance: none | Confirmed (Unknown) | https://www.fieldroutes.com/servsuite-by-fieldroutes |
| CMP-05 notices, CMP-06 RUP, CMP-03 licenses, CMP-02 catalog: none | Confirmed (Unknown; only a Nov 2025 "registration number display" app fix) | https://apps.apple.com/us/app/servsuite-mobile/id534271165 |
| SCH-04 license or skill assignment: not ServSuite | Confirmed (Unknown) | https://capterra.com/p/25008/ServSuite/ |
| ACC-01 GL, ACC-04 deferred revenue: none | Confirmed (Unknown; QuickBooks integration listed) | https://capterra.com/p/25008/ServSuite/ |
| BIL-07, AGR-07, AGR-02, AGR-03, RPT-02: none | Confirmed (Unknown; no public documentation) | https://capterra.com/p/25008/ServSuite/ |
| SCH-02 map dispatch board | Partly (only older 2016 source) | https://www.mypmp.net/wp-content/uploads/2016/10/ServicePro_PestWorld_Exhibits_2016.pdf |
| MOB-01 mobile app | Confirmed | https://apps.apple.com/us/app/servsuite-mobile/id534271165 |
| MOB-06 field payments | Confirmed (card and check; 2025–2026 release notes) | https://apps.apple.com/us/app/servsuite-mobile/id534271165 |
| BIL-02 autopay | Partly (older or undated sponsored source) | https://professionalpestmanager.com/nz/?p=10938 |
| RPT-01 standard reports | Partly (2021 source, older) | https://editions.mydigitalpublication.com/article/ServicePro/4130998/724108/article.html |
| CX-02 reminders and on-the-way texts | Partly (on-my-way emails; texts unconfirmed) | https://apps.apple.com/us/app/servsuite-mobile/id534271165 |
| CX-01 customer portal | Partly (E-Connect shows services and payments; online pay unconfirmed) | https://professionalpestmanager.com/nz/?p=10938 |
| Offline mode depth | Partly (offline payment-state fix in Jul 2026; Dec 2025 review says unusable during sync) | https://apps.apple.com/us/app/servsuite-mobile/id534271165 |
| Pricing: per user, from $55 per user a month | Could not verify (Capterra blocked; G2 says no published pricing) | https://g2.com/products/servsuite-by-fieldroutes/pricing |
| No Wisconsin customers (baseline) | Contradicted (Kwik Kill, Madison WI, on ServSuite 2013–2023) | https://www.fieldroutes.com/resources/case-studies/kwik-kill-pest-control-case-study |

### Inferences
- Suggested PRD edits: (a) in "Why now", soften "must migrate anyway" to "is being pushed to migrate, with FieldRoutes incentives and no public deadline"; (b) mark RPT-02 as "announced by FieldRoutes (Oct 2026), not shipped"; (c) in the pricing table, write FieldRoutes as "from about $350 a month per 1,000 active customers (G2, 2026)" and flag ServSuite's $55 as unverified; (d) note that Wisconsin firms already run FieldRoutes, and add Kwik Kill as a possible interview target.

### Gaps
- ServSuite status for most wedge features rests on the absence of public documentation, not on vendor confirmation. A demo or a customer interview would settle it.
