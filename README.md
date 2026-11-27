# Real World Needs

Real World Needs (RWN) is a humanitarian organization. This repository implements its current public essential-services directory, one program within the broader mission. Distributions, partnerships, volunteering and future programs must not be presented as operational without evidence. The repository's current production and canonical origin is **https://www.realworldneeds.org/**.

The product is deliberately split into two interfaces over the same reviewed catalog:

- an optional interactive globe for geographic exploration; and
- ordinary HTML directory and service pages for fast, accessible, crawlable access without relying on the globe.

## Architecture

The public directory is built as static output and deployed from `dist/` on Vercel. Supabase stores the editorial catalog, contributor identities, private review notes, and immutable change history. Server functions provide HTTP-only authentication and a protected editor workspace. The public directory remains available without an account. The optional /account page stores only consented broad resource topics and a coarse place when explicitly enabled after Auth acceptance. Browsing and local suggestions remain available without an account. There is no personal case-intake form, payment collection, advertising SDK, or third-party analytics SDK.

See [CONTRIBUTING.md](CONTRIBUTING.md), [the editor guide](docs/EDITOR_GUIDE.md), and [the Auth/catalog architecture](docs/AUTH_AND_CATALOG.md).

The build generates:

- `/` — interactive finder and globe;
- `/directory` — searchable text directory with pagination;
- country, region, city, service-category, and bounded city-plus-category pages;
- permanent `/service/<id>` detail pages;
- `/sources` — human-readable source and provenance ledger;
- Privacy, Terms, Accessibility, Transparency, and Editorial Policy pages;
- `/directory.csv` and machine-readable JSON resources; and
- `sitemap.xml` with review-date-aware `lastmod` values.

The interactive homepage uses a single deterministic bootstrap sequence. The application initializes first, followed by presentation, finder refinements, accessibility semantics, and result actions. Presentation CSS is discovered from the document head rather than injected after startup.

## Data and provenance

The published catalog count is recorded in `/data/release.json` and validated against the source records during each build. A bounded live adapter separately queries the official USDA Summer Meals source.

Every record is also stored in Supabase `public.rwn_locations`. Database changes are audited and released through `npm run catalog:export`; `npm run catalog:verify` checks every field against the public snapshot. Core source records live in `src/data/resources.js` and reviewed generated modules under `src/data/generated/`. Published records must include stable identity, public place or coverage information, coordinates where appropriate, service type, practical access information, original HTTPS source, source name, and review date.

The build and tests distinguish exact physical service sites from countrywide or network locators. Locator coordinates are never presented as walk-in addresses.

Official dataset refreshes are explicit maintenance operations and do not run during production builds:

```sh
npm run refresh:data:ma-wic
npm run refresh:data:ny-wic
npm run refresh:data:trussell
npm run refresh:data
```

## Development

Requires Node.js 24.

```sh
npm ci
npm run check
npm run dev
```

`npm run check` performs syntax validation, catalog validation, a deterministic production build, unit tests, policy/privacy assertions, SEO and structured-data checks, generated-link integrity, accessibility checks, performance budgets, offline constraints, and source-provenance validation.

For rendered Chromium verification:

```sh
npm run test:browser:qa
```

The browser suite covers:

1. globe stress, rapid interaction, WebGL recovery, accessibility names, reduced motion, and responsive overflow;
2. institutional homepage behavior on desktop and mobile, including one-scroll mechanics, permanent result links, paused ambient globe motion, touch targets, keyboard search controls, and screenshots;
3. service-page and mobile-directory task completion;
4. hard-offline directory behavior and reconnect safeguards; and
5. local Share/Copy/Print service handoff plus rendered source-ledger verification.

CI uploads short-lived QA screenshots from the rendered browser suite. Mandatory Playwright coverage also runs in Chromium, Firefox, and WebKit:

```sh
npx playwright install --with-deps chromium firefox webkit
npm run test:cross-browser
```

The install command may need administrator permission for Linux system packages. Do not disable dependency validation or omit an engine to obtain a passing result. WebKit automation does not establish physical Safari/iOS compatibility. See [exact-commit local validation](docs/QUALITY_VALIDATION.md) for Linux and macOS provenance, isolated profiles, and release requirements.

### Native Firefox fallback check

Against an already running build, with Python 3, Firefox and geckodriver installed:

```sh
npm run test:browser:firefox -- --base-url http://127.0.0.1:4187 \
  --output-dir "$HOME/.local/state/rwn-web-quality/firefox-$(date +%Y%m%dT%H%M%S)"
```

The dependency-free runner creates a private temporary profile and deliberately disables WebGL to test the text fallback; ordinary Firefox may support WebGL. It checks 1440, 390 and 320 pixel layouts, search and filters, service links, local saved services, and mobile menu focus. The required new output directory must be outside the checkout and retains screenshots, browser errors, release metadata and SHA-256 evidence. It neither builds nor starts a server, and is an explicit supplementary check rather than part of the automatic Quality gate. For an isolated build, start its existing `scripts/serve.mjs` on port 4187 from that build's workspace. The Boston fixture expects 22 matches; `--expected-boston-results` permits a deliberate catalog-fixture update. Override `--firefox`, `--geckodriver` or `--profile-root` if needed; snap Firefox requires a profile parent it can access.

## Search and low-connectivity behavior

Homepage search and filters run locally. The text-directory search lazily loads a fixed same-origin static index; the typed query is not placed in that request URL or sent to an RWN endpoint. Both surfaces use the same word-start matcher and relevance rules: exact places, program words, and street phrases outrank incidental prefixes. Partial typing remains supported. The recognized complete program query WIC (including W.I.C.) requires an exact WIC token, returning 395 evidenced matches rather than implying that Wick provides WIC. Wi still finds WIC and Wick, and Wick still finds that place; other words keep the ordinary prefix rule. Diacritics, common punctuation, curated need aliases, and multiword provider/address queries are normalized consistently.

Homepage search fields are prepared in bounded idle slices; typing prioritizes the remaining slices and shows preparation feedback while the first search waits, instead of synchronously normalizing the whole catalog. Search history stays in browser history state rather than URLs. The directory entry includes the shared matcher and result renderer in one offline-safe file, with a pinned development-only minifier keeping it under the existing client-size budget. The static index preserves an address phrase, deduplicated search words, and evidence for true multiword aliases, leaving displayed listing fields and source availability notices unchanged.

Supported browsers register a same-origin service worker after page load. The offline cache is deliberately narrow: lightweight public directory assets, the static search index, the manifest, the RWN mark, and visited directory pages. Service-detail pages and RWN API requests are not intentionally cached.

Connectivity is checked with an uncached same-origin release probe rather than trusting only `navigator.onLine`. When offline, the directory clearly identifies cached results and blocks stale service-detail navigation until connectivity returns. A controlled directory navigation also recovers a compatible saved page after HTTP 503/504 or a six-second header/body deadline. That response starts with an offline warning and checks the actual directory route, including its complete body, before allowing online links again. Genuine 404/410 responses remain visible and invalidate the exact saved page; individual service pages remain network-only.

## Privacy and security

- Public directory search and filtering are local to the browser. Contributor workspace queries use authenticated APIs.
- Contributor sessions use HTTP-only cookies and server-side user verification; row policies protect private notes and editor access.
- Device location is requested only after an explicit action and held in memory.
- Saved records store only service IDs in local storage.
- Shared selected-service IDs use URL fragments rather than request paths.
- First-party diagnostics are sampled and reduced to coarse route and screen-size classes before transmission.
- Exact paths, service IDs, cities, search terms, saved services, device location, and exact viewport dimensions are not sent by the RWN telemetry client.
- Production responses use CSP, HSTS, no-referrer, clickjacking protection, MIME-sniffing protection, a restrictive Permissions Policy, and same-origin worker controls.

See `/privacy` for the public description of these behaviors.

## Accessibility

The globe is optional. The text directory and service pages use ordinary permanent links and remain the primary fallback for assistive technology, constrained devices, or visitors who prefer a list.

Automated checks protect keyboard search behavior, visible focus treatment, reduced-motion behavior, accessible regions and names, minimum mobile touch targets, text contrast, offline focus recovery, and service handoff controls. RWN is working toward WCAG 2.2 Level AA and does not claim formal certification.

## Performance boundaries

Critical client modules and generated search/catalog assets have explicit CI size ceilings. Crossing a budget should trigger an architectural split rather than silently increasing the initial payload.

The homepage uses one content-derived release hash across application and presentation assets so cache invalidation follows a single deterministic release identity.

## Release gate

Pull requests and `main` run the GitHub `Quality` workflow. A release is expected to pass:

1. syntax and catalog validation;
2. deterministic production build;
3. policy, privacy, SEO, accessibility, provenance, offline, and performance tests;
4. generated-page canonical and structured-data checks;
5. internal-link integrity checks;
6. rendered Chromium QA on desktop and mobile, including native globe touch; and
7. Chromium, Firefox, and WebKit assistance journeys and accessibility checks.

Vercel builds the static `dist/` output from source. A READY deployment is not evidence that Quality passed. Required GitHub checks and Vercel Deployment Checks must be verified in account settings; workflow files alone do not enforce protection. Until those settings are available, the exact-commit local validator and release tooling provide explicit evidence, with all five stages required and production staged without assigning domains. A passing receipt does not grant permission to merge or publish.

`dist/`, `node_modules/`, and browser reports are generated local artifacts. `npm ci` and `npm run build` reproduce them from authored source and the lockfile. `node scripts/check-repository-artifacts.mjs` rejects these paths in the Git index without deleting local files.

## Operational boundary

The codebase intentionally does not represent unverified future operations as current capabilities. Public donation processing, public case intake, partner accounts, allocations, disbursements, and impact reporting remain disabled until the organization has the legal, governance, financial, safeguarding, and operational controls required to run them safely.

Relevant design documents live in `docs/`, including platform data modeling, donation controls, and professional launch requirements.

## Current development and testing policy

Use native GitHub Actions on standard Linux runners within the included 2,000-minute allowance. SSH and rwn-mini are no longer development or test dependencies; do not use a local fallback as release qualification. Personal-account rollout requirements are in [PERSONAL_ACCOUNTS.md](docs/PERSONAL_ACCOUNTS.md).
