# November 25 directory expansion

Candidate: 294 added records; all 1,997 existing published records unchanged. Proposed total: 2,291. Data publication and verification receipts are recorded separately; this document does not claim a production deployment.

## Water: City of Melbourne

338 source assets become 280 human drinking-water listings. Excluded: 55 dog bowls, one asset not owned by the city (1636388), and two possible duplicate fixtures (1360540 beside 1075236; 1479845 beside 1075230). Exclusion is conservative, not an assertion that two provider asset IDs are identical. Retain the excluded IDs in the review receipt; no existing RWN record was deleted.

- [Official dataset and licence](https://data.melbourne.vic.gov.au/explore/dataset/drinking-fountains/): CC BY 4.0. City attribution, licence URL and transformation notice are carried by every record and JSON export. No photos copied.
- [City heat guidance](https://cedrr.le.unimelb.edu.au/files/resource-PDFs/VICGov_Heat-wave_summer-sense-fact-sheet.pdf) identifies the public fountains as free to use.
- Publisher processing timestamp: 2026-11-04T16:02:37Z. The metadata's older general modified date is 2021-09-30. Most asset evaluations are dated February 2026. These are not proof of live flow, water testing or opening hours.
- Directions use the city's fixture coordinates and full written location; names are display labels, not invented street addresses. Dog bowls are never advertised as human drinking water.
- Original snapshot SHA-256: d3786a0c6c3711af5ef587e77e58d09135364ae9646394c798b10546ddbb17b4
- Metadata SHA-256: 0d7e3127a38bc96beb729fb2f81cb3dd5c68e9d7dfd5b54b7c485cf3382f04f4

Use `scripts/import-melbourne-water.mjs SNAPSHOT.json METADATA.json YYYY-MM-DD CANDIDATE.json` for future candidate preparation. It fails closed on partial counts, changed licences, stale processing dates, duplicate source IDs, unknown subtypes and invalid locations. The tool writes a new candidate receipt only; membership changes still need review. Builds never fetch mutable provider data.

## Fourteen reviewed access points

Eight [NYC youth drop-in centers](https://www.nyc.gov/site/dycd/services/runaway-homeless-youth/borough-based-drop-in-centers.page) add clothing, food and hygiene for ages 14–24. [NYC311](https://portal.311.nyc.gov/article/?kanumber=KA-01619) supports free access. Current RHY addresses supersede the older `/families/` page and March 2026 PDF. Do not publish the former Ali Forney, Bronx or Jamaica addresses from those older lists. The apparent Brooklyn ZIP inconsistency is omitted, not guessed. The DYCD phone is used for Ali Forney; NYC311 gives a different phone. All intake should be confirmed. These are not bed-availability records.

Three [NYC TB chest centers](https://www.nyc.gov/site/doh/services/tuberculosis-chest-centers.page) provide appointment-based care at no cost to patients; eligibility and clinic closure exceptions are retained. Washington Heights is closed and excluded. Insurance billing does not create patient copays under the published policy.

[Rhode Island Free Clinic](https://rifreeclinic.org/patients/become-a-patient/) adds uninsured-adult care in Providence with income eligibility, documents, required enrollment and the current waitlist. [Weill Cornell Community Clinic](https://wccc.weillcornell.org/patients) adds only free primary-care services; the [clinic entrance](https://wccc.weillcornell.org/about-us/contact-us) is distinct from its mailing address. Prescription and outside-referral costs are explicitly outside the free listing.

[Breaktime Resource Hub](https://www.breaktime.org/resource-hub) adds Boston clothing, shower and laundry access. Later phases of the building, including shelter and clinical services, are not represented as open.

Reuse scope for these 14 records: bounded factual summaries, published addresses/contacts, concise original descriptions and direct official links. No copied provider inventories, page prose, photos or blanket licence assertion. No coordinates are invented: each uses an explicit address-only access route. Broad source-review date is November 25; schedules remain subject to provider changes.

## Backend and size controls

The database migration enforces one `(datasetId, sourceRecordId)` identity across published **and withheld** records, plus complete, typed, trimmed provenance pairs. A reviewed conflict must fail rather than cause a merge or deletion. Preflight found no duplicate source pairs in the existing 2,038 database rows. Existing unique IDs and normalized exact name/address comparisons also yielded no duplicate candidates; this is not proof that every semantic alias has been resolved.

`scripts/prepare-catalog-import.mjs` generates one insert-only transaction from up to 500 reviewed records. It locks against concurrent writers, refuses changes to existing editorial records or withholding, preserves the audit trigger, and makes exact repeats no-ops. It never updates or deletes catalog records. Native PostgreSQL coverage exercises repeat imports, delimiter/apostrophe handling and atomic conflict rejection. Full record validation still runs in Quality before applying a prepared batch.

Melbourne's shared fields live once in a small factory; the generated source contains only fixture-specific rows. The original repeated-object module was approximately 614 KB; the compact module is approximately 63 KB. The full JSON download is serialized without cosmetic indentation to preserve its 5 MB payload limit while retaining all fields. Route-count ceilings move from 3,200 files/2,900 HTML pages to 3,500/3,200 to admit the added service pages; byte/payload ceilings remain unchanged. Existing payload ceilings remain enforced; future expansion must pass them rather than silently grow the client catalog.

## Deferred sources and next scale work

Vancouver's 278-row feed reports a 2022 processing date, approximate coordinates and seasonal fixtures; held for fresher field-level evidence. NYC water data was not bulk-added from an old inventory. Trussell bulk reuse remains unresolved under the existing policy, so it was not refreshed or expanded. No paid clinic, low-cost-only service, dog bowl or promised future opening was included to inflate totals.

The next architectural step is indexed, paginated geographic/category queries and regional bundles before another large static expansion. Prioritize licensed multi-region human-service feeds, provider correction ownership, explicit hours/eligibility, seasonal expiry, deduplication aliases and regular source review. A large count alone does not measure usable coverage or people helped.
