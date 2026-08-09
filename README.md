# Real World Needs

Real World Needs (RWN) is a static, privacy-minimizing essential-services directory. The production site is [realworldneeds.org](https://www.realworldneeds.org/).

## What this repository contains

- A browser-rendered 3D globe plus a fully usable text directory.
- Source-backed public resource records with review dates, access details, provenance, and map coordinates where appropriate.
- Progressive Natural Earth close-view boundaries and NASA Blue Marble imagery for capable devices.
- Browser search, filters, saved-service IDs, optional location sorting, and permanent service detail URLs.
- Search-engine-readable country, region, city, help-category, and bounded city-plus-need landing pages generated from the reviewed catalog.
- Privacy, Terms, Accessibility, Transparency, and Editorial Policy pages.
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

`npm run check` validates JavaScript syntax, resource data, generated search/SEO output, privacy and policy invariants, performance budgets, internal links, generated HTML structure, and the production build. The local site is served at `http://localhost:5173` by the development command.

For rendered browser verification:

```sh
npm run test:browser:chaos
```

That command runs three Chromium gates: the original globe stress/interaction test, the finder/directory/mobile test, and an independent service-landing-page test. CI also uploads desktop/mobile screenshots from the browser tests as short-lived visual QA artifacts.

## Data standard

Resource records live in `src/data/resources.js` and reviewed generated modules under `src/data/generated/`. Each record must have a stable ID, name, public place or coverage area, coordinates, listing type, aid category, practical access information, original HTTPS source, source name, and ISO review date. `npm run check` rejects missing fields, unsafe URLs, duplicate IDs, invalid coordinates, and implausible dates.

Official dataset refreshes are explicit and never run during the production build. Use `npm run refresh:data:ma-wic`, `npm run refresh:data:ny-wic`, or `npm run refresh:data` to regenerate reviewed snapshots. `src/data/live-sources.js` contains the bounded USDA query, source registry, date filters, privacy rounding, and record transformation. The public source manifest is generated at `/data/sources.json`.

Physical service-site markers should use the provider-published public location. Official locators and networks use representative points and must never be described as walk-in sites. See the public [Editorial Policy](https://www.realworldneeds.org/editorial-policy).

## Static directory and search architecture

The production build creates:

- `/directory` and paginated HTML directories;
- country, region, and help-category collections;
- local city pages only when a locality has at least three reviewed records;
- city-plus-need pages only when that locality has at least three reviewed records for the need;
- permanent `/service/<id>` detail pages;
- `/directory.csv`, `/data/resources.json`, and `/data/sources.json`;
- `/data/search-index.json`, a compact static search index; and
- a sitemap whose `lastmod` values come from the relevant listing review dates instead of one synthetic global date.

Generated local paths are collision-safe and locality-aware. Country pages link to local pages with ordinary anchors, local pages link to need-specific pages where sufficiently deep, and service pages link to related permanent service URLs. This keeps the crawl graph useful even without the interactive globe.

The text-directory search loads the static search index lazily. Search terms remain in the browser: the request for the index is a fixed same-site asset request and does not contain the visitor’s query. Search scope follows the current page, so a country directory searches that country’s reviewed records while the root directory searches the full catalog.

## Performance boundaries

The finder intentionally keeps explicit parse/download ceilings in tests. The three generated client catalog modules currently total about 1.3 MB uncompressed and have a hard aggregate CI ceiling of 1.5 MB. Crossing that boundary should trigger an architectural split between lightweight map/search summaries and full service details rather than silently increasing initial payload forever.

Below-the-fold editorial sections use safe rendering containment, directory search assets have independent content-derived cache keys, and large interactive behavior is browser-tested on desktop and mobile dimensions.

## Privacy and security model

- Search and filtering run locally in the browser.
- Location is requested only after an explicit click, held in memory, and used to rank exact physical sites separately from countrywide/global locators.
- Saved records are service IDs in local storage; the footer provides a clear-data control.
- Shared resource IDs use URL fragments so they are not sent in HTTP request paths.
- The static directory search never sends the typed query to RWN.
- First-party technical performance sampling is approximately 2% and is reduced before transmission to broad route classes (`finder`, `service`, `directory`, `policy`, etc.) and broad screen-size classes. It does not send the exact path, service ID, city, search query, exact viewport dimensions, saved services, device location, reduced-motion preference, or connection type.
- Client-error telemetry is capped per page and sends only coarse route context plus sanitized technical error information.
- Vercel provides hosting and standard edge/security logs.
- Production responses use CSP, HSTS, no-referrer, clickjacking protection, MIME sniffing protection, origin isolation, and a restrictive Permissions Policy.

See `/privacy` for the public description of these behaviors.

## Accessibility model

The globe is optional. The text directory and service pages remain ordinary HTML with permanent links, and the main finder has a direct route to that interface. Keyboard focus, reduced-motion, forced-colors/high-contrast behavior, screen-reader announcements, mobile touch targets, and core text color contrast are protected by automated tests. RWN is working toward WCAG 2.2 Level AA but does not claim formal conformance.

## Deployment and release gates

The Vercel project builds with `npm run build` and publishes `dist/`. The build copies reviewed first-party assets and lockfile-pinned Three.js browser modules; it performs no network downloads.

Before merge, the GitHub Quality workflow must pass:

1. syntax and data validation;
2. the deterministic production build;
3. unit/policy/privacy/SEO/accessibility/performance tests;
4. generated-page canonical/JSON-LD/HTML checks;
5. internal-link integrity checks;
6. globe browser stress testing;
7. finder, whole-directory search, keyboard-focus, and mobile browser testing; and
8. service landing-page browser testing with visual screenshots.

Do not add forms, accounts, donations, personal-data collection, third-party analytics, or new tracking dimensions without first updating the privacy architecture, public policies, retention rules, consent controls where required, and organizational contact details.

## Governance still required

The code cannot establish the organization’s legal identity. Before representing RWN as a fully registered or legally reviewed nonprofit service, authorized leadership and counsel must confirm the legal entity name and status, jurisdiction, registered address, public privacy/accessibility/corrections contact, retention schedule, governing-law position, safeguarding process, and policy owner.
