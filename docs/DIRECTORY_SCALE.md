# A directory of more than one million real places

Operator target, November 25, 2026: more than one million **distinct physical
places** offering a documented free route to food, water, clothing, shelter or
healthcare. This is a target, not a claim about current coverage or how many
qualifying places have been identified.

## Count the right thing

Keep these measures separate: organizations, physical places, services at a
place, phone/online navigators, imported candidates and published listings.
Five kinds of help at one address must not become five places. A network's
national coverage is not thousands of physical places. A clinic with free
eligible care needs that condition on the listing. Separate departments at a
shared address may be distinct service routes without being distinct places.

The current candidate has 6,137 listings, not 6,137 independently deduplicated
places. Existing navigators and networks remain useful and must not inflate the
physical-location target. Source-ID uniqueness prevents repeated ingestion;
cross-source place resolution is additional work and must retain original IDs,
service scopes, provenance and reversible merge decisions.

## Measured constraints

Before the latest import, Supabase contained 2,332 total records, of which 2,291
were published. The catalog relation including indexes used 10,567,680 bytes;
the database used 38,557,363 bytes. Average stored JSON value was 1,406 bytes.
At that observed relation density, one million records would use approximately
4.53 GB for the indexed catalog alone. This is a linear estimate, not a load
test; audit history, ingestion staging, private accounts and backups add space.

Supabase's documented Free allowance is 500 MB per project:
https://supabase.com/kb/faqs/platform/database-only-cost . No paid upgrade is
authorized or performed. Do not split a production database across unrelated
free projects to evade limits. Measure storage again after each substantial
batch and get an explicit operating budget before a plan change.

The 6,137-record preview's full export is about 14.27 MB. Native GitHub measured
the search index at 683,874 gzip bytes. These are bounded interim payloads;
shipping a million-record catalog to every visitor is not acceptable. A million
static service pages per deployment is also not the intended design.

## Required production architecture before the next large feed

1. Normalize common source/program policy into source and program tables, keep
   stable place IDs, and relate service-specific access and eligibility to each
   place. Retain source record identity and its reviewed version separately.
2. Stage imported candidates privately. Store source terms, payload hashes,
   retrieval time, publisher dates, parser version, exclusions and conflicts.
   Review changes before they enter published results. Provider closure/expiry
   changes must support prompt suppression, not silent stale fallback.
3. Use indexed geographic queries and cursor pagination with bounded responses.
   Public reads expose only published fields under RLS. Accounts stay optional;
   profile answers must never become part of the public catalog or query logs.
4. Load regional data explicitly, preserve local typed-search privacy, serve
   coarse globe density separately from individual results, and fetch detailed
   listing facts on demand. Keep regional offline bundles versioned with clear
   stale-data labels. Do not silently send precise device location to servers.
5. Run synthetic 10k/100k/1m-row performance fixtures on native GitHub Actions
   in an isolated database. Synthetic rows are test data, never real coverage.
   Record query plans, p95 latency, payload bounds, memory and import throughput.
   Fit checks within the user's 2,000 free minutes and do not enable paid runners.
6. Publish a tested release and reconcile database, export and public manifest.
   Database growth alone must never be reported as live website growth.

## Larger acquisition leads, not counted as coverage

| Source | What is established | Work before import |
| --- | --- | --- |
| HHS Title X | 3,743 current public entries; 3,591 reviewed candidates included in this release | Review the 152 held destinations/duplicate candidates; scheduled source refresh |
| Philadelphia food | 405 source rows; 255 included with closure/schedule guards | Resolve 150 held entries, especially schedule and program eligibility questions |
| NYC Food Help | 534 current entries with addresses and schedules | Source-specific redistribution basis; general NYC terms alone do not clear bulk reuse |
| Brazil CNES / SUS basic health units | Official federal catalog and API describe active/deactivated facility data, updated November 2026 | Obtain current facility-level export, dataset-specific terms, SUS participation and active status, physical coordinates and no-cost service scope; exclude private paid-only facilities and historical duplicates |
| India Ayushman Arogya Mandir | Government reported 182,202 functional centers in December 2025 | Current reusable facility inventory, physical destinations, operational status and free-service/eligibility evidence; national totals are not importable records |
| OpenStreetMap drinking water | Structured water/access/fee tags and a large global mapping community | ODbL-compatible separation and attribution; current potable/public/no-fee access, physical destination and source-date checks; do not treat all fountains, taps or private water points as free drinking-water places |

Official source leads:
- https://dadosabertos.saude.gov.br/dataset/cnes_estabelecimentos_cadastrados
- https://apidadosabertos.saude.gov.br/
- https://static.pib.gov.in/WriteReadData/specificdocs/documents/2025/dec/doc20251224744801.pdf
- https://wiki.openstreetmap.org/wiki/Key:drinking_water

Food, water and public healthcare can provide large physical inventories.
Clothing and shelter need stronger local/provider partnerships, intake details,
hours and eligibility review. Neither a shelter address nor an open flag proves
there is a bed today. The next milestone is verified 10,000-place coverage and
regional loading, then measured 100,000-place operation, before a million-place
public claim. No million-place dataset or capacity qualification exists yet.
