# Public-release audit and clinic/food expansion

The November 25 audit found **1,992** records in the actual production export,
release `0b2bd1f1b798`, reviewed through October 10. The database had 2,291
published records. The previous PR was still a draft preview, and database
inserts do not rebuild this static public directory. A database count is not a
public release count. Production must be checked by its exported IDs and release
manifest after a separately authorized promotion.

This candidate adds **3,846** listings: **3,591 Title X clinics** and **255
Philadelphia food/meal sites**. Expected candidate total: **6,137 published**.
No existing record is deleted, merged or reclassified. Automated validation runs
on native GitHub Actions only; this document does not claim a passing run.

## Federal Title X finder

- Public source: https://reproductivehealthservices.gov/
- Public endpoint: https://api.reproductivehealthservices.gov/v1/clinics?latitude=39&longitude=-98&range=5000&limit=5000&offset=0
- Retrieved complete response: 3,743 entries, offset 0, matching reported count.
- Raw response SHA-256: `483d27d3ba0274c9ccbc9c64b025af2a37ea2503dad8285b75fb4734f79fb2f3`.
- Current finder, not the older downloadable PDF. No per-clinic update date is
  supplied by the index, and no update date is invented.
- The federal no-cost policy is documented at
  https://opa.hhs.gov/sites/default/files/2025-08/title-x-family-planning-program-2025.pdf
  and the current program FAQ at
  https://opa.hhs.gov/grant-programs/funding-opportunities-title-x-faqs .
- Only Title X services for clients with family income at or below 100% of the
  federal poverty level are represented as free. Other care/referrals may cost
  money. Clinic age rules, appointments and individual eligibility must be
  confirmed with the clinic. The import does not assert every clinic offers
  every service described by the national program.
- Reuse scope: factual clinic identity, physical destination, coordinates and
  public phone, with original RWN summaries. No provider prose, images or logos
  are copied. HHS identifies this as public-use information in its website
  disclaimers; no blanket licence for third-party materials is asserted.
- 152 held: 48 incomplete/mailing-only destinations and 104 possible duplicate
  entries. Every member of an ambiguous new group is held rather than choosing
  a winner or deleting existing records. All exclusions remain in the review
  receipt outside source control.
- 3,591 retained across 52 state/territory codes. Puerto Rico and U.S. Virgin
  Islands keep their geography labels. Hours are explicitly absent from this
  imported index; direct official clinic links expose the source's detail page.

## Philadelphia free food and meals

- Source and terms: https://opendataphilly.org/datasets/free-food-and-meal-sites/
- City ArcGIS item: `5825a32bb8844bb097f7a16d4fbf4f23`, layer `free_meal_sites`.
- Raw complete response: 405 records; SHA-256
  `09e9c33ae18ae13fa478fe268cc0942bedb4bf99d80ef2089b4c32cbc7857815`.
- Source metadata SHA-256:
  `544dd65e53124edb853cec90fb680806c295a2a103dcfab9c56dad9a0db41e9e`.
- Dataset edit date: November 25, 2026. It does not establish the last time each
  provider was contacted. The City publishes the feed as open data, as is and
  without warranty, under City terms; attribution accompanies all exports.
- Only active, nonseasonal Food Site and General Meal Site entries enter this
  candidate. Benefits offices, senior-specific and student sites need separate
  eligibility review. Closed locations never become new published listings.
- 150 held: 92 inactive, 26 needing separate program review, 22 possible
  duplicates, 9 malformed schedules and 1 incomplete/out-of-city destination.
- Day-of-month schedule exceptions and ZIP restrictions are preserved. The
  source occasionally places an email in its phone field; it is not converted
  into a telephone action. Missing hours never imply all-day availability.

## Other reviewed lead

NYC Food Help exposes 534 current entries and has useful program/schedule fields.
Its ArcGIS item links the general NYC copyright-reserving terms rather than an
explicit open-data release. No bulk import is included here pending a clearer
source-specific reuse basis. The acquired source is retained for review, not
published. This is distinct from the small existing original provider summaries.

## Engineering and release

`scripts/import-public-services.mjs` prepares offline candidates from captured
source files, with completeness, identity, coordinate, closure, date and schedule
guards. Generated modules store common policy/provenance text once. Inserts use
the existing bounded, insert-only transactional importer and source-identity
unique index; unchanged originals and withheld records must reconcile afterward.

The static release now has decoded and gzip payload limits, including the data
modules loaded by the interactive finder. The full JSON export is not the compact
search index. Gzip is measured as a build budget; actual hosting compression must
be observed separately. This remains a bounded ~6,000-record architecture, not
the final design for hundreds of thousands. Regional loading and indexed
geographic queries remain necessary before another order-of-magnitude expansion.

Release acceptance requires the exact GitHub-tested source, a ready hosted
candidate, matching exported IDs/counts, and explicit confirmation of the
production manifest after promotion. Preview, database and production status
must always be reported separately.
