# Product-Brief Audit Findings

## Initial rendered homepage review — 2026-08-15

### What already works

The first screen has a clear, literal heading, a visible search field, common-need shortcuts, a location action, a plain emergency disclaimer, and a restrained visual system. The desktop globe is technically impressive and feels more like an exploration tool than decorative stock imagery. On mobile, the hero copy is not oversized and the search field remains high in the viewport.

### Friction and product-priority risks

| Journey | Observed evidence | Product implication |
| --- | --- | --- |
| Urgent desktop arrival | The globe occupies roughly two thirds of the first viewport. `View results` is a small text link below the need chips, while search/location are visible but no single high-emphasis action explains the next step. | Discovery is present, but visual gravity still favours geographic spectacle over **clarity → discovery → action**. |
| Urgent mobile arrival | The need-chip row is horizontally clipped; the `Water` chip is only partially visible and there is no obvious fade or continuation affordance. The globe begins immediately after collapsed filters, still consuming early vertical attention. | A one-handed user may miss needs or not understand the category row is horizontally scrollable. The globe can appear before a clear results/action transition. |
| Trust language | The opening copy does name provider details, original source, and review date; emergency wording is appropriately restrained. | Strong foundation. Further work should make the action/result path and the meaning of free/eligibility status just as explicit as provenance. |
| Visual consistency | Header, finder controls, cards and globe use a calm restrained palette and controlled radii. | Preserve this. Do not apply a generic makeover or decorative gradients. |

### Direction for next implementation pass

1. Make the urgent help route unmistakable on both desktop and mobile without hiding the globe or discarding search/location.
2. Improve common-need chip overflow and the transition from selecting a need to seeing matching services.
3. Treat the globe as an optional discovery surface after the immediate help workflow—not the primary visual answer to a stressed person.
4. Test search synonyms, typo handling, no-results recovery, service-detail clarity, location denial, and offline transitions before changing visual styling.

## Search-discovery audit — measured against product-brief queries

The directory search is fast and local, and its existing aliases correctly bridge several everyday terms (`clothes` → clothing; `shower` → hygiene; `doctor` → health). However, it is currently a strict token-intersection matcher with no typo recovery, place aliases, category-first ranking, or ambiguity handling.

| Query | Current result | Finding |
| --- | --- | --- |
| `food near me` | 1,862 results | Works, but ordering is lexical/name-weighted and does not favor direct sites or a user's region absent explicit location. |
| `shelter` | 155 results | Works, though locator and direct-site ranking are mixed. |
| `water` | 32 results; top results include food-bank names containing “Water” | High-risk relevance defect: category intent is not ranked ahead of incidental name matches. |
| `clothes` / `shower` / `doctor` | 36 / 49 / 545 results | Existing aliases work. |
| `diapers` | 1 result | Record discovery works but no category alias exists; broader related resources should be suggested. |
| `wifi` | **0 results** | Essential utility synonym is absent despite a validated LinkNYC record. |
| `charging` | 2 results | Works incidentally but has no recovery or utility grouping. |
| `Boston food` | 20 results | Works but ranks UK Boston and US Boston in one unsignposted result set. |
| `NYC shelter` | **0 results** | Common city alias missing; this is a serious failure for a stressed user. |
| `shleter`, `foood` | **0 results** | No typo recovery. |
| `public toilet`, `period products` | 1 / 2 results | Exact matching works; no broader related-category recovery. |

### Priority implementation conclusion

The next pass should improve **query understanding and recovery before adding visual decoration**. At minimum: normalize common city aliases (`NYC`, `NY`), map utility and essential-need synonyms (`wifi`, internet, charging, diaper/diapers, toilets), give category-intent matches a strong score advantage over incidental token matches, add bounded typo correction for one-token queries, and produce an actionable no-results/recovery state rather than a dead end.

## Mobile directory and service-detail review

| Surface | What works | Remaining friction worth addressing |
| --- | --- | --- |
| Directory | Clear literal title, named source/review promise, a visible search field, no visual clutter, and clean compact browser controls. | Need chips are again horizontally clipped without an evident continuation affordance. `Download directory data`, browse taxonomy, and pagination appear above the first service result on a 390×844 screen, delaying a help seeker’s path to actual listings. |
| Service detail | The first screen provides service type, summary, location, free status, review date, and a high-emphasis Call action. Source verification is explicit and the hierarchy is calm. | Five stacked action cards (Call, Apple Maps, Google Maps, Official source, Interactive map) consume most of the first screen. For a stressed mobile user, one adaptive `Directions` action would be clearer than two platform-specific alternatives, while map exploration could be secondary. The page should also make eligibility/caveat status visible before or alongside the action group when known. |

The service page is already credible and well above a generic directory standard. Changes should be surgical: preserve source/review clarity and avoid adding dashboard-like complexity.

### Post-change mobile observation

The common needs are now fully visible and tappable in a calm three-column grid, eliminating the clipped horizontal row. The intended `See matching services` shortcut exists in the initialized DOM, but the CDP screenshot utility continued to show a stale finder order without it. Before release, the browser QA will explicitly assert both DOM presence and on-screen order to guard against an asset-cache or load-order discrepancy.

## Implemented product-brief improvements

The post-change mobile homepage now presents the full core-need set without horizontal clipping, a visible **See matching services** action before location, disclosures and globe exploration, and preserves a single scroll context. Browser QA verifies seven need buttons, 40px+ targets, no overflow, the full-width results action, and its position before location controls.

The service-detail page now provides one clear direction action rather than making a stressed user choose between two near-identical mapping cards. Its action order is **Call → Directions → Official source → Interactive map**. The first screen still exposes type, summary, location, free status and review date before action, and the dedicated desktop/mobile service QA confirms the source link, private RWN-map handoff, target sizing, no overflow, and the single-direction contract.
