# Resource data pipeline

RWN expands by adding maintained sources, not by counting unverified links. A public record is useful only when a person can understand where it is, what it provides, how to access it, how current it is, and which organization is responsible for the facts.

## Current scale

- 586 reviewed free-access directory records.
- 442 reviewed physical service sites.
- 17,442 USDA summer-meal sites active at the August 5, 2026 audit, queried live in bounded nearby searches.
- 637 of those active USDA records were in Massachusetts.
- 101 Massachusetts WIC offices carry official coordinates, phone numbers, and published hours.
- 293 New York WIC sites carry state-published coordinates, phones, and permanent or temporary site status.

Counts describe records, not people helped or services guaranteed. Seasonal and live counts always need an as-of date.

## Record contract

Every reviewed or live physical record must provide:

- a stable RWN ID and, for datasets, the source dataset ID and source record ID;
- service name, written address, latitude, longitude, and an honest precision label;
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
