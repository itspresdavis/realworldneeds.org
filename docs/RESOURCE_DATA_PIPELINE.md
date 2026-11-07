# Resource data pipeline

RWN expands by adding maintained sources, not by counting unverified links. A public record is useful only when a person can understand where it is, what it provides, how to access it, how current it is, and which organization is responsible for the facts.

## Recompute current coverage

Do not reuse a historical audit count as a current impact figure. Generate the
static-snapshot report from the same source tree used for the build:

```sh
node scripts/coverage-report.mjs --date YYYY-MM-DD --output /private/local/path/coverage.json
npm run catalog:health -- --date YYYY-MM-DD --output /private/local/path/health.json
```

`coverage-report.mjs` separates direct records, unique physical service addresses,
address-only sites, referral/network records, source/dataset populations and the
Boston, Brockton, Taunton, Providence, Playas de Rosarito and Tijuana need matrix.
Multiple service routes at one address count once; a second verified service
address counts separately. Normalized addresses are a reproducible measure,
not a claim that every building/entrance alias has been independently deduplicated.
National or regional finders do not count as local physical coverage. Food-benefit
programs do not become immediate meal coverage merely because their category is food.

The optional USDA summer-meal adapter is a separate location-triggered seasonal
population. It is excluded from static totals, even when an older audit recorded
a live feed count. Counts describe catalog coverage, not people helped or
available services.

The November 7 bounded tranche and before/after counts are in
[the priority coverage review](catalog-reviews/2026-11-07-priority-coverage.md).
Run the report again after any catalog change. The report is deterministic for
an explicit date and never advances review dates.

## Record contract

Every reviewed or live physical record must provide:

- a stable RWN ID and, for datasets, the source dataset ID and source record ID;
- service name, written service address and an honest precision label; coordinates only when source-backed (`address` precision preserves usable physical sites without inventing a map point);
- primary and secondary need categories;
- access type, one of the four allowed free-access models, an exact cost or eligibility note, services provided, and phone when published;
- published hours when present, or an explicit statement that the source does not supply hours;
- active dates for seasonal programs when supplied;
- original HTTPS source, source owner, source type, sync/review date, and transformation method;
- a warning to confirm rapidly changing schedules or capacity before travel.

The allowed cost models are `free`, `free-eligible`, `free-navigation`, and `free-option`. A free-navigation record promises that the official search, guidance, or referral is free; it does not silently promise that every downstream provider is free. Category tags cover only the no-cost help supported by the source. Paid clinics, low-cost meals, administrative offices without a public access path, and services whose no-cost status cannot be verified are withheld.

The validator rejects duplicates, missing provenance, unsafe source URLs, invalid coordinates, repeated or unknown categories, missing no-cost language, unsupported free-access models, reversed active dates, malformed review dates, and unknown source datasets.

## Refresh modes

1. **Reviewed provider record** — a human-readable source is checked and represented in the curated directory.
2. **Reviewed dataset snapshot** — an explicit refresh command downloads an official public dataset, validates its expected scale, transforms it deterministically, and writes a versioned generated module. Production builds never download mutable data.
3. **Bounded live query** — the browser requests a limited nearby slice from an authoritative source after user action. The app filters dates and quality flags, keeps the exact device location in memory, and caps displayed records for mobile performance.
4. **Licensed partner feed** — required for broad 211, municipal, or humanitarian directories whose terms do not permit copying. Partner feeds need a data agreement, update schedule, correction channel, deletion process, and field-level provenance.

## Scale milestones

- **1,000 reviewed records:** deepen Massachusetts and nearby states with official WIC, meal, shelter, hygiene, and public-benefit access sites.
- **10,000 accessible records:** add major U.S. city and state feeds through repeatable adapters and source manifests.
- **25,000–100,000:** introduce an indexed service API, geographic partitioning, server-side search, automated expiry, and a provider correction workflow. Do not ship the whole catalog to the globe.
- **250,000–1,000,000:** require licensed data partnerships, durable database infrastructure, versioned ingestion, geospatial indexes, incremental sync, multilingual taxonomy, staffed quality operations, and formal privacy/security governance.

The globe is a view over the directory, not the database. At large scale it should receive only the nearest results and coarse density tiles for the current camera, then resolve exact records on demand.

## Source onboarding checklist

Before an importer is published:

1. Confirm that the source is first-party or authoritative and that access/reuse terms support the intended use.
2. Record ownership, public URL, data endpoint, refresh frequency, license or reuse basis, and known limitations.
3. Inspect sample records and define field mappings without inventing services, eligibility, hours, precision, or no-cost status.
4. Establish a stable source key and deduplication rule.
5. Add minimum-count, required-field, date, coordinate, protocol, and duplicate guards.
6. Label missing fields honestly, suppress expired records by default, and withhold records when free access cannot be supported by the source.
7. Test nearby ranking, mobile density, keyboard use, source links, and map links.
8. Publish the source manifest and keep a correction/removal audit trail.

## Search catalog compatibility and service access

`public/catalog-request.js` exports the exact supported compact search schema,
`SEARCH_CATALOG_SCHEMA` (`2.0`). The index generator and the self-contained
Directory, Saved and offline fallback entries share that value and loader.
A missing, older or unknown schema is rejected before any records become usable;
connection recovery and explicit retry can load a compatible replacement. This
failure preserves Saved IDs and keeps the existing unavailable/retry controls.
The offline action fallback states “Listing actions are unavailable. Reconnect
and retry.” even if the separate availability probe succeeds.

This compatibility break is required by service-specific access routes. Compact
records with an explicit `serviceAccess` contract carry `serviceActions` and
`serviceAccessSummary`, with `lat` and `lng` set to `null`. Older renderers that
ignore the new fields therefore cannot manufacture generic map actions. Stable
IDs, source facts and raw/map reference coordinates remain unchanged. Older
renderers may treat a direct record’s compact coordinates as a destination;
reference coordinates alone do not establish the right entrance for each service.
Never lower the supported schema to make an old cached payload pass. A future
incompatible contract needs a new explicit version and matching loader/tests.

Cached HTML and scripts can outlive a deployment. These checks cover current
entries receiving an older index and historical renderers receiving the new
index. A disconnected device retaining only old code and old data cannot receive
an immediate correction or revocation; it must reconnect to obtain the release.


## Completeness and operational review

The coverage report lists missing structured hours and eligibility separately
from service-specific schedules. It retains the broad review date and latest
scoped service review; a limited phone/schedule correction must not refresh the
whole listing. Narrative detail is preserved even when machine-readable hours
are incomplete. The report's missing-field list prioritizes immediate-need
records for review, not automatic withdrawal or an assertion that a service closed.

`catalog:health` additionally reports source URL syntax, duplicate candidates,
location issues and risk-based overdue review work. Its optional bounded
`--check-links` sample measures reachability only. A 200 response is not a
substantive provider review. Neither command is a deployed monitoring service;
an approved operator, schedule and tested notification destination are still
needed before alert delivery can be claimed. Keep full operational JSON outside
tracked source and review source failures before accepting a candidate refresh.


### Source-link transport boundary

The optional health sample uses HTTPS on port 443, checks every resolved A/AAAA
answer for public destinations, and pins that answer set into a fresh TLS
connection. It rejects a different connected address, follows redirects only
through the same validation, and discards every response body immediately. One
10-second deadline covers DNS, HEAD, optional GET/Range fallback and all redirect
hops; DNS queries are cancellable. Concurrency remains at most four and sampling
at most 200 distinct sources. No credentials or cookies are forwarded.

An HTTP proxy cannot be assumed to honor the locally validated DNS address.
Where a proxy or unsupported managed network policy is configured, the sampler
fails closed with `blocked: proxy-pinning-unavailable` before DNS or HTTP; it
never silently opens a direct connection or honors a bypass exception to evade
that boundary. `blocked` and `unknown` are distinct from provider `broken`.
Aggregate outcome counts are included in the report. The current managed
workspace exercises this blocked path; live-provider reachability is not passed.
A supported proxy-aware pinned transport would need its own reviewed implementation
before this environment can run reachability checks. Manual substantive source
review through an already authorized public-source tool remains separate.
