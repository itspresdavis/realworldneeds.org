# RWN-WEB Audit Notes (working file)

## Baseline (before changes)

- Build passes: `npm run build`; 142 unit tests pass.
- Homepage first load: **3.45 MB across 31 requests**, FCP ~820 ms local, DOMContentLoaded 757 ms.
- Largest first-load payloads (all eagerly imported by `src/app.js` via `src/data/resources.js`):
  - `src/data/generated/new-york-wic.js` — 607 KB
  - `data/countries.geojson` — 554 KB
  - `src/data/generated/trussell-foodbanks.js` — 487 KB
  - `vendor/three.core.min.js` — 386 KB + `vendor/three.module.js` — 366 KB (**both** loaded; module re-exports core)
  - `media/earth-blue-marble.jpg` — 361 KB
  - `src/data/generated/massachusetts-wic.js` — 215 KB
  - `src/app.js` — 124 KB, `src/styles.css` — 91 KB, `src/clarity.css` — 28 KB
- 1,984 catalog records are parsed on the critical path just to render 8 result rows.
- `rwn-mark.svg` requested twice.

## CRITICAL ARCHITECTURE FINDING

The **shipped** globe is not the source globe. `scripts/globe-production.mjs` + `scripts/globe-touch-production.mjs` apply **47 brittle string replacements to `dist/src/app.js` after the build**, changing zoom ranges, sphere tessellation, camera FOV curve, wheel behavior, pointer arbitration, DPR caps and even copy. Any edit to `src/app.js` that touches one of those exact strings breaks the build with `expected one X match, found 0`.

Consequences:
- The source you read (`src/app.js`) behaves differently from production (dev server serves `dist`, so `npm run dev` only reflects post-transform behavior).
- Tests assert on transformed `dist` output (e.g. `globe-interaction-v4.test.js` greps `dist/src/app.js` for `window.innerWidth <= 600 ? 8.0 : 12.0`), so they lock in the patch pipeline rather than the real source.
- Maintenance is effectively impossible: a source refactor requires editing three files in lockstep.

**Fix: fold every transform into the source, delete the two patch scripts, and rewrite the affected tests to assert behavior in `src/`.**

## P1 — Globe

1. **Zoom/detail mismatch.** Source caps zoom at 2.55/3.05, production at 8/12. Source has no `globeViewProfile`; production adds a progressive FOV curve. Same for point-pick thresholds and drag-intent classification (`classifyGlobeDragIntent` exists only in `src/utils/gesture.js` but is only *imported* by the patched dist file).
2. **Wheel behavior.** Source hijacks page scroll unconditionally (`event.preventDefault()` on every wheel over the canvas). Production requires Ctrl/Cmd. So the glitch the user reports is real in source, and in production the globe cannot be zoomed by scroll at all — with no visible affordance explaining Ctrl/Cmd, and no trackpad-friendly path. Needs a designed solution: wheel zoom only after the user opts in (click/focus on the globe) or with modifier, plus a visible hint, and never blocking page scroll.
3. `renderPins()` returns early while `is-globe-moving`, so HTML pin labels vanish during any motion and pop back — visible flicker on every drag/zoom.
4. Frame-rate is throttled during page scroll via `globePageScrollUntil` (52 ms gate) — a band-aid for scroll jank instead of decoupling globe rendering from scroll.
5. Animation loop schedules `requestAnimationFrame` forever even when the stage is offscreen or the tab is hidden.
6. `state.rotationLat` clamped to ±58° — polar regions unreachable.
7. Country highlight/borders dispose+rebuild `LineSegments` geometry on every selection — GC churn during interaction.
8. Dead weight: a complete 2D-canvas globe fallback (`drawGlobe`, `drawLand`, `drawConnections`, `drawSolarShading`, `drawMapLabels`, ~420 lines) ships to every visitor inside the 124 KB `app.js` even though WebGL init failure is rare and the text directory is the real fallback.
9. `createGlobeTexture()` rasterizes up to 8192×4096 on the main thread → multi-hundred-ms long task and GPU stall exactly when the user zooms in.
10. HD surface texture is **5.4 MB** (`earth-blue-marble-detail.jpg`) — far too large; should be tiled or heavily recompressed.

## P2 — Directory

1. `/directory` ships **158 KB HTML with 80 full records expanded** per page (25 pages). Every record renders a heading, quick actions, description, aid list, definition list, caution note and 5 links → extremely long page (41,154 px tall) and heavy DOM.
2. Client search (`public/directory.js`) lazily fetches a **1.29 MB** `search-index.json`.
3. Search results replace the page records but there is no result count feedback, no sort, no location filter, no keyboard result navigation.
4. Records are visually flat/repetitive: no cards, no scannable hierarchy, weak use of whitespace, duplicated links (record has both quick-actions and lower link row pointing to the same targets).
5. Pagination is a single "Next" link; no page numbers, no jump.

## P3 — Site-wide

1. Hero h1 in built page differs from `app.js` source ("Find essential services near you." vs "Find free help near you.") — clarity.css/professional.js rewrite text at runtime, meaning three layers fight over copy. Runtime DOM rewriting after paint = layout shift.
2. Five separate stylesheets on the homepage (`styles.css`, `clarity.css`, `navigation-actions.css`, plus injected `<style>` from `globe-points.js`), with `!important` overrides — brittle cascade.
3. `src/refinement.js`, `src/professional.js`, `src/accessibility.js`, `src/result-actions.js` all mutate DOM after `app.js` renders: extra work, visible reflow, and copy drift.
4. Footer "Map & imagery" nav has `target="_blank"` links; the rest of the site avoids it.
5. Result list on desktop uses a table-like grid with a hidden head row; the rows currently look unbalanced (tiny type, wide empty columns).

## Verified live behavior (production build, headless Chromium 1440×900)

| Action over the globe | Observed | Verdict |
| --- | --- | --- |
| Plain wheel down ×5 | page scrolled 0 → 600 px, zoom stayed 1.0× | page scroll works, but the globe is inert |
| Ctrl + wheel up ×6 | zoom 1.0× → 2.49×, **page also scrolled 600 → 480 px** | zoom works, page still moved during the gesture → this is the "glitch" |
| Visible hint text | "Drag to rotate · Pinch or use + / − to zoom" | never mentions Ctrl/Cmd; the discoverable path is only the +/− buttons |
| Screen-reader help | mentions Ctrl/Cmd | copy inconsistent between the two surfaces |

Root causes for the ctrl-wheel page movement: the handler is attached to `#globeCanvas` only, so wheel events over the stage chrome/pin layer bubble to the document unhandled; and Chromium sends the first ctrl-wheel of a gesture before the listener claims it. Fix by attaching a single `wheel` listener on `.globe-stage` with `{ passive: false }`, claiming the gesture for a short window once zoom intent is detected, and never calling `preventDefault()` for non-zoom intent.

## P4 — Build pipeline

1. `npm run build` runs 11 sequential node scripts, two of which are 47 string patches over `dist/src/app.js`.
2. `vendor/three.module.js` (366 KB) + `vendor/three.core.min.js` (386 KB) are **both** downloaded: 752 KB of Three.js for a globe that uses spheres, lines, points and one shader. A hand-rolled subset or `three` tree-shaken bundle would be a fraction.
3. `npm run check` requires Node 24 (`engines`), sandbox/CI mismatch risk; local Node 22 works but `npm ci` warns EBADENGINE.
