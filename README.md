# Real World Needs

Real World Needs (RWN) is a static, privacy-minimizing essential-services directory. The production site is [realworldneeds.org](https://www.realworldneeds.org/).

## What this repository contains

- A browser-rendered 3D globe plus a fully usable text directory.
- Source-backed public resource records with review dates, access details, provenance, and map coordinates where appropriate.
- Progressive Natural Earth close-view boundaries and NASA Blue Marble imagery for capable devices.
- Browser search, filters, saved-service IDs, optional location sorting, permanent service detail URLs, and privacy-safe service sharing/copying/printing.
- Search-engine-readable country, region, city, help-category, bounded city-plus-need, service, transparency, and source-provenance pages generated from the reviewed catalog.
- A human-readable `/sources` provenance ledger plus machine-readable source, resource, release, CSV, and search-index outputs.
- A release-scoped low-connectivity directory cache that can reopen the lightweight directory and static catalog search after a connection drops without caching RWN API requests, search terms, or individual service-detail pages.
- Privacy, Terms, Accessibility, Transparency, Editorial Policy, and source-provenance surfaces.
- A deterministic static build for Vercel. There is no account system, donation flow, case-intake form, advertising SDK, or third-party analytics SDK.

## Current release boundary

The current build validates **1,984 reviewed directory records** plus a bounded live adapter for the official USDA Summer Meals feed. Catalog size is intentionally not presented as an impact claim: directory coverage and people helped are different things.

The site publishes only public service information that passes the catalog policy and source/provenance checks. Verified-needs publishing, public intake, partner accounts, donation processing, allocations, disbursements, and impact reporting remain disabled until RWN has the organizational and operational controls required to run them safely.

## Operating documentation

- `docs/PLATFORM_DATA_MODEL.md` defines future need, organization, allocation, delivery, evidence, correction, and audit records.
- `docs/DONATION_CONTROLS.md` defines payment, restricted-fund, authorization, reconciliation, and reporting controls required before accepting money.
- `docs/PROFESSIONAL_LAUNCH_REQUIREMENTS.md` defines the legal, program, logistics, finance, privacy, security, and governance gates for expanded operations.

## Local development

Requires Node.js 24.

```sh
npm ci
npm run check
npm run dev
```

`npm run check` validates JavaScript syntax, resource data, generated search/SEO output, privacy and policy invariants, low-connectivity boundaries, source-ledger integrity, structured open-data metadata, performance budgets, internal links, generated HTML structure, and the production build. The local site is served at `http://localhost:5173` by the development command.

For rendered browser verification:

```sh
npm run test:browser:chaos
```

That command runs **five isolated Chromium gates**:

1. globe stress, rapid interaction, WebGL context loss, reduced motion, accessibility names, and mobile overflow;
2. finder semantics, permanent detail links, whole-catalog directory search, scoped category controls, keyboard focus, local crawl graph, and mobile taskbar behavior;
3. independent service-landing-page and mobile-directory task-flow verification;
4. hard-offline directory verification with a browser-level network cut, visible reconnect warning, blocked stale service navigation, uncached API requests, and cached catalog search; and
5. private service handoff verification for Share/Copy/Print plus rendered source-ledger trust/provenance checks.

CI uploads desktop/mobile screenshots from these browser tests as short-lived visual QA artifacts. Superseded Quality runs on the same ref are canceled automatically so the current head is the release signal.

## Data standard

Resource records live in `src/data/resources.js` and reviewed generated modules under `src/data/generated/`. Each record must have a stable ID, name, public place or coverage area, coordinates, listing type, aid category, practical access information, original HTTPS source, source name, and ISO review date. `npm run check` rejects missing fields, unsafe URLs, duplicate IDs, invalid coordinates, and implausible dates.

Official dataset refreshes are explicit and never run during the production build. Use `npm run refresh:data:ma-wic`, `npm run refresh:data:ny-wic`, or `npm run refresh:data` to regenerate reviewed snapshots. `src/data/live-sources.js` contains the bounded USDA query, source registry, date filters, privacy rounding, and record transformation. The public source manifest is generated at `/data/sources.json`, while `/sources` turns the same provenance model into a human-readable ledger.

Physical service-site markers should use the provider-published public location. Official locators and networks use representative points and must never be described as walk-in sites. See the public [Editorial Policy](https://www.realworldneeds.org/editorial-policy).

## Static directory, search, and provenance architecture

The production build creates:

- `/directory` and paginated HTML directories;
- country, region, and help-category collections;
- local city pages only when a locality has at least three reviewed records;
- city-plus-need pages only when that locality has at least three reviewed records for the need;
- permanent `/service/<id>` detail pages;
- `/sources`, a human-readable provenance ledger for structured source families and record-level original-source groups;
- `/directory.csv`, `/data/resources.json`, `/data/sources.json`, and `/data/release.json`;
- `/data/search-index.json`, a compact static search index; and
- a sitemap whose `lastmod` values come from the relevant listing/source review dates instead of one synthetic global date.

Generated local paths are collision-safe and locality-aware. Country pages link to local pages with ordinary anchors, local pages link to need-specific pages where sufficiently deep, service pages link to related permanent service URLs, and the Transparency Center links to the source ledger and machine-readable audit files. This keeps the crawl graph useful even without the interactive globe.

The text-directory search loads the static search index lazily. Search terms remain in the browser: the request for the index is a fixed same-site asset request and does not contain the visitor’s query. Search scope follows the current page, so a country directory searches that country’s reviewed records while the root directory searches the full catalog.

The Transparency Center publishes `Dataset` and `DataCatalog` structured data for the public directory, with CSV and JSON distributions, the latest source-review date, and a narrow description of the review method. RWN does not publish an unverified dataset license, partnership, endorsement, or legal-organization claim.

## Low-connectivity behavior

Supported browsers register a same-origin service worker after page load. It caches only a deliberately small public set: the lightweight directory shell, directory styles/scripts, the static search index, the RWN mark, the web-app manifest, and visited directory pages. RWN API requests are excluded, service-detail pages are not intentionally cached, and cache keys discard query strings.

Connectivity state is not trusted solely from `navigator.onLine`. Directory pages use an uncached same-origin probe against `/data/release.json`; when that probe fails, the UI visibly enters offline mode, labels results as an offline copy, tells the visitor to reconnect before relying on current availability, and blocks service-detail navigation until connectivity returns.

The cache name is content-derived from directory/data/build inputs. A new release receives a new offline cache ID, and service-worker activation deletes older `rwn-offline-*` caches so visited directory snapshots cannot persist indefinitely across releases. The existing **Clear browser data** control also deletes RWN offline caches.

## Service handoff behavior

Every generated service page surfaces task-first actions near the top: original source, phone when published, Apple/Google directions for exact sites, and the RWN interactive map. A separate local-only handoff surface lets a visitor:

- open the native Share sheet (or copy the URL as fallback);
- copy the public service details, RWN URL, original source, and confirm-before-go reminder; or
- print a clean version of the listing.

Those Share/Copy/Print controls do not send a request to an RWN endpoint, create storage, or tell RWN who the visitor shared with. Print CSS removes interactive chrome and exposes external URLs in the printed copy.

## Performance boundaries

The finder intentionally keeps explicit parse/download ceilings in tests. The three generated client catalog modules currently total about 1.3 MB uncompressed and have a hard aggregate CI ceiling of 1.5 MB. Crossing that boundary should trigger an architectural split between lightweight map/search summaries and full service details rather than silently increasing initial payload forever.

The whole-catalog search index has its own explicit 1.5 MB uncompressed ceiling. Below-the-fold editorial sections use safe rendering containment, directory/search/service-action assets have content-derived release keys where appropriate, and large interactive behavior is browser-tested on desktop and mobile dimensions.

## Privacy and security model

- Search and filtering run locally in the browser.
- Location is requested only after an explicit click, held in memory, and used to rank exact physical sites separately from countrywide/global locators.
- Saved records are service IDs in local storage; the footer provides a clear-data control.
- Shared resource IDs use URL fragments so they are not sent in HTTP request paths.
- The static directory search never sends the typed query to RWN.
- The low-connectivity cache stores public same-site directory assets/data only; it excludes RWN API requests, typed search terms, and intentional service-page history.
- First-party technical performance sampling is approximately 2% and is reduced before transmission to broad route classes (`finder`, `service`, `directory`, `policy`, etc.) and broad screen-size classes. It does not send the exact path, service ID, city, search query, exact viewport dimensions, saved services, device location, reduced-motion preference, or connection type.
- Client-error telemetry is capped per page and sends only coarse route context plus sanitized technical error information.
- Vercel provides hosting and standard edge/security logs.
- Production responses use CSP, HSTS, no-referrer, clickjacking protection, MIME sniffing protection, origin isolation, a restrictive Permissions Policy, and same-origin-only worker execution.

See `/privacy` for the public description of these behaviors.

## Accessibility model

The globe is optional. The text directory and service pages remain ordinary HTML with permanent links, and the main finder has a direct route to that interface. Keyboard focus, reduced-motion, forced-colors/high-contrast behavior, screen-reader announcements, mobile touch targets, core text color contrast, offline focus recovery, and service handoff controls are protected by automated tests. RWN is working toward WCAG 2.2 Level AA but does not claim formal conformance.

## Installed web-app entry points

`site.webmanifest` identifies the RWN mark as the installable icon and exposes task-first shortcuts for Find help, Food, Shelter, Health, and the lightweight Directory. These routes are ordinary public URLs and do not create an account or background personal-data channel.

## Deployment and release gates

The Vercel project builds with `npm run build` and publishes `dist/`. The build copies reviewed first-party assets and lockfile-pinned Three.js browser modules; it performs no network downloads.

Before merge, the GitHub Quality workflow must pass:

1. syntax and data validation;
2. the deterministic production build;
3. unit/policy/privacy/SEO/accessibility/performance/offline/provenance tests;
4. generated-page canonical/JSON-LD/HTML checks;
5. internal-link integrity checks;
6. globe browser stress testing;
7. finder, whole-directory search, keyboard-focus, and mobile browser testing;
8. service landing-page/mobile-directory browser testing;
9. hard-offline browser testing with reconnect and stale-navigation safeguards; and
10. private service-handoff plus rendered source-ledger browser testing with visual screenshots.

Do not add forms, accounts, donations, personal-data collection, third-party analytics, or new tracking dimensions without first updating the privacy architecture, public policies, retention rules, consent controls where required, and organizational contact details.

## Governance still required

The code cannot establish the organization’s legal identity. Before representing RWN as a fully registered or legally reviewed nonprofit service, authorized leadership and counsel must confirm the legal entity name and status, jurisdiction, registered address, public privacy/accessibility/corrections contact, retention schedule, governing-law position, safeguarding process, and policy owner.
