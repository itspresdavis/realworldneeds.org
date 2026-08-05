# Resource data pipeline

RWN expands by adding maintained sources, not by counting unverified links. A public record is useful only when a person can understand where it is, what it provides, how to access it, how current it is, and which organization is responsible for the facts.

## Current scale

- 601 reviewed directory records.
- 451 reviewed physical service sites.
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
- access type, cost or eligibility note, services provided, and phone when published;
- published hours when present, or an explicit statement that the source does not supply hours;
- active dates for seasonal programs when supplied;
- original HTTPS source, source owner, source type, sync/review date, and transformation method;
- a warning to confirm rapidly changing schedules or capacity before travel.

The validator rejects duplicates, missing provenance, unsafe source URLs, invalid coordinates, reversed active dates, malformed review dates, and unknown source datasets.

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
3. Inspect sample records and define field mappings without inventing services, eligibility, hours, or precision.
4. Establish a stable source key and deduplication rule.
5. Add minimum-count, required-field, date, coordinate, protocol, and duplicate guards.
6. Label missing fields honestly and suppress expired records by default.
7. Test nearby ranking, mobile density, keyboard use, source links, and map links.
8. Publish the source manifest and keep a correction/removal audit trail.
