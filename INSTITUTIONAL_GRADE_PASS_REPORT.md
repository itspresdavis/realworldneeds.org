# Institutional-Grade Deep Pass Report

## Executive summary

This pass treated Real World Needs as public-service infrastructure rather than a visual redesign exercise. The established RWN logo, green-and-ink palette, typography, detailed Three.js globe, deep zoom, marker system, and page-scroll ownership were explicitly retained as product baselines. The completed work focused on helping people reach text services sooner, making location behavior more privacy-aligned and recoverable, and ensuring the flagship globe fails safely instead of becoming a single point of failure. The release also improves printable fallback discovery and gives maintainers a standard test command. [1] [2]

## Baseline and discovery

The inherited production site already had substantial foundations: a source-backed catalog, static service pages, a text directory, privacy-conscious URL handling, a detailed globe, service-worker support, security headers, and broad automated testing. The deep audit found no reproduced P0 release blocker. It did find several weaknesses that were not merely aesthetic: the results shortcut depended on a dynamic quick-needs class, geolocation asked for high accuracy while the surrounding experience emphasized approximate-area use, runtime WebGL context loss had no recovery path, printed service pages hid related fallbacks, and `npm test` was not available despite an established Node test suite. [2]

| Priority | Discovery | Outcome in this release |
| --- | --- | --- |
| P1 | Text results could sit behind the interactive globe in keyboard and mobile flow. | Added a permanent **See matching services** route with a live match count before the globe. |
| P1 | WebGL loss after initial load could leave the map unavailable without a recovery control. | Added context-loss fallback, a retry control, automatic restoration handling, and browser verification. |
| P2 | Location requested high accuracy and error guidance was transient. | Switched to a coarse location request and added persistent denial/unavailable guidance with manual-search recovery. |
| P2 | Printed service pages hid related fallback services and appended raw external URLs. | Retained related fallback resources in print and removed blanket raw-URL expansion. |
| P2 | Maintainers had no standard `npm test` entry point. | Added `npm test` as an explicit alias for the established Node regression suite. |

## Architecture and engineering changes

The pass avoided risky build-pipeline refactoring because the present build is a mature, order-dependent static-generation chain. Instead, it added narrowly scoped application state for location recovery and globe context loss, preserving existing rendering, source, and data behavior. A new correction-channel handoff documents the data-minimizing payload and operational controls necessary before publishing a correction form. It does not invent a mailbox, service-provider portal, or unmonitored public workflow. [3]

## UX, mobile, and accessibility changes

The mobile and desktop finder now present the primary human task in a clear order: search, select a core need, open matching services, optionally use location, then explore the globe. The globe remains visually central but is no longer a gate to listings. The jump action is keyboard accessible, targets the results landmark, and carries the current number of matches. Fresh 1440 px and 390 px browser captures confirmed the original RWN brand, globe composition, core-need grid, and compact mobile header remained intact without horizontal overflow. [2]

Location failure now has durable, readable recovery text instead of relying only on transient notification copy. A person who denies, lacks, or cannot retrieve location is directed to city, ZIP, postcode, and service search. Location is requested with `enableHighAccuracy: false`, a ten-second timeout, and a five-minute cache age; existing manual-search behavior remains available. This is an implementation alignment improvement, not a legal certification of the surrounding privacy notice. [4]

## Globe and resilience changes

The deep globe’s existing pointer-anchored zoom, HD terrain/boundaries, marker density behavior, keyboard controls, mobile gestures, and scroll separation were retained. The canvas now listens for `webglcontextlost` and `webglcontextrestored`. On loss, it prevents the default event, pauses map use, shows the existing branded text-directory fallback, and exposes a retry action. On restoration or retry, it rebuilds the renderer-scene resources, retained imagery/boundaries, and GPU point layer before returning to the standard live readout. Browser simulation confirmed the fallback appeared with retry and the retry restored `World view · 2019 visible · 1.0× · standard boundaries`. [5]

## Trust, print, and legal-content boundaries

The release makes printed service output more useful by retaining related resources as compact fallback options and suppressing blanket raw external URL appendices. It does not claim that RWN has a monitored correction, privacy, accessibility, or security channel because the audit confirmed no verified public route is currently published. The repository instead contains an implementation handoff that specifies the minimum operational decisions, anti-abuse controls, and privacy boundaries required before adding such a form. [3]

> **Legal boundary.** This report is an engineering and public-content review, not legal advice or a compliance certification. A qualified attorney and authorized RWN owner must approve the legal entity/controller, monitored contact channels, telemetry legal basis and any consent or opt-out treatment, data-processing/retention statements, and jurisdiction-specific notices before those items are represented as complete.

## Privacy, security, SEO, and data integrity

The live deployment already returned HTTP 200 with HSTS, a CSP, `nosniff`, frame restrictions, a same-origin policy set, and `Referrer-Policy: no-referrer`. The live sitemap exposed 2,683 URLs, confirming the existing build expands the source seed sitemap. A runtime dependency audit reported zero known vulnerabilities at the checked high-severity threshold. No header policy was weakened in this pass. [2]

During final custom-domain validation, the audit found a release-integrity defect: mutable `/src` CSS and JavaScript used long-lived immutable cache headers while the document referenced unversioned URLs. That combination can mix a fresh HTML document with a stale module or stylesheet graph. The build now creates a deterministic runtime-asset release hash, appends it to the entry CSS/app/bootstrap paths, propagates it through relative module imports, and records it in release metadata. This preserves strong immutable caching while ensuring each fresh HTML release requests a matching asset graph. [2] [5]

The audit also identified durable follow-up work: unify finder and directory search normalization, make search/filter state shareable without exposing sensitive location, add progressive disclosure beyond the directory’s 60-result cap, introduce listing-level review/freshness fields, add deterministic rendered source-link auditing, and formalize a staged build/artifact-manifest policy. These are documented rather than rushed because they affect data trust, generated content, or production delivery across thousands of artifacts. [2]

## Testing and QA evidence

| Check | Evidence |
| --- | --- |
| Build, data, source, static, and unit gate | `npm run check` passed **160/160** tests, up from 155 before this pass. |
| New safeguard coverage | Five targeted tests cover durable results routing, coarse location/recovery, context-loss recovery, print fallback retention, and the standard test entry point. [5] |
| Globe interaction | `npm run qa:globe-scroll` passed **15/15** checks, including deep zoom to 11.52×, no horizontal overflow, persistent markers, and no console errors. |
| Browser resilience | `npm run test:browser:qa` passed desktop/mobile chaos, institutional, deep-globe, service, directory, offline, and action flows. |
| Dependency posture | `npm audit --omit=dev --audit-level=high` reported zero known runtime vulnerabilities. |
| Visual review | Fresh desktop and 390 px mobile captures confirmed preserved identity and no new overflow. [2] |

## Before/after evidence

| Measure | Before | After |
| --- | --- | --- |
| Automatic route from finder to text results | Conditional dynamic injection | Permanent finder action with live match count |
| Location request | `enableHighAccuracy: true`, 12-second timeout, 60-second cache | `enableHighAccuracy: false`, 10-second timeout, 5-minute cache |
| Location-denial recovery | Toast-only guidance | Persistent, accessible manual-search and browser-settings guidance |
| Runtime WebGL loss | No context-loss/restore lifecycle | Branded fallback, retry action, and restoration path |
| Service print fallback | Related services hidden; raw external URLs appended | Related fallbacks retained; raw URL clutter removed |
| Regression checks | 155 passing tests; no `npm test` alias | 160 passing tests; `npm test` available |

No initial-transfer or Core Web Vital comparison is claimed because this pass intentionally avoided making artificial or unmeasured metric claims. The changes were small, task-path, resilience, and verification improvements rather than a bundle-reduction project.

## Known limitations and deferred work

The current directory still has uneven global category coverage, source-level rather than record-level freshness for many records, separate finder/directory search normalizers, in-memory filter/history state, and a 60-result directory cap. Offline support intentionally prioritizes text-directory availability; the full globe and service-detail experience still needs network access. The future correction workflow remains deferred until an owner, monitored endpoint, retention policy, and abuse process exist.

## Recommended next pass

The next safe pass should focus on one high-leverage infrastructure stream at a time: first shareable non-sensitive search/filter state plus a shared search normalizer; second data lifecycle fields and deterministic source-health/duplicate reporting; third a controlled correction channel after organizational and legal decisions are supplied. Each stream should retain the current identity and globe, include before/after evidence, and avoid claims of universal coverage or formal compliance without verified support.

## References

[1]: [Protected baselines and audit matrix](./INSTITUTIONAL_GRADE_AUDIT_MATRIX.md)

[2]: [Evidence-backed institutional audit findings](./INSTITUTIONAL_AUDIT_FINDINGS.md)

[3]: [Safe future correction-channel handoff](./docs/CORRECTION_CHANNEL_HANDOFF.md)

[4]: [Location and finder implementation](./src/app.js)

[5]: [Institutional safeguard regression tests](./tests/institutional-safeguards.test.js)
