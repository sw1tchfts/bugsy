# Wisconsin rule pack

Researched October 2026. These values become `lib/compliance/rules/wi.ts` and are verified by the fixtures in `fixtures/states/wi/`. Never hardcode them anywhere else. When changing behavior, re-check the cited source. This file is the worked example for adding any state; see `../SKILL.md`.

## Rule values (pack keys)

| Rule key | Value | Source |
| --- | --- | --- |
| `records.retentionYears` | 2 | ATCP 29.21(1) |
| `records.completeBy` | same day as the application | ATCP 29.21(1) |
| `notice.postApplication.withinDays` | 30, in writing; electronic only with prior written consent | ATCP 29.22 |
| `notice.preApplicationOffer` | before the first application, then at least yearly on continuing contracts (residential and landscape) | ATCP 29.55(2), 29.56(2) |
| `notice.resident` | at the time of application; left with an adult or posted at the unit entrance; common areas and perimeter jobs posted in entryways | ATCP 29.55(3) |
| `sign.restrictedEntry` | sign at each entrance to the treated area when the label sets a restricted entry interval; 8.5 x 11 inches; up before, down after the interval ends | ATCP 29.55(4) |
| `landscape.advanceNoticeHours` | 12, to anyone on the DATCP landscape registry for that parcel | ATCP 29.56(8) |
| `landscape.mailPostmarkBusinessDays` | 2 business days before the application, if notice is mailed | ATCP 29.56(8) |
| `landscape.structuralBeyondFeet` | 10: structural work more than 10 feet from the structure follows landscape rules | DATCP structural checklist |
| `license.expires` | December 31 each year (individual and business) | ATCP 29.25(3), DATCP |
| `certification.validYears` | 5 | DATCP |
| `trainee.maxDays` | 30, under direct on-site supervision by a certified applicator | ATCP 29.32, UW PAT |
| `wildlife.batExclusionBlackout` | June 1 to July 31, every year | Wisconsin DNR |

## Certification categories by service line

| Service line | Required category |
| --- | --- |
| General pest, rodent, bed bug | 7.1 Structural |
| Termite | 7.3 Termite (with structural) |
| Mosquito (yard) | 5.0 Aquatic and Mosquito |
| Mosquito misting systems | 26.0 Chemigation subcategory, on top of a base category |
| Tick (yard) | Unconfirmed: treat as 3.0 plus 5.0 until DATCP confirms |
| Wildlife (no pesticide) | None from DATCP; DNR rules apply |

Structural certification excludes mosquito control. Out of scope: lawn care, tree and shrub care, and other trades. Mosquito and tick yard spraying, termite and wildlife are in scope because pest companies sell them.

## How the general rules apply in Wisconsin

- A technician can be assigned a visit only if their license is current for the visit date and they hold every category the service type requires. Trainees can work only inside their 30-day window, with a supervisor assigned.
- Restricted-use products can be recorded only by a licensed, certified applicator.
- A completed visit produces an application record containing every ATCP 29.21 field. Missing fields block completion in the app, not later.
- Records lock at day end. Corrections are amendment rows with author and reason.
- Every required notice gets a `notices` row with due time, channel and proof of sending.
- Scheduling blocks bat exclusion visits inside the blackout. DNR's health exemption covers a landowner conducting the exclusion (form filed within 5 days of starting); whether a hired operator may work under it is unconfirmed, so keep the block until it is.
- Yard mosquito and tick spraying, and structural work more than 10 feet from the building, are landscape applications. At a registry address they cannot start until the advance notice is recorded as sent in time.

## Sales tax touchpoint

Wisconsin taxes landscaping and lawn maintenance services, which include spraying lawns, trees and shrubs (DOR Publication 210). That is why yard mosquito and tick spraying is an open tax question. Structural pest control does not appear among taxable services in the sources reviewed. Treat it as not taxable until confirmed with DOR; keep taxability on the service type so it can change without code. Tax mechanics are in the `pest-accounting` skill.

## Open questions (do not invent answers)

- Which certification category covers yard tick control.
- Whether yard mosquito and tick spraying is taxable as a lawn and landscape spraying service.
- What DNR rule NR 12.10 requires of a hired wildlife operator (written landowner approval fields, permits).
- The file format DATCP uses for the yearly landscape registry.
- Whether a hired wildlife operator may perform a bat exclusion inside the blackout under a landowner's health exemption.
- How "business days" treats state holidays for the mailed landscape notice.

## Licensing (DATCP)

A for-hire applicator needs all three before any application:
1. Certification in the right category, renewed every 5 years.
2. Individual commercial applicator license, January 1 to December 31.
3. Employment by a business holding a pesticide business license, January 1 to December 31.

The business license is per business location (a site where the business regularly takes orders or operates as an applicator for hire; a vehicle taking phone orders is not a location). Fee $70 plus a $20 surcharge per location. The application lists the name and license number of every licensed employee. To add an applicator mid-year, email datcppesticideinfo@wi.gov with the business license number, the applicator's name, license number and certification expiration date.

Sources: https://datcp.wi.gov/Pages/Licenses_Permits/CommercialApplicator.aspx, ATCP 29.20 and 29.25 at https://docs.legis.wisconsin.gov/code/admin_code/atcp/020/29/v/22, https://fyi.extension.wisc.edu/pat/commercial-licensing/

## Application record fields (ATCP 29.21(2))

Kept at least 2 years, completed by the applicator on the day of the application, available to DATCP for inspection and copying.

| Field | Data model source |
| --- | --- |
| First and last name of each individual making the application | visits.technician_id, users |
| Customer name and address | accounts, properties |
| Crop, commodity or site treated | visit_products.site_treated |
| Specific description of the application site location, detailed enough to find it | visit_products.location_description |
| Month, day, year, approximate start and end time | visits.arrived_at, visits.departed_at |
| Brand, product or common chemical name, and EPA registration number | products.name, products.epa_reg_no |
| Either concentration and total quantity, or amount per unit area and total area | visit_products.concentration and amount, or rate and area_treated |
| Each mixing or loading site other than a licensed business location | visit_products.mix_load_site; not needed when applied from a retail container or from equipment of 5 gallons liquid or 50 pounds dry or less |

## Post-application information to the customer (ATCP 29.22)

Within 30 days, in writing. Electronic delivery (email, text) only if the customer consented in writing before the application. Contents:
1. A phone number to reach the business
2. First name, last name and license number of each individual who made or directly supervised the application
3. Site treated
4. Specific description of the site location
5. Date and approximate start and end time
6. Product name and EPA registration number of each product
7. Concentration and total quantity, or amount per unit area and total area
8. Post-application precautions the label requires of the customer, in time to take them
9. A free copy of the label, or notice that the customer may request one

## Residential structures (ATCP 29.55)

"Residential application" includes perimeter barrier applications. Hotels, hospitals, nursing homes and jails are not residential structures under this section.

- Customer offer: before the first residential application, a written (or consented electronic) offer of pre-application information; repeat at least yearly on contracts longer than one year. If requested: product names, label copies, application date (orally if the requester agrees), and a contact name, address and phone.
- Notice to residents at the time of application, in writing: business name, address and phone; applicator name and license number; product name; concentration and quantity, or rate and area; label precautions; date and start and end time; that a label copy is available; specific location. Leave it with an adult in the unit or post it at the unit entrance. For common areas and perimeter applications, post notices in common entryways where residents will see them.
- Restricted entry interval: post a sign of at least 8.5 by 11 inches, in the form of ATCP 29 Appendix D, at each entrance to the treated area before applying; leave it until the interval expires. Landlords and contract applicators are jointly responsible.

Source: https://docs.legis.wisconsin.gov/code/admin_code/atcp/020/29/ix/55

## Landscape applications (ATCP 29.56)

"Landscape" covers turf, ornamental and mulched areas around homes, businesses, parks, workplaces and similar sites. For a pest company this means yard mosquito and tick spraying, and structural applications more than 10 feet from the structure (DATCP structural checklist). Perimeter barrier applications within that band are not landscape applications.

- Customer offer of pre-application information before the first application and yearly on continuing contracts.
- Warning signs at the application site before applying (form and placement in the rule).
- Information to anyone who asks about the application.
- DATCP keeps a yearly registry of people requesting advance notice for listed parcels (tenants of rental property may register). Before any landscape application to a registered parcel, give at least 12 hours notice by phone, mail or delivery; mailed notice must be postmarked at least 2 business days before. If the date changes after notice, give notice again.

Source: same as above.

## Structural compliance checklist (DATCP, November 2016)

Business license; certification; individual licenses; storage and transport (ATCP 29.40, 29.45, 29.47, ATCP 33); use and disposal; residential pre-application and resident notices; advance notice for bees on request (ATCP 29.51(1)); warning signs; post-application information; records kept 2 years; landscape rules beyond 10 feet.

Source: https://datcp.wi.gov/Documents/HTCStructuralChecklist.pdf

## Certification categories

17 base categories and 3 subcategories. Relevant: 5.0 Aquatic and Mosquito (mosquito control on land or larvae in water); 7.1 Structural (pests including vertebrates and birds in and around structures); 7.2 Space and Commodity Fumigation; 7.3 Termite Control; 26.0 Chemigation (includes mosquito misting systems). Anyone applying any pesticide to K-12 public school property must be certified.

Sources: https://fyi.extension.wisc.edu/pat/commercial-certification-categories/, https://fyi.extension.wisc.edu/pat/commercial-how-to-get-certified-and-licensed/

## Wildlife (DNR)

Bats are protected and may not be killed. Exclusions may not be done June 1 to July 31. Inside that window a landowner who believes bats pose a health risk may proceed by submitting the DNR Health Exemption Form within five days of starting the exclusion.

Source: https://dnr.wisconsin.gov/topic/EndangeredResources/batFAQs

## Termites

Two subterranean species are established in Wisconsin, both in the southern half of the state, at the northern edge of their range. Termite work is a smaller line than in southern states.

Source: https://research.fs.usda.gov/treesearch/48731
