# Deep RWN-WEB Readiness Findings

## Protected baselines

The RWN logo, green-and-ink color system, public-service tone, core finder model, verified directory, and detailed Three.js globe were preserved. The audit rejected generic redesign, decorative animation, fabricated support features, and changes that would weaken the existing globe interaction contract.

## Findings and resolution

| Finding | Resolution | Evidence |
| --- | --- | --- |
| Keyboard focus treatment was inconsistent on mixed/dark surfaces because component rules suppressed outlines. | Added one high-contrast navy-and-green focus treatment with an explicit outline and halo across links, buttons, inputs, summaries, and tabindex targets. | Source and browser interaction checks passed. |
| Finder history replaced every meaningful change, weakening normal back/forward mental models. | Meaningful search, filter, saved-mode, selection, and reset changes now make deduplicated history commits; typing is grouped with a 640 ms quiet window and committed on Enter/blur. | Interaction QA passed history restoration and no sensitive coordinates enter history state. |
| The globe loop continued scheduling frames while hidden or outside the generous pre-entry observation margin. | Added a single frame handle and explicit pause/wake lifecycle for hidden/off-screen conditions, including selected-map wakeup and context recovery. | Deep-globe, interaction, and scroll suites passed. |
| The directory’s page-level browse links could delay the visual route to the first listing. | Added a compact, brand-consistent **View listings** shortcut with current-page count and an accessible listings anchor; retained browse, pagination, search, and all crawlable links. | Generated indexability and directory browser tests passed. |
| The 1.34 MB search index was a mandatory first offline installation asset. | Moved it to lazy directory caching; basic offline directory navigation installs more reliably and the search index caches when a visitor actually reaches the directory. | Offline installation tests now assert nine required assets and lazy index behavior. |
| Static page growth had no explicit release guardrail. | Added file-count, HTML-route-count, largest-static-file, resource-corpus, and search-index budgets to the release gate. | Current build: 2,852 files, 2,684 HTML pages, largest file 5,425,837 bytes. |

## Deep verification

The final release gate passed **175/175** tests. Browser checks passed in two controlled batches after releasing stale headless-browser memory: chaos/churn and interaction checks, then dedicated globe, service/directory mobile, offline, and service-action checks. The globe interaction suite passed all 15 checks at 11.75× zoom. A bounded local static smoke test made 160 concurrent requests across the homepage, directory, service page, and search index with zero non-200 responses; local average response times ranged from 0.0011s to 0.0122s.

## Limitations

The smoke test validates static delivery behavior in the local sandbox; it is not a substitute for a multi-region CDN load test. RWN’s static site has no public write path, database, or request-time data fetch required for core use, which materially reduces per-visitor origin load. Actual millions-of-daily-user capacity remains dependent on Vercel edge capacity, DNS, CDN cache behavior, third-party source availability, synthetic monitoring, and production traffic telemetry.
