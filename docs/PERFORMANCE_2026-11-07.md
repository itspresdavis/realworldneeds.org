# November 7 performance evidence and budget decision

This package preserves the full catalog, detailed globe, deep zoom and text path.
Measurements below are lab evidence, not field p75 LCP/INP/CLS. Field traffic and
physical-device evidence are insufficient; those targets remain **not measured**.
No overall speedup is established by the intermediate measurements.

## Comparable measurements

The baseline is `bfd53f5e` (1,992 records). Intermediate integration build
`21b33332a4cf` contains 1,997 records. The local comparison uses the same gzip level
9 server, Chromium, 390×844 viewport, fourfold CPU slowdown, 150 ms latency and
200 KB/s throughput. WebGL is deliberately unavailable in **both** text-path
samples. Three cold/warm pairs per source alternate source order; warm navigation
starts from `about:blank`, preserving the browser cache but avoiding an already
restored query. All 12 navigations complete the same real shelter search without
page errors, pending requests or overflow. This is separate from hosted CDN and
full-globe measurements.

| Homepage text-path measure | Baseline | Intermediate build |
| --- | ---: | ---: |
| Cold navigation to painted search, median (range) | 5,128 ms (4,337–5,275) | 5,189 ms (4,534–5,579) |
| Warm navigation to painted search, median (range) | 2,359 ms (1,821–2,700) | 2,115 ms (2,044–2,242) |
| Cold input to painted search, median | 1,306 ms | 1,161 ms |
| Warm input to painted search, median | 1,378 ms | 1,086 ms |
| Cold encoded page/resource bodies | 333,277 B | 367,612 B |
| Cold wire bytes | 342,623 B | 379,500 B |

Ranges overlap. The **10.3% increase in encoded text-path payload** is real;
language support, intent controls, service schedules and reviewed facts have a
transfer cost. Do not claim the smaller raw search index offsets it: baseline
index gzip is 209,180 B and the intermediate index is 211,791 B, although raw
index bytes decrease from 1,499,450 to 1,479,777. The existing 1.5 MB raw index
budget is unchanged.

Actual directory measurements identified a separate regression: page-load-first
cold navigation-to-search increased from 3,248 to 4,651 ms. The enhanced module
graph had four sequential discovery waves: entry 231–724 ms, controls 883–1,046,
intent 1,222–1,383, then scope/search 1,391–1,586. The core entry finished at
581 ms. This evidence supports preloading the exact static child URLs on pages
that execute the enhanced entry. Postal JSON and dynamic imports remain demand
loaded, and tests forbid preloading them or adding requests on unrelated pages.

A filtering pass also reparsed identical intent 1,997 times. Reusing the plan
already computed for the pass preserves every matching decision. In the bounded
diagnostic, repeated shelter-query work measured approximately 24–27 ms versus
1–2 ms; warm manual-place work approximately 85–93 versus 25 ms. These are isolated
CPU diagnostics, not end-to-end latency claims. Repeat the actual directory
comparison on the integrated artifact after these fixes.

The subsequent immutable build `56dfbb9cb85d` implements both changes. A network
trace found all five module URLs requested exactly once, with descendants
starting at 211–214 ms and no postal request. A paired 24-navigation comparison
against build `21b33332a4cf` produced useful results with zero page errors, pending
requests or overflow, but **mixed timing**:

| Directory protocol | Before | After preload/plan reuse |
| --- | ---: | ---: |
| Load-first cold navigation → results median (range) | 4,163 ms (3,840–4,994) | 3,239 ms (3,171–3,839) |
| Load-first warm median (range) | 1,062 ms (1,033–1,267) | 1,704 ms (1,453–1,947) |
| Early-entry-ready cold median | 3,533 ms | 4,056 ms |
| Early-entry-ready warm median | 1,524 ms | 1,442 ms |

The early-entry-ready cold ranges overlap broadly. Encoded page/resource bodies
change from 301,036 to 301,320 B. Parallel discovery is demonstrated; a general
speedup or resolution of every warm-path bottleneck is not. Preserve both
protocols and their distributions rather than selecting only the favorable run.

Offscreen globe work is deferred until visible or deliberately explored. In an
isolated identical-profile comparison, early heavy-map requests fell from two to
zero, while combined finder-ready plus first-search timing did not establish an
overall improvement. Native and three-engine journeys retain rendered globe
quality, zoom, no-WebGL and lost-context behavior. Capability skips are recorded
separately; they are not physical-device evidence.

## Necessary directory-core budget change

The historical core is 15,967 raw bytes, 15,980 with its hashed lazy-import URL,
and 7,109 gzip bytes. Its 16,000-byte ceiling left only 20 served bytes. New
urgent/food-benefit/pantry matching alone adds 548 minified raw bytes. Validated
non-phone contact actions and independent manual-place controls are additional
required behavior. Before reductions, the integrated core is 16,990 raw bytes
and 7,477 gzip: **368 additional compressed bytes**.

Splitting this core into another mandatory runtime request would break the
established self-contained fallback for older documents/workers. Moving startup
or worker registration out of it likewise needs legacy fallbacks, erasing most
savings. Those compatibility and safety guards remain. Readable listener/state
deduplication saves 129 raw bytes; a safe lexical wrapper lets Terser shorten
stable browser-object references without capturing mutable fetch/timer functions.
No unsafe compiler transforms, matcher exclusions or relaxed URL assertions are
used.

The reviewed limit is therefore **17,000 raw bytes on the actually served core**,
with an additional **7,750-byte gzip ceiling**. This is a bounded cost for required
behavior and legacy compatibility, not a claim that the entire directory has no
performance regression. To prevent hiding growth in helper files, the complete
required offline runtime graph—including language, search helpers, Saved and
styles—also has **200,000 raw / 64,000 gzip byte ceilings**. Its intermediate
measurement is 194,958 raw / 61,038 gzip, versus the prior 128,105 / 37,613. Optional
postal data is explicitly separate and must never be eagerly cached or preloaded.

Measured build `56dfbb9cb85d` serves a 16,698 B / 7,474 B gzip core; its complete
required graph is 195,105 B / 61,236 B gzip across 19 assets. Later correctness/CSS
changes require the same final-candidate assertions and their own identity.

The served-file and aggregate checks run in `tests/offline-assets-build.test.js`;
all prior legacy-worker, malformed-action, phone and matcher checks remain.
Broader path timing must be reported alongside these budgets. Neither passing a
size assertion nor this small core exception certifies a field metric or accepts
an unexplained helper waterfall.

## Early-edit restoration safety budget

At source `33d49153`, a trusted edit during a stale-history reload could leave
its focused query above the sticky header. A paired native Chromium
157.0.8103.38 run at 4× CPU slowdown reproduced the input at −26.375px while
its query, caret and result remained correct. The unchanged startup assertions
caught the problem; neither extra waiting nor a weaker visibility oracle was
introduced.

Two browser operations need separate handling. Instant cancellation at the
visitor's current coordinates stops motion already pending when a fully visible
input is edited. Temporarily owning `history.scrollRestoration` stops subsequent
native restoration from applying an obsolete entry while the new query loads.
The original full-box and hit-test guards remain, so an offscreen input still
receives normal native focus reveal. Ordinary smooth scrolling remains enabled.
The prior restoration mode is preserved through delayed content and restored
before an uncancelled primary same-window link's default navigation or on each
page departure. Cancelled, modified, download and new-context links keep the
current edit's ownership. Runtime handoff removes the capture listeners; it is
not assumed to be the end of browser restoration. A same-document history entry
can retain manual mode; actual Saved → Browse → edit → Back/Forward journeys
verify the directory's explicit state restoration and useful focused result.

The original served script was **999 raw / 632 gzip bytes**, SHA-256
`a72839bacb5c824c307ab2f17c62de418d7f0f04b3149562efca1ff4eeb0023d`.
The combined fix is **1,366 raw / 803 gzip bytes**, SHA-256
`9d96bcf8843382884e8d9a88402b693f8b70ca0fc3f184457be517cd33b2d9bd`:
**367 additional raw / 171 compressed bytes**, with no additional request or
dependency. Its served limits are **1,375 raw / 810 gzip bytes**. The required
19-asset graph measures 195,981 raw / 61,667 gzip bytes in this isolated
`33d49153` plus startup component build, before later integration changes;
its existing 200,000 / 64,000 limits remain unchanged. These hashes identify
bytes, not signed attestations, and these sizes are not a loading-speed claim.

Smaller alternatives were rejected using behavior evidence. An early 999-byte
manual-mode prototype released ownership on Ctrl-click and CSV download even
though the visitor stayed on the directory: all four Chromium/Firefox checks
failed. A guarded 1,090-byte candidate fixed those nondeparture cases but removed
instant cancellation; the unchanged full native helper then caught an already
pending smooth scroll moving from 0 through 1,136px before clamping to 597px,
again obscuring the input. Explicit coordinates alone passed one diagnostic but
did not establish protection against later restoration. A separate viewport
correction prototype cost 1,237 raw bytes before necessary blur/caret cleanup
and introduced more event ownership; it was not shipped. The combined fix keeps
the independently necessary mechanisms and strict behavior assertions.

Focused unit tests cover prior auto/manual modes, delayed restoration, repeat
departure cleanup, cancelled/modified/download links, visible cancellation and
offscreen negatives. Full native startup journeys retain stale reload, caret,
IME-event simulation, delayed source settlement, Saved/Browse and privacy checks
at 1440 and 390px. The separate five-scenario review passes in Chromium, Firefox
and WebKit (15/15); it is not physical-device, real-IME or actual-BFCache proof.
The retained native traces, failed alternatives, screenshots and receipt are in
`access-quality-20261107/STARTUP_SCROLL_HANDOFF.md` beneath the external evidence
root. Final integration still requires its own full checks and source identity.

## Evidence and follow-up

The later mobile layout correction was measured with real Chromium 156 layout
and visible scrollbars at a 320×844 viewport (305px client width). English search
and primary-action bottoms moved from 412.95/690.48px to 290.36/450.02px. Spanish
measured 376.53/536.19px with the complete language-scope notice visible. Both meet
the unchanged 380/560px native first-screen limits. All eight English/Spanish
samples at 320/390/768/1440 retained 44px targets and page bounds. This measures
layout, not loading speed or field performance; the original 38 KB CSS limit
also remains unchanged. Evidence: `ux-locale/first-screen/EVIDENCE.md` beneath
the external evidence directory below.

Raw runs, browser/profile details, screenshots and machine-readable summaries
are outside tracked source in
`/workspace/rwn-release-evidence/access-quality-20261107/`:
`TEXT_PERFORMANCE_BUILD3.md`, `DIRECTORY_BUDGET_ASSESSMENT.md`,
`text-finder-gzip-build3-summary.json`, `directory-waterfall-build3.json`, and
`directory-plan-cost-build3.json`. Exact-candidate local and hosted receipts must
identify their own source/build; an intermediate result never certifies a later
change. Hosted cold/warm comparisons use the same original baseline profiles.

The source-health report is separately gated in `CATALOG_OPERATIONS.md`. No alert
owner/destination, delivered alert or sustained load capacity is claimed. No raw
queries, precise user coordinates or Saved lists enter performance diagnostics.
