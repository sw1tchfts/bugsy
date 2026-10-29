# Wisconsin pest control market: size, operators, software and channels (as of October 29, 2026)

Scope notes for the report writer:
- Census and BLS figures use NAICS 561710 (Exterminating and Pest Control Services). That code excludes lawn care and landscaping (NAICS 561730), so these figures are pest-control-only. DATCP license counts cannot be split the same way, and each DATCP figure below says so.
- The Census API now requires a registered key, so every Census figure was computed from the public flat files on www2.census.gov, linked below. BLS QCEW figures come from the open QCEW CSV API. The calculations (sums, shares, averages) are mine and are labeled where they appear.
- "Could not verify" means a public source was not reachable or did not exist. Nothing below is estimated without a label.

## 1. How many pest control businesses, establishments, employees and technicians operate in Wisconsin, and how do they split by size?

### Takeaway
Wisconsin pest control is a small market: 146 employer firms with $148.4M in receipts (2022), plus 269 nonemployer one-person businesses with $16.0M (2024), and about 1,550 employees on average in 2025. Six national firms took 48% of employer receipts in 2022. The independent segment the PRD targets (roughly 5 to 25 employees) is about 32 to 37 firms.

### Cited Findings
**Establishments and employees (County Business Patterns, establishment level)**
- CBP 2023 (latest posted; the 2024 state file returned 404 on Oct 29, 2026), Wisconsin NAICS 561710: 184 establishments, 1,121 employees (mid-March), annual payroll $63.517M, Q1 payroll $12.792M — [Census CBP 2023 state file](https://www2.census.gov/programs-surveys/cbp/datasets/2023/cbp23st.zip)
- CBP 2023 size split by establishment employment: <5 employees: 122 establishments (148 employees); 5-9: 27 (175); 10-19: 20 (278); 20-49: 13 (350); 50 and over: 2 establishments, with counts suppressed (about 170 employees by subtraction) — [Census CBP 2023](https://www2.census.gov/programs-surveys/cbp/datasets/2023/cbp23st.zip)
- CBP 2023 by legal form: C-corporations 29 establishments with 383 employees, including 9 of the 13 establishments with 20-49 employees (230 employees); S-corporations 105 establishments with 551 employees (69 <5, 18 at 5-9, 14 at 10-19, 3 at 20-49); sole proprietorships 27 establishments with 29 employees; partnerships 22 establishments with 158 employees (13 <5, 4 at 5-9, 4 at 10-19) — [Census CBP 2023](https://www2.census.gov/programs-surveys/cbp/datasets/2023/cbp23st.zip)
- CBP 2022 for comparison: 161 establishments, 974 employees, $51.108M payroll; <5: 107, 5-9: 24, 10-19: 16, 20-49: 12, 2 suppressed — [Census CBP 2022 state file](https://www2.census.gov/programs-surveys/cbp/datasets/2022/cbp22st.zip)
- CBP 2023 neighbors (establishments / employees / average employees per establishment): Wisconsin 184 / 1,121 / 6.1; Minnesota 104 / 1,321 / 12.7; Illinois 395 / 3,444 / 8.7; Michigan 259 / 1,900 / 7.3; Iowa 146 / 818 / 5.6 — [Census CBP 2023](https://www2.census.gov/programs-surveys/cbp/datasets/2023/cbp23st.zip)

**Firms, receipts and size by enterprise (Statistics of U.S. Businesses 2022, latest; SUSB size classes use the firm's total national employment)**
- Wisconsin 561710 total: 146 firms, 161 establishments, 974 employees, $51.108M payroll, $148.354M receipts — [Census SUSB 2022 state 6-digit table](https://www2.census.gov/programs-surveys/susb/tables/2022/us_state_6digitnaics_2022.txt)
- By enterprise size (firms / Wisconsin employees / Wisconsin receipts): <5 employees: 102 / 135 / $21.483M; 5-9: 19 / 125 / $16.594M; 10-19: 13 / 183 / $23.269M; 20-99: 5 / 148 / $15.265M; 500+: 6 firms with 21 establishments / 378 / $71.220M. Total <500: 140 firms / 596 / $77.134M — [Census SUSB 2022](https://www2.census.gov/programs-surveys/susb/tables/2022/us_state_6digitnaics_2022.txt)
- United States 561710, 2022: 13,603 firms, 16,080 establishments, 139,917 employees, $19.564B receipts; 500+ firms held 42.6% of receipts — [Census SUSB 2022 detailed sizes](https://www2.census.gov/programs-surveys/susb/tables/2022/us_state_naics_detailedsizes_2022.txt)
- Neighbor states, SUSB 2022 (firms / receipts / share of receipts held by 500+ firms): Minnesota 99 / $200.7M / 62%; Illinois 330 / $527.1M / 45%; Michigan 219 / $274.1M / 45%; Iowa 122 / $103.5M / 38%; Wisconsin 146 / $148.4M / 48% — [Census SUSB 2022](https://www2.census.gov/programs-surveys/susb/tables/2022/us_state_6digitnaics_2022.txt)

**Nonemployers (one-person businesses with no payroll; published only at 5-digit NAICS 56171, which contains only 561710)**
- 2024 (latest): 269 Wisconsin nonemployer establishments with $16.031M receipts, an average of about $60K; 248 of them are sole proprietorships ($14.138M) — [Census Nonemployer Statistics 2024 state file](https://www2.census.gov/programs-surveys/nonemployer-statistics/datasets/2024/historical-datasets/nonemp24st.zip)
- 2023: 252 nonemployers, $14.918M receipts — [Census Nonemployer Statistics 2023](https://www2.census.gov/programs-surveys/nonemployer-statistics/datasets/2023/historical-datasets/nonemp23st.zip)
- 2024 neighbors (nonemployers / average receipts): Illinois 347 / $43K; Michigan 327 / $48K; Minnesota 162 / $44K; Iowa 179 / $61K — [Census NES 2024](https://www2.census.gov/programs-surveys/nonemployer-statistics/datasets/2024/historical-datasets/nonemp24st.zip)

**Employment trend and technicians (BLS QCEW, private ownership, monthly employment)**
- Wisconsin 561710 average monthly employment: 1,250 (2023), 1,459 (2024), 1,550 (2025); total wages $64.8M (2023), $80.0M (2024), $89.0M (2025); 179 to 185 establishments per quarter in 2025. Averages and totals are my sums of the monthly and quarterly values — [BLS QCEW 2025 Q1 CSV](https://data.bls.gov/cew/data/api/2025/1/industry/561710.csv) (also [Q2](https://data.bls.gov/cew/data/api/2025/2/industry/561710.csv), [Q3](https://data.bls.gov/cew/data/api/2025/3/industry/561710.csv), [Q4](https://data.bls.gov/cew/data/api/2025/4/industry/561710.csv), and the same paths for 2023 and 2024)
- Average annual pay per Wisconsin 561710 job, 2025 (wages divided by average employment): about $57,500, against about $59,300 nationally — [BLS QCEW 2025](https://data.bls.gov/cew/data/api/2025/1/industry/561710.csv)
- Nationally, BLS OEWS counted 89,070 pest control workers (SOC 37-2021) inside NAICS 561710 in May 2023. This comes from a search-result snippet; the BLS page returned 403 when fetched directly — [BLS OEWS May 2023, NAICS 561710](https://www.bls.gov/oes/2023/may/naics5_561710.htm)
- No Wisconsin-specific OEWS count of pest control workers could be retrieved (bls.gov returned 403).

### Inferences
- Wisconsin has about 1.07% of U.S. pest control firms but only 0.76% of receipts and 0.70% of employees (SUSB 2022). Its average establishment is half the size of Minnesota's (6.1 versus 12.7 employees, CBP 2023).
- Technicians: OEWS May 2023 national pest control workers (89,070) divided by QCEW 2023 national average employment (147,231) gives about 60%. Applying that share to Wisconsin's 2025 average of 1,550 gives roughly 940 employed technicians, about 805 at the February trough and 1,075 at the June peak. The roughly 269 nonemployer owner-operators come on top. This is an estimate, not a published Wisconsin figure.
- National brands are larger in Wisconsin than nationally: 6 firms with 500+ national employees held 48% of Wisconsin receipts and 39% of employment in 2022, against 43% and 36% for the U.S.
- The market is growing fast: QCEW average employment rose 24% and wages 37% from 2023 to 2025. Part of this may be roll-up entrants (section 3), and QCEW reclassifications can also move these counts.
- Single-branch is the norm among small firms. SUSB firm and establishment counts match exactly in the 5-9 (19 and 19) and 10-19 (13 and 13) classes, so those firms each run one location.

### Gaps
- No 2024 CBP or 2023/2024 SUSB for Wisconsin was posted as of Oct 29, 2026. SUSB receipts are published only for years ending in 2 and 7.
- Census gives no split between residential and commercial work, and no count of firms by number of technicians.
- No Wisconsin OEWS count for SOC 37-2021 could be retrieved.

## 2. How many Wisconsin pesticide business licenses and commercial applicators exist, and how many hold category 7.1 Structural or 7.3 Termite?

### Takeaway
DATCP issued 2,412 pesticide business location licenses and 8,635 individual commercial applicator licenses in 2025, but these cover every for-hire category (agriculture, turf, right-of-way, aquatic, structural). Neither DATCP nor UW PAT publishes counts for 7.1 or 7.3, and the public applicator export link was broken on the day checked. Census counts about 453 pest control establishments, so structural businesses are likely a small fraction of DATCP's 2,412.

### Cited Findings
- DATCP licenses issued (2021 / 2022 / 2023 / 2024 / 2025): pesticide business locations 2,396 / 2,392 / 2,368 / 2,367 / 2,412; individual commercial applicators 7,874 / 7,448 / 7,828 / 7,162 / 8,635; reciprocal 466 / 513 / 419 / 417 / 387; restricted-use dealers 391 / 350 / 381 / 384 / 382 — [DATCP Bureau of Agrichemical Management 2025 Annual Report, Table 10](https://datcp.wi.gov/Documents2/2025ACMAnnualReport.pdf)
- "Total commercial certified applicators" was 24,273 in 2025 (23,649 in 2024). DATCP notes that applicators can hold more than one certification, so this counts certifications, not people. 4,655 commercial exams were passed in 2025 — [DATCP 2025 ACM Annual Report](https://datcp.wi.gov/Documents2/2025ACMAnnualReport.pdf)
- 2020 figures (2,381 business locations; 8,142 individual licenses) appear in the prior report — [DATCP 2024 ACM Annual Report](https://datcp.wi.gov/Documents2/2024ACMAnnualReport.pdf)
- Inspections (2021 to 2025): commercial applicator record inspections 110, 130, 136, 121, 96; pesticide use observations 124, 139, 134, 168, 138 — [DATCP 2025 ACM Annual Report, Table 12](https://datcp.wi.gov/Documents2/2025ACMAnnualReport.pdf)
- Pesticide compliance cases by type (2021 to 2025): structural 1, 3, 7, 7, 2; turf and ornamental 21, 24, 35, 18, 15; total 100, 107, 128, 139, 115 — [DATCP 2025 ACM Annual Report, Table 17](https://datcp.wi.gov/Documents2/2025ACMAnnualReport.pdf)
- Landscape pesticide registry, addresses registered (2021 to 2025): 4,461; 4,445; 4,319; 4,858; 3,576. Warning notices issued: 35, 48, 21, 30, 17 — [DATCP 2025 ACM Annual Report, Table 13](https://datcp.wi.gov/Documents2/2025ACMAnnualReport.pdf)
- Fees and timing (fact sheet P-DARM355, May 2026): business license $70 plus ACCP surcharge, plus a bulk storage surcharge where it applies, required for each business location; individual commercial applicator license $40 plus surcharge; reciprocal license $115 plus surcharge. DATCP mails renewal packets in October, licenses expire December 31, a 20% late fee applies after that, and new online applications are accepted only March to October. Certification lasts five years — [DATCP Pesticide Licensing Fact Sheet](https://datcp.wi.gov/Documents2/PesticideLicensingFactSheet.pdf)
- MyDATCP lists a "Commercial/Reciprocal Applicators" search whose data "may be exported into .csv format," but on Oct 29, 2026 the link had an empty href and led nowhere — [MyDATCP Search](https://mydatcp.wisconsin.gov/Search)
- The Kelly Solutions Wisconsin applicator database blocked automated access (Cloudflare) — [Kelly Solutions WI Applicators](https://www.kellysolutions.com/WI/Applicators/)
- UW PAT 2024-2025: 19 commercial training sessions with 592 commercial attendees across all categories. Structural 7.1 had 2 in-person sessions (Wisconsin Dells, Waukesha), Aquatic and Mosquito 5.0 had 1 (Waunakee), and Turf and Landscape 3.0 had 5. 81% of commercial exam takers who attended training passed on the first attempt. The Wisconsin Pest Control Association is listed as a collaborator — [UW PAT 2024-2025 Annual Report](https://fyi.extension.wisc.edu/pat/files/2025/11/Wisconsin-PAT-Report-2025.txt)

### Inferences
- Census counts 184 employer and 269 nonemployer pest control establishments, about 453 in total. That is roughly 19% of DATCP's 2,412 licensed business locations, so a raw DATCP business count would overstate the pest market about fivefold. Not every nonemployer necessarily holds a license (some bat or wildlife operators may apply no pesticide), so 19% is a rough upper bound.
- Inspection pressure is low. About 96 record inspections in 2025 across 2,412 licensed locations is about a 4% annual chance per location, and structural compliance cases numbered 2 in 2025. The compliance pitch probably lands better on saved time and notice proof than on fear of an inspection.
- Registry matching will be low volume: 3,576 registered addresses statewide in 2025.

### Gaps
- Could not verify the number of applicators or businesses certified in 7.1 Structural or 7.3 Termite. Next steps: retry the MyDATCP CSV export once the link works, or ask DATCP's Bureau of Agrichemical Management for counts by category (608-224-4548, datcppesticideinfo@wisconsin.gov), or file a public records request.
- No published figure separates structural pest businesses from lawn care, agricultural and right-of-way businesses within the 2,412 business locations.

## 3. Who are the leading Wisconsin operators, and which brands acquired Wisconsin independents in 2023 to 2026?

### Takeaway
The largest presences are Rentokil Terminix (Wil-Kil and Batzner), Rollins (Orkin and OPC), Plunkett's, Greenix and Ecolab; six national firms held 48% of Wisconsin receipts in 2022. 2025 was an active consolidation year: Greenix bought two Milwaukee-area operations and Rove's Wisconsin business, Plunkett's bought Milwaukee's Horizon, and Ecolab bought commercial-focused Guardian.

### Cited Findings
**Leading operators**
- Wil-Kil Pest Control: founded in Milwaukee in 1924, headquartered in Sun Prairie, with branches in Appleton, Eau Claire, Menomonee Falls and Sun Prairie (plus a Chippewa Falls service center). Its site says it is "a member of the Rentokil Terminix family of companies," and it offers a customer portal for service reports, compliance documents and invoice payment — [Wil-Kil About Us](https://www.wil-kil.com/about-us/)
- Wil-Kil came to Terminix when ServiceMaster/Terminix closed its acquisition of Copesan Services on March 30, 2018 (a preliminary $150M price). Copesan owned Wil-Kil (serving Wisconsin, Minnesota, Iowa, Illinois and Michigan's Upper Peninsula) and Holder's; 270 employees — [PCT: Terminix closes Copesan transaction](https://www.pctonline.com/news/terminix-closes-copesan-transaction); [ServiceMaster 8-K exhibit](https://www.sec.gov/Archives/edgar/data/0001428875/000142887518000048/serv-20180330xex99_1.htm)
- Wil-Kil ranked #37 on the PCT Top 100 in 2015 (search-result snippet; page not opened) — [BizTimes: Wil-Kil Pest Control](https://biztimes.com/wil-kil-pest-control)
- Batzner Pest Control (New Berlin, founded 1946) was acquired by Rentokil Steritech in 2017 (completed June 15, 2017; announced August 2, 2017), with over 165 employees, including about 100 technicians and 25 managers — [PCT: Rentokil Steritech acquires Batzner](https://www.pctonline.com/news/rentokil-steritech-acquires-batzner-pest); [Rentokil Initial: Batzner](https://www.rentokil-initial.com/about-us/selling_your_business/batzner-pest-control.aspx)
- The 2026 WPCA board lists officers from "Rentokil/Batzner," "TMX/Batzner," "Rentokil Terminix/Wil-Kil" and "Orkin," which confirms that both Wisconsin legacy leaders are now under Rentokil Terminix — [WPCA Board of Directors](https://wpca27.wildapricot.org/Board-of-Directors)
- Presence in Superpages pest control listings for 8 Wisconsin cities (Appleton, Eau Claire, Green Bay, La Crosse, Madison, Milwaukee, Oshkosh, Wausau), counted by me: Orkin in 7, Wil-Kil in 6, Plunkett's in 5, Terminix in 4, Greenix in 4, Guardian in 3, Batzner in 2, Hawx in 1. Listings can be paid placements, so this shows footprint, not market share — [Superpages Madison](https://www.superpages.com/madison-wi/pest-control-services), [Milwaukee](https://www.superpages.com/milwaukee-wi/pest-control-services), [Green Bay](https://www.superpages.com/green-bay-wi/pest-control-services), [Appleton](https://www.superpages.com/appleton-wi/pest-control-services), [Eau Claire](https://www.superpages.com/eau-claire-wi/pest-control-services), [Wausau](https://www.superpages.com/wausau-wi/pest-control-services), [La Crosse](https://www.superpages.com/la-crosse-wi/pest-control-services), [Oshkosh](https://www.superpages.com/oshkosh-wi/pest-control-services)
- Plunkett's Pest Control (Minneapolis, private, founded 1915) serves over 70,000 residential and commercial clients in 22 states — [PMP: Plunkett's acquires Horizon](https://www.mypmp.net/plunketts-acquires-horizon-pest-management/)
- Greenix Pest Control (Utah, backed by Riata Capital) operates in 19 states, protects over 250,000 households, has over 1,000 employees, and is the 13th-largest U.S. pest control provider per PCT — [Riata Capital: Greenix acquires Rove](https://www.riatacapital.com/news/greenix-pest-control-expands-presence-with-acquisition-of-rove-pest-control)

**Acquisitions touching Wisconsin, 2023 to 2026**
- March 18, 2025: Greenix completed the acquisition of Spidexx Pest Control's Milwaukee office — [Riata Capital: Greenix acquires Spidexx](https://www.riatacapital.com/news/greenix-pest-control-expands-wisconsin-presence-with-acquisition-of-spidexx-pest-control)
- June 24, 2025: Greenix acquired Rove Pest Control's operations in Minnesota, Wisconsin, Michigan and Massachusetts, covering Rove's Milwaukee and Madison operations — [Riata Capital](https://www.riatacapital.com/news/greenix-pest-control-expands-presence-with-acquisition-of-rove-pest-control); [BizTimes: Milwaukee location](https://biztimes.com/greenix-pest-control-acquires-rove-pest-controls-milwaukee-location/); [PR Newswire: Madison](https://www.prnewswire.com/news-releases/greenix-pest-control-expands-presence-with-acquisition-of-rove-pest-control-in-madison-302488958.html)
- September 25, 2025: Plunkett's acquired Horizon Pest Management (Milwaukee, founded 2002 by Craig Wycklendt), "strengthening Plunkett's presence in Wisconsin." Horizon's size was not disclosed — [PMP](https://www.mypmp.net/plunketts-acquires-horizon-pest-management/)
- Closed December 8, 2025: Ecolab Pest Elimination acquired Guardian Pest Solutions, a family-owned commercial pest firm founded in 1966 that serves Minnesota, Iowa, Wisconsin, the Dakotas, Illinois, Michigan and Nebraska, with more than 80 employees and about $9M in revenue (search-result summary of the PCT article; the page did not load when fetched) — [PCT: Ecolab acquires Guardian](https://www.pctonline.com/news/ecolab-acquires-guardian-pest-solutions)
- Date not verified (the page cites "35 years of experience" since a 1988 founding, which implies about 2023): Rollins subsidiary OPC Pest Services acquired A-Action Pest Control of Antioch, Illinois, which serves Illinois and Wisconsin homeowners — [OPC Pest Services newsroom](https://www.opcpest.com/newsroom/opc-pest-services-acquires-a-action-pest-control/)

### Inferences
- The two largest Wisconsin-founded firms (Wil-Kil and Batzner) are both now Rentokil Terminix, so most "independents" left are small. The SUSB 20-99 class holds only 5 firms.
- The 2025 roll-up wave (Greenix, Plunkett's, Ecolab) both removes possible Bugsy tenants and creates switching moments for their former customers and staff. It also suggests owners of independents near retirement are actively selling.

### Gaps
- Could not verify any Wisconsin acquisition by Anticimex, Aptive or Arrow from 2023 to 2026, nor any Anticimex brand operating in Wisconsin.
- Could not retrieve a 2026 PCT Top 100 entry for a Wisconsin-headquartered firm.
- No revenue or technician counts were found for Horizon, Spidexx, Rove's Wisconsin operations, Kwik Kill or other named independents.

## 4. What software do Wisconsin pest companies use?

### Takeaway
On public websites, Wisconsin independents most visibly use GorillaDesk (3 firms) and Fieldwork (2 firms), with single cases of PestPac, Briostack and Service Autopilot. Roll-up entrants (Greenix, Rove, Hawx) use PestPac. 30 of 38 sampled independents expose no identifiable software at all. No ServSuite, FieldRoutes, Pocomos, Jobber or Housecall Pro use was detected.

### Cited Findings
Method: I pulled company domains from the Superpages and Yellow Pages listings for 8 Wisconsin cities, fetched each homepage plus up to 4 linked pages whose link or text mentioned portal, pay, bill, account, login or customer, and searched them for vendor domains. This finds only vendors that appear in a public portal or pay link, so it is a lower bound.
- Bourn Pest Solutions (Waukesha): GorillaDesk customer portal (portal.gorilladesk.com/bournpestsolutions) — [bournpestsolutions.com](https://bournpestsolutions.com/). Its owner, Jeff Bourn, sits on the WPCA board — [WPCA Board](https://wpca27.wildapricot.org/Board-of-Directors)
- Nexus Pest Solutions (Mequon and Brown Deer area): GorillaDesk client portal (client.gorilladesk.com/nexuspestsolutions) — [nexuspestsolutions.com](https://nexuspestsolutions.com/)
- 1st Choice Pest Control LLC (Appleton listing): GorillaDesk portal (portal.gorilladesk.com/1stchoicepestcontrolllc) — [1stchoicepestcontrolllc.com](https://1stchoicepestcontrolllc.com/)
- 1st Choice Pest Solutions (Eau Claire and Wausau listings): Fieldwork portal assets (assets.fieldworkhq.com/assets/portal) — [1stchoicepestsolutions.com](https://1stchoicepestsolutions.com/)
- On Target Pest Control (La Crosse): Fieldwork portal assets (fieldworkhq.com) — [ontargetpestwi.com](https://ontargetpestwi.com/)
- Fenix Pest Control, Inc. (site title "Pest Control in WI, SD, IA, ..."; listed in Appleton and Madison): PestPac customer portal (fenixpest.pestportals.com) — [fenixpestcontrol.com](https://fenixpestcontrol.com/)
- Werner Pest and Odor Control (Seymour): Briostack customer portal (wernerpest.briostack.com) — [wernerpest.com](https://wernerpest.com/)
- Pest Badger (pest control and lawn care in Wisconsin and Michigan): Service Autopilot forms (my.serviceautopilot.com) — [pestbadger.com](https://pestbadger.com/)
- Roll-up entrants on PestPac: Greenix (greenixpc.pestportals.com) — [greenixpc.com](https://greenixpc.com/); Rove, now Greenix (rove.pestportals.com) — [rovepestcontrol.com](https://rovepestcontrol.com/); Hawx (hawx.pestportals.com) — [hawxpestcontrol.com](https://hawxpestcontrol.com/)
- National brands run their own portals (vendor not identifiable): Wil-Kil "My Account" — [wil-kil.com](https://www.wil-kil.com/about-us/); Batzner customer portal — [batzner.com/customer-portal](https://www.batzner.com/customer-portal/)
- No vendor was detected on 30 of the 38 reachable independent sites, including Kwik Kill (Madison; its owner is the WPCA treasurer), Belle City Pest Solutions (Racine; WPCA past president), Professional Pest Control (Madison; WPCA board), Valley Pest Control (Oshkosh), Bug Guy Pest Control (Green Bay) and Prompt Action Pest Control (Wausau). Many have no online payment or portal link at all — [Kwik Kill](https://kwikkill.net/), [Belle City](https://bellecitypest.com/), [Professional Pest Control](https://profpestcontrol.com/), [Valley Pest](https://valleypestwi.com/), [Bug Guy](https://bugguypests.com/), [Prompt Action](https://promptactionpest.com/)
- The only software company among the 2026 Midwest PestCon sponsors and exhibitors was Fieldwork Software. The other 26 logos were product, equipment, insurance and distribution firms (Bell Labs, Liphatech, Target Specialty Products, Veseris, BASF, Syngenta, Envu, West Bend and others) — [WPCA 2026 Sponsors](https://wpca27.wildapricot.org/Sponsors)
- PestCon 2026 (February 10) included an owners and managers session, "How to Evaluate Software Solutions for Your Business," by Mark Davidson — [WPCA Conference schedule](https://wpca27.wildapricot.org/Conference)
- Searches for Wisconsin job postings and vendor case studies naming PestPac, FieldRoutes, ServSuite, GorillaDesk or Briostack returned no Wisconsin-specific results; ZipRecruiter and Indeed Wisconsin technician listings did not name software — [ZipRecruiter WI pest technician jobs](https://www.ziprecruiter.com/Jobs/Pest-Control-Technician/--in-Wisconsin)

### Inferences
- Among small Wisconsin independents, the visible incumbents are low-cost tools (GorillaDesk) and Fieldwork, which is not among the PRD's 8 researched competitors. Fieldwork has 2 Wisconsin customers in this sample and was the only software exhibitor at Wisconsin's main trade show, so it belongs in the competitor set.
- The large share of sites with no portal fits the PRD's "spreadsheets, a horizontal tool" profile, but it does not prove the absence of software: many firms may use software with no public portal, or QuickBooks invoicing.
- No Wisconsin evidence supports the PRD's ServSuite forced-migration "buying moment."

### Gaps
- Could not verify software for the 30 independents with no detectable portal; only interviews or job postings would show it.
- Indeed and LinkedIn job listings that name software could not be searched effectively without login.
- The sample covers only firms with websites listed in 8 city directories; rural firms are under-represented.

## 5. Which Wisconsin industry groups and events could reach first customers?

### Takeaway
The Wisconsin Pest Control Association is the one statewide channel. Its Midwest PestCon (February 9-10, 2027, Wisconsin Dells) falls exactly in the PRD's winter recruiting and cutover window, carries 7.1 certification testing, and had only one software exhibitor in 2026. UW PAT and the UW Insect Diagnostic Lab are trusted co-hosts.

### Cited Findings
- WPCA has served the Wisconsin pest control industry since 1946. Its volunteer board mixes family businesses with regional and national companies, plus advisory members from the UW-Madison entomology program, DATCP's pesticide certification program and a vendor. The board meets the second Tuesday of each month, October through May, in Pewaukee, and members are welcome — [WPCA About](https://wpca27.wildapricot.org/About)
- 2026 officers and board: Jerry Lohr (Rentokil/Batzner, president), Jason Ganas (Safeway Pest Management), Breanna Neerland (Kwik Kill Pest Control), Gary Dady (Orkin), Matt Lang and Ingrid Lang (Belle City Pest Solutions), Jeff Bourn (Bourn Pest Solutions), Brad Fischer (TMX/Batzner), Tom Fraser (Professional Pest Control), Nathan Hall (Rentokil Terminix/Wil-Kil), Brian Zahringer (BugBoss The X-Terminator). Appointed representatives come from Target Specialty Products, the UW-Madison Insect Diagnostic Lab (PJ Liesch) and DATCP — [WPCA Board](https://wpca27.wildapricot.org/Board-of-Directors)
- Membership: Wisconsin-based pest companies join jointly through NPMA; multi-state companies and allied (vendor) members pay $135 a year. Allied members get discounted exhibit rates and can submit articles to the quarterly Pest Dispatch newsletter — [WPCA Join Us](https://wpca27.wildapricot.org/Join-Us)
- Midwest PestCon: a two-day conference each February at the Kalahari Resort, Wisconsin Dells, with a trade show, about a dozen sessions, and onsite 7.1 certification training and Master Tech exams — [WPCA PestCon](https://wpca27.wildapricot.org/PestCon); next edition February 9-10, 2027 — [WPCA Events](https://wpca27.wildapricot.org/events)
- Attendance: 190 participants and 26 exhibitors in 2026, and a record 228 registrants and 28 exhibitors in 2025 (search-result summaries; the pages returned 403 or empty when fetched) — [PCT: WPCA hosts Midwest PestCon 2026](https://www.pctonline.com/news/wpca-hosts-midwest-pest-con-2026); [PMP: WPCA hosts annual Midwest PestCon](https://www.mypmp.net/wpca-hosts-annual-midwest-pest-con/)
- WPCA reported 2024 revenue of $68.1K and expenses of $69.5K (search-result summary of the ProPublica filing) — [ProPublica Nonprofit Explorer](https://projects.propublica.org/nonprofits/organizations/391530326)
- Master Tech: a WPCA credential run with the UW-Madison Insect Diagnostic Lab and DATCP. The exam is held at PestCon, costs $65, and is open only to employees of WPCA/NPMA joint members — [WPCA Master Tech](https://wpca27.wildapricot.org/Master-Tech-Program)
- WPCA runs a public "Find A Pro" member directory searchable by county and specialty (including mosquitoes, termites, bats and wildlife) — [WPCA Find A Pro](https://wpca27.wildapricot.org/Find-A-Pro)
- Other WPCA events: a summer golf outing (August 6, 2026) and a Professional Women in Pest Management group — [WPCA Events](https://wpca27.wildapricot.org/events)
- UW PAT runs 7.1 Structural training in person (2 sessions in 2024-25), proctors exams through 54 county Extension offices, and lists WPCA as a collaborator — [UW PAT 2024-2025 report](https://fyi.extension.wisc.edu/pat/files/2025/11/Wisconsin-PAT-Report-2025.txt)
- DATCP mails license renewal packets every October, and licenses run January 1 to December 31 — [DATCP Licensing Fact Sheet](https://datcp.wi.gov/Documents2/PesticideLicensingFactSheet.pdf)

### Inferences
- A PestCon 2027 presence (an exhibit as an allied member, or a session pitched through UW or DATCP on records and notices) reaches a large share of Wisconsin owners in one place, just before the spring rush and in the PRD's winter cutover window.
- The WPCA board itself includes 5 or 6 independent owners (Safeway, Kwik Kill, Belle City, Bourn, Professional Pest Control, BugBoss), which is a ready list for design-partner interviews.
- Distributors with Wisconsin reach (Target Specialty Products sits on the board; Veseris and Pest Management Supply exhibit) are a possible referral channel.

### Gaps
- WPCA member count and the share of Wisconsin firms that are members could not be verified, because the directory requires JavaScript.
- Found no DATCP-run recertification events to target. The DATCP fact sheet describes exam-based certification that lasts five years and mentions no continuing-education route, and PestCon advertises CEUs only for Illinois participants. Both suggest Wisconsin has no recurring credit-based recertification channel, but this was not confirmed with DATCP.

## 6. Seasonality, mosquito and tick seasons, and how many Wisconsin pest companies sell mosquito and tick service

### Takeaway
Wisconsin pest employment swings about 33 to 44% from the winter trough (January or February) to the summer peak (June or July), roughly three to four times the U.S. swing. Mosquito and tick service is common: 16 of 38 sampled independent websites mention mosquito on the homepage.

### Cited Findings
- Wisconsin 561710 monthly private employment, 2025: January 1,348; February 1,334; March 1,351; April 1,499; May 1,710; June 1,776; July 1,769; August 1,748; September 1,639; October 1,535; November 1,461; December 1,426 — [BLS QCEW 2025 Q1](https://data.bls.gov/cew/data/api/2025/1/industry/561710.csv), [Q2](https://data.bls.gov/cew/data/api/2025/2/industry/561710.csv), [Q3](https://data.bls.gov/cew/data/api/2025/3/industry/561710.csv), [Q4](https://data.bls.gov/cew/data/api/2025/4/industry/561710.csv)
- Peak-to-trough ratio, my calculation: Wisconsin 1.40 (2023, July over January), 1.44 (2024, June over January), 1.33 (2025, June over February); U.S. 1.11, 1.12 and 1.10 — [BLS QCEW](https://data.bls.gov/cew/data/api/2024/1/industry/561710.csv)
- Wisconsin 2025 wages by quarter: Q1 $18.7M (21% of the year), Q2 $22.5M (25%), Q3 $24.9M (28%), Q4 $23.0M (26%) — [BLS QCEW 2025](https://data.bls.gov/cew/data/api/2025/3/industry/561710.csv); CBP 2023 likewise puts Q1 payroll at 20.1% of the annual total ($12.792M of $63.517M) — [Census CBP 2023](https://www2.census.gov/programs-surveys/cbp/datasets/2023/cbp23st.zip)
- Ticks: a UW-Madison entomologist describes typical tick emergence as May through September, with nymphs found as early as April 13 in one recent year; UW Extension calls spring a peak period for tick activity (search-result summary) — [UW Extension Horticulture: Spring is tick season in Wisconsin](https://hort.extension.wisc.edu/2024/05/25/spring-is-tick-season-in-wisconsin/)
- Wisconsin DHS samples ticks at sentinel sites from about March through November, and its report for May 28-29, 2026 rated adult and nymph blacklegged tick activity moderate (search-result summary) — [Wisconsin DHS tick report P-03757 2026-21](https://www.dhs.wisconsin.gov/publications/p03757-2026-21.pdf)
- Mosquitoes: UW entomologist PJ Liesch says populations depend on water and are hard to predict; Wisconsin has at least 56 mosquito species (search-result summary) — [UW Extension: Pests to watch for this season](https://fyi.extension.wisc.edu/news/2019/06/13/pests-what-to-watch-for-this-season/)
- PestCon 2026 included a UW-Madison session on blacklegged tick management strategies in Wisconsin (Susan Paskewitz) — [WPCA Conference](https://wpca27.wildapricot.org/Conference)
- In my keyword scan of 38 reachable independent Wisconsin pest company homepages: 16 mention mosquito, 13 mention ticks, 13 mention bats, 10 mention termites and 24 mention commercial service. This is a homepage keyword match, so it is approximate — sites as listed in section 4
- Mosquito-focused brands in the Wisconsin listings: Mosquito Stoppers (Green Bay), Mosquito Hero (Appleton), Mosquito Authority (Wausau), Mosquito Shield (Oshkosh), Superior Mosquito Defense and Sanctum Mosquito Control (Madison), and TruGreen Mosquito Defense (Eau Claire); lawn-care firms Spring-Green and TruGreen also appear in pest listings — [Superpages listings](https://www.superpages.com/green-bay-wi/pest-control-services); Mosquito Stoppers is described as family-owned and operating since 1993 — [TMJ4 Reviews: Milwaukee pest control](https://reviews.tmj4.com/pest-control-milwaukee/)
- UW PAT offered only 1 in-person Aquatic and Mosquito (5.0) session in 2024-25, against 2 for Structural (7.1) — [UW PAT 2024-2025 report](https://fyi.extension.wisc.edu/pat/files/2025/11/Wisconsin-PAT-Report-2025.txt)

### Inferences
- The January to March trough confirms the PRD's winter cutover timing.
- The seasonal swing matters for pricing. Wisconsin averaged 24% (2025) to 28% (2024) fewer pest employees in January to March than in June to August, so per-active-technician pricing will swing with the season, the same problem the PRD attributes to Pocomos's per-customer pricing. Bugsy's revenue per tenant would dip in winter unless it counts technicians on a 12-month peak or annual basis.
- Mosquito and tick is a mainstream add-on: about 40% of sampled independents advertise it. That supports the seasonal-program, landscape-notice and tax work in Phase 1, and the open DOR and DATCP questions on yard spraying matter for many tenants, not a niche.
- Mosquito and tick service also puts Bugsy's tenants in competition with lawn-care firms (TruGreen, Spring-Green), which are out of scope for Bugsy as tenants.

### Gaps
- Could not verify an authoritative Wisconsin mosquito season date range (for example, a typical first and last spray week).
- No dataset gives the share of Wisconsin firms or revenue from mosquito and tick service; the keyword scan is a proxy.

## 7. Typical size of an independent Wisconsin pest company

### Takeaway
The typical Wisconsin employer pest firm is tiny: 70% have fewer than 5 employees and average about $211K in receipts. Firms in the PRD's target band have 5 to 19 employees and earn about $0.9M to $1.8M a year, at about $130K of receipts per employee.

### Cited Findings
- SUSB 2022 average receipts per Wisconsin firm, by enterprise size (my division of published totals): <5 employees $211K (102 firms, 1.3 employees each on average); 5-9 $873K (19 firms, 6.6 employees); 10-19 $1.79M (13 firms, 14.1 employees); 20-99 $3.05M of Wisconsin receipts (5 firms, 29.6 Wisconsin employees); national 500+ firms $3.39M per Wisconsin establishment — [Census SUSB 2022](https://www2.census.gov/programs-surveys/susb/tables/2022/us_state_6digitnaics_2022.txt)
- Receipts per employee, 2022: $133K in the 5-9 class and $127K in the 10-19 class — [Census SUSB 2022](https://www2.census.gov/programs-surveys/susb/tables/2022/us_state_6digitnaics_2022.txt)
- The average Wisconsin pest establishment has 6.1 employees (CBP 2023) — [Census CBP 2023](https://www2.census.gov/programs-surveys/cbp/datasets/2023/cbp23st.zip)
- Nonemployer pest businesses average about $60K in receipts (2024) — [Census NES 2024](https://www2.census.gov/programs-surveys/nonemployer-statistics/datasets/2024/historical-datasets/nonemp24st.zip)
- Named data points: Batzner had over 165 employees, about 100 of them technicians, when sold in 2017 — [PCT](https://www.pctonline.com/news/rentokil-steritech-acquires-batzner-pest); Guardian (multi-state, commercial) had more than 80 employees and about $9M in revenue in 2025 — [PCT](https://www.pctonline.com/news/ecolab-acquires-guardian-pest-solutions)
- Wisconsin pest technician job listings show about $18 to $25 an hour (Green Bay, Appleton, Sheboygan; search-result summary, dates unverified) — [ZipRecruiter](https://www.ziprecruiter.com/Jobs/Pest-Control-Technician/--in-Wisconsin)

### Inferences
- A company with 3 to 15 technicians maps to roughly 5 to 25 employees, assuming about 60% of employees are technicians plus the owner and office staff. That is the SUSB 5-9 and 10-19 classes (32 firms in 2022) plus part of the 5-firm 20-99 class: about 32 to 37 Wisconsin employer firms.
- At about $130K of revenue per employee, an 8-technician firm with about 13 employees would bring in roughly $1.7M. The PRD's price for 8 technicians ($632 to $792 a month, $7.6K to $9.5K a year) would be about 0.45 to 0.55% of revenue.

### Gaps
- No public technician or revenue data was found for any named Wisconsin independent that is still independent.
- Census does not separate residential-first from commercial-first firms.

## 8. PRD assumptions tested (first customer size, market size, pricing, channels)

### Takeaway
The evidence supports the PRD's first-customer profile, winter timing and the WPCA channel. It confirms the "Wisconsin is small" risk with numbers: a Wisconsin-only per-technician product tops out near $1M a year in revenue even at 100% share. It also shows that the DATCP-count sizing method and the per-active-technician price unit need changes.

### Cited Findings
- First customer (independent, single-branch, residential-first, 3 to 15 technicians): **Supported, but small.** About 32 to 37 Wisconsin employer firms fit the size band (SUSB 2022). Firms in that band are single-location (firm counts equal establishment counts in the 5-9 and 10-19 classes). Residential-first cannot be tested with public data — [Census SUSB 2022](https://www2.census.gov/programs-surveys/susb/tables/2022/us_state_6digitnaics_2022.txt). The PRD's "first 10 tenants" would be about 27 to 31% of that pool.
- Excluding owner-operators with 1 or 2 technicians: **Supported.** They are the numerical majority (102 of 146 employer firms under 5 employees, plus 269 nonemployers), and the low-cost GorillaDesk is the most common tool detected among small Wisconsin independents — [Census SUSB 2022](https://www2.census.gov/programs-surveys/susb/tables/2022/us_state_6digitnaics_2022.txt); [Census NES 2024](https://www2.census.gov/programs-surveys/nonemployer-statistics/datasets/2024/historical-datasets/nonemp24st.zip); section 4 sites
- "Today they run on spreadsheets, a horizontal tool or ServSuite": **Partly supported, partly contradicted.** 30 of 38 sampled independents show no identifiable software. Where software is visible, it is GorillaDesk, Fieldwork, PestPac, Briostack or Service Autopilot. No ServSuite, Jobber or Housecall Pro was detected, so the ServSuite-migration "why now" has no Wisconsin evidence — section 4 sites; [WPCA 2026 Sponsors](https://wpca27.wildapricot.org/Sponsors)
- Market size ("Unknown"): **Now sized.** $148.4M in employer receipts (2022) plus $16.0M from nonemployers (2024); about 1,550 employees (2025 average); national firms hold 48% of receipts — [SUSB 2022](https://www2.census.gov/programs-surveys/susb/tables/2022/us_state_6digitnaics_2022.txt); [QCEW 2025](https://data.bls.gov/cew/data/api/2025/1/industry/561710.csv)
- Market sizing method (count DATCP businesses with 7.1 applicators): **Cannot be done from published data, and a raw count misleads.** DATCP publishes only all-category totals (2,412 business locations in 2025), about 5 times the Census pest establishment count. The category-level CSV link was broken on Oct 29, 2026 — [DATCP 2025 ACM Annual Report](https://datcp.wi.gov/Documents2/2025ACMAnnualReport.pdf); [MyDATCP Search](https://mydatcp.wisconsin.gov/Search)
- "The Wisconsin market is small" (Risks): **Supported with numbers.** Wisconsin is 0.76% of U.S. pest receipts. The four neighbors (Minnesota, Illinois, Michigan, Iowa) have 770 employer firms and $1.11B in receipts (SUSB 2022), about 7.5 times Wisconsin's — [Census SUSB 2022](https://www2.census.gov/programs-surveys/susb/tables/2022/us_state_6digitnaics_2022.txt)
- Pricing ($79 to $99 per active technician per month, 2-technician minimum): **Cannot test willingness to pay; the seasonality evidence argues against "active" technician counting.** Wisconsin pest employment swings 1.33 to 1.44 times from peak to trough, against about 1.1 nationally — [BLS QCEW](https://data.bls.gov/cew/data/api/2025/2/industry/561710.csv)
- Channels (implied by "recruit the pilot" and "3 to 5 interviews"): **Supported.** WPCA's Midwest PestCon on February 9-10, 2027 falls in the winter window, and the WPCA board includes 5 or 6 independent owners — [WPCA Events](https://wpca27.wildapricot.org/events); [WPCA Board](https://wpca27.wildapricot.org/Board-of-Directors)
- Winter cutover: **Supported.** January to March is the employment and payroll trough — [BLS QCEW 2025](https://data.bls.gov/cew/data/api/2025/1/industry/561710.csv)
- Compliance urgency for the owner and licensed manager ("a DATCP inspection means pulling paper; ... business license at risk"): **Weakly contradicted on risk, not on effort.** DATCP made 96 record inspections in 2025 across 2,412 licensed locations and brought 2 structural cases — [DATCP 2025 ACM Annual Report](https://datcp.wi.gov/Documents2/2025ACMAnnualReport.pdf)

### Inferences
- Wisconsin-only revenue ceiling at the PRD's price, my arithmetic: about 940 employed technicians (2025, estimated) × $79 to $99 × 12 months is about $0.89M to $1.12M a year at 100% share including national brands. Leaving out national-brand staff (about 39% of employment) gives about $0.54M to $0.68M. The PRD's size band alone (about 185 to 275 technicians in 2022) gives about $175K to $330K a year. Wisconsin is a pilot and proof market, not the business. The "second state as configuration" mitigation should become a plan with Minnesota, Illinois and Michigan sized now.
- Price unit: billing on a 12-month or peak technician count (or an annual license sized by peak route count) would avoid winter revenue dips for Bugsy and the per-customer-style seasonal-swing complaint for tenants.
- Competitor set: add Fieldwork to the 8 researched competitors, given its Wisconsin customers and its PestCon presence.

### Gaps
- Willingness to pay, residential versus commercial mix, current software and the share of firms on QuickBooks can only be learned from the 3 to 5 Wisconsin interviews the PRD already plans.
- Counts of 7.1 and 7.3 certified applicators and businesses still need DATCP's export or a direct request.
