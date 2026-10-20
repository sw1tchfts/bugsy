# Wisconsin compliance reference

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

"Landscape" covers turf, ornamental and mulched areas around homes, businesses, parks, workplaces and similar sites. Perimeter barrier applications are not landscape applications, but structural applications beyond 10 feet of the structure follow landscape rules (DATCP structural checklist).

- Customer offer of pre-application information before the first application and yearly on continuing contracts.
- Warning signs at the application site before applying (form and placement in the rule).
- Information to anyone who asks about the application.
- DATCP keeps a yearly registry of people requesting advance notice for listed parcels (tenants of rental property may register). Before any landscape application to a registered parcel, give at least 12 hours notice by phone, mail or delivery; mailed notice must be postmarked at least 2 business days before. If the date changes after notice, give notice again.

Source: same as above.

## Structural compliance checklist (DATCP, November 2016)

Business license; certification; individual licenses; storage and transport (ATCP 29.40, 29.45, 29.47, ATCP 33); use and disposal; residential pre-application and resident notices; advance notice for bees on request (ATCP 29.51(1)); warning signs; post-application information; records kept 2 years; landscape rules beyond 10 feet.

Source: https://datcp.wi.gov/Documents/HTCStructuralChecklist.pdf

## Certification categories

17 base categories and 3 subcategories. Relevant: 3.0 Turf and Landscape (lawn care); 5.0 Aquatic and Mosquito (mosquito control on land or larvae in water); 7.1 Structural (pests including vertebrates and birds in and around structures); 7.2 Space and Commodity Fumigation; 7.3 Termite Control; 26.0 Chemigation (includes mosquito misting systems). Anyone applying any pesticide to K-12 public school property must be certified.

Sources: https://fyi.extension.wisc.edu/pat/commercial-certification-categories/, https://fyi.extension.wisc.edu/pat/commercial-how-to-get-certified-and-licensed/

## Wildlife (DNR)

Bats are protected and may not be killed. Exclusions may not be done June 1 to July 31. Inside that window a landowner who believes bats pose a health risk may proceed by submitting the DNR Health Exemption Form within five days of starting the exclusion.

Source: https://dnr.wisconsin.gov/topic/EndangeredResources/batFAQs

## Termites

Two subterranean species are established in Wisconsin, both in the southern half of the state, at the northern edge of their range. Termite work is a smaller line than in southern states.

Source: https://research.fs.usda.gov/treesearch/48731
