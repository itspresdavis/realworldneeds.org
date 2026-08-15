# RWN-WEB Overhaul Report

**Audit and implementation completed:** 2026-08-15

This report records the changes made to RWN-WEB, the evidence used to validate them, and the limitations that remain. It is intentionally factual: the site is substantially stronger, but a directory that routes people to real-world aid must still be maintained as service details change.

## Executive assessment

The original site had strong raw ingredients—a large source-backed catalog, a WebGL globe, static service pages, and an offline-capable finder—but several implementation choices made it feel less trustworthy and less usable than the organization it represents. The most consequential issues were a fragile post-build globe patch pipeline, a zoom gesture that could move both the page and globe at once, a massive fully expanded directory page, and serious category imbalance in primary listings.

The overhaul converts those weak points into maintainable source code, an interaction model that respects page scroll, a more compact and action-first directory, and an independently verified expansion of high-need listings. The result is not presented as “perfect”: core global coverage remains uneven and should be continued with the same source-first verification standard.

| Area | Before | Delivered |
| --- | --- | --- |
| Globe source of truth | 47 brittle post-build text patches changed production behavior after source build | Patches folded into `src/app.js`; obsolete patch scripts removed; source and production behavior aligned |
| Globe wheel behavior | Ctrl/Cmd zoom also moved page from 600 px to 480 px in the same gesture; plain wheel was inert on globe | Gesture ownership is stable: plain vertical wheel scrolls page, modifier/horizontal gestures zoom globe without moving page |
| Zoom quality | Zoom lacked cursor anchoring; marker layer hid as it moved | Pointer-anchored eased zoom; zoom range reaches 11.65×; labels fade while markers remain mounted |
| Globe fallback | Dead 2D-canvas fallback code | Removed 2D path; clear WebGL-unavailable state sends people to the text directory |
| Directory page 1 | 80 fully expanded cards; 34,519 px tall; first card 512 px | 60 action-first cards; 18,359 px tall; first card 284 px |
| Directory controls | Duplicated call/map/detail actions plus duplicate footer links | One immediate action row plus a native, accessible disclosure for hours, location, source, and verification detail |
| Mobile directory | Explicit controls mixed with undersized tap targets | 0 under-40px explicit directory controls in real-browser QA; no horizontal overflow |
| Added free-service records | 1,984 records, heavily skewed toward food | 2,019 records; 35 new independently checked records in water, shelter, clothing, hygiene, health, food, and referral |
| Evidence on new records | No dedicated expansion audit trail | Each new record carries an official source URL, source detail, review date, and quoted no-cost wording; rejected candidates are documented rather than silently included |

## Globe work

The globe is now driven from a single source path. The previous build process patched compiled output after the build, which meant source files and shipped behavior diverged. This was replaced with source-level code and tests. The unused canvas fallback was removed rather than kept as unreliable dead weight; people without WebGL receive a clear path to the directory.

The interaction model now classifies wheel gestures by intent and keeps that ownership for the life of the gesture. Vertical page-scrolling remains page-scrolling. Zoom gestures are isolated from page scroll, support modifier and horizontal/trackpad intent, and use pointer anchoring so the geography under the cursor stays stable. This directly eliminates the page/globe fight reproduced during the audit.

The globe also gained a dedicated regression probe, `npm run qa:globe-scroll`, covering page scroll, modifier zoom, horizontal gesture zoom, deep zoom, HD data state, overflow, marker mounting, console errors, and uncaught exceptions. All 15 checks pass.

## Directory work

The directory retained its useful whole-catalog client search and crawlable static pages, but its browse cards tried to be full service-detail pages. Each listing showed all operational details and multiple repeated actions. It made page 1 longer than 34,000 pixels and increased cognitive load for someone looking for immediate help.

The new card hierarchy answers the urgent questions first: **what the service is, where it is, whether access is free, how to access it, and what action to take**. Call, Directions, and Open listing are the only immediate buttons. Hours, exact location or coverage, phone, travel caveats, the official source, and globe link remain in a native `<details>` disclosure. The information remains in server HTML, so it stays printable, crawlable, and discoverable by the search index.

The browse page now shows 60 compact records. Whole-catalog search still searches all 2,019 records and replaces the paged list cleanly. A new real-browser directory probe (`scripts/qa-directory.mjs`) verifies 19 behaviors: height, density, filter availability, search and clear behavior, empty-results guidance, mobile overflow, mobile control sizing, keyboard skip link, service source/review metadata, and console/exception cleanliness. All 19 checks pass.

## Verified resource expansion

The catalog expansion focuses on practical needs that tend to be omitted from generic directories: drinking water, cooling/warming relief, free showers and toilets, period products, diapers, clothing, pet food, legal support, library internet, and free wifi/charging. Food, water, shelter, and clothing remain primary navigation priorities.

New examples include NYC shelter intake guidance, Berlin Kältehilfe, Chicago warming centres, LA County cooling centres, London/Paris/NYC/Sydney water resources, mobile showers, public toilet information, period-product and diaper programs, verified clothing support, pet food, legal aid, library access, and LinkNYC.

| Category | Before | After |
| --- | ---: | ---: |
| Food | 1,820 | 1,827 |
| Water | 3 | 8 |
| Shelter | 20 | 25 |
| Hygiene | 14 | 19 |
| Clothing | 1 | 6 |
| Health | 0 | 4 |
| Referral | 126 | 130 |

> **Important context:** category totals are not a measure of need or service capacity. Food still dominates because multiple food-bank data sources provide large, structured location sets. The added non-food records improve representation, but they do not make global coverage comprehensive.

Eight candidates were rejected instead of published because the official source could not confirm free access, the cited link was wrong or non-secure, the page was bot-blocked without adequate verification, or the service was already present. The rejection list lives in `src/data/verified-expansion.js` as `REJECTED_CANDIDATES`.

## Release validation

Validation was run after the final build:

| Check | Result |
| --- | --- |
| Static syntax, data schema, production build, and unit suite (`npm run check`) | **153 / 153 passed** |
| Dedicated directory browser QA | **19 / 19 passed** |
| Dedicated globe interaction QA | **15 / 15 passed** |
| Browser crash suite | Passed: desktop/mobile, rapid search/filter churn, globe input, WebGL context loss, reduced motion, offline search/navigation, service actions, provenance and handoff flows |
| Deep-globe browser QA | Passed at 7.53× with WebGL live and bounded layout |
| Mobile service/directory QA | Passed: source action, phone/maps next steps, touch targets, no overflow |
| Offline QA | Passed: cached navigation, offline search, reconnect warning, no cached API requests |

## Commits

| Commit | Summary |
| --- | --- |
| `5c2fbf86` | Remove unused 2D canvas globe and route WebGL failures to the text directory |
| `9fdd12b0` | Rebuild globe zoom with gesture-aware ownership, pointer anchoring, and flicker-free markers |
| `d88a7627` | Add 35 independently verified free-service records across core and adjacent needs |
| `aef1deaf` | Redesign directory into compact action-first service cards |

## Remaining work and operating discipline

The site is stronger and the tests are meaningful, but aid directories require continuous maintenance. The next responsible steps are not purely visual:

1. Continue expanding **water, shelter, clothing, hygiene, and health** with operator-owned or government sources, not unverified aggregators.
2. Re-check records on a scheduled basis and remove or flag sources that change eligibility, capacity, hours, or free-access status.
3. Track actual user success paths—search terms, completed calls and directions—not just page views, while respecting privacy.
4. Add more true local direct-service records in regions where the catalog currently relies on a national locator or network marker.
5. Periodically re-run the build, 153-test suite, 19-check directory probe, 15-check globe probe, and browser crash suite before release.

The design is now a credible, fast, human service-finder interface rather than a decorative directory. The integrity of the organization behind it will depend on maintaining the same evidence standard used in this expansion.
