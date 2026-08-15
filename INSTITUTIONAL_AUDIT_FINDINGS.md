# Institutional-Grade Audit Findings

## Baseline evidence

The deployed homepage returned HTTP 200 with HSTS, a restrictive frame policy, `nosniff`, a same-origin CSP, a Permissions Policy, and `Referrer-Policy: no-referrer`. The live sitemap exposes 2,683 URLs rather than the seven URLs in the source seed file, confirming the build pipeline expands it before deployment. The production dependency audit reported no known runtime vulnerabilities at the checked high-severity threshold. Existing release checks had already passed 155 unit/data checks, 15 globe interaction checks, 23 directory checks, and the full browser resilience suite before this deeper pass began.

## Priority matrix

| Priority | Finding | Evidence | Safe decision for this pass |
| --- | --- | --- |
| P0 | No confirmed release-blocking defect reproduced in the current tested flows. | Existing unit, globe, directory, offline, and browser suites passed. | Preserve working behavior; do not churn the globe or established brand. |
| P1 | The homepage needs an always-present keyboard and mobile route to text results before the globe. | The globe precedes results in the DOM; the conditional result-jump depends on a dynamic shortcut class. | Add a durable, visible result summary and `#results` jump route that retains the current finder and globe composition. |
| P1 | Runtime WebGL context loss has no recovery lifecycle. | Renderer construction is caught, but no `webglcontextlost`/`webglcontextrestored` listener exists. | Add branded loss/retry behavior and a safe restoration attempt; retain the current deep globe, input model, and fallback directory route. |
| P1 | People cannot report incorrect listing information because no verified public reporting channel exists. | Policy pages explicitly state that no monitored contact is published. | Do not invent an inbox or form endpoint. Add an operationally explicit deferred item and prepare service-page hook only after the owner provides a monitored route. |
| P2 | Location uses `enableHighAccuracy: true` despite copy that emphasizes approximate-area handling. | The browser request uses high accuracy; privacy copy promises local exact-location handling and approximate USDA area. | Prefer a coarse location request, preserve manual search, and make denial/retry guidance persistent. Counsel/owner must approve public privacy wording. |
| P2 | Search behavior diverges between the finder and static directory; directory search hard-caps results at 60. | Separate normalization/scoring logic exists in `src/utils/geo.js` and `public/directory.js`. | Preserve current successful search corpus now; create a shared-normalizer and progressive-result plan rather than rush a brittle rewrite. |
| P2 | Service-detail print and provenance labels can be clearer. | Print hides related fallbacks and prints raw external URLs; provider/source meaning is coupled to CTA DOM ordering. | Retain core service details in print and separate provider vs. official-source labels with targeted regression tests. |
| P2 | Accessibility needs a browser-level reflow/text-spacing and reduced-motion proof, not only CSS assertions. | Existing tests cover focus/reduced motion rules but do not prove 200–400% reflow or JS globe motion. | Add focused browser tests and one resilient global focus convention without changing the current visual system. |
| P2 | Public privacy/legal text must match operations, especially telemetry, contacts, entity, retention, and correction channels. | Public pages disclose no verified contact and telemetry without in-product choice; security headers are otherwise substantial. | Keep disclosures factual, do not add unverified claims, and list counsel/owner verification as a release dependency rather than claiming legal certification. |
| P3 | Build/check orchestration mutates `dist` and produces broad artifact churn. | `check` builds and scripted transforms rewrite thousands of committed generated files. | Document a staged-build/refactor path; avoid risky pipeline surgery during product-safety work. |

## Implementation scope selected

This pass will implement the high-confidence, user-facing safeguards that do not depend on inventing organization facts: a durable results jump, privacy-aligned coarse location behavior with persistent recovery guidance, WebGL context-loss recovery, better print/provenance handling, and regression coverage for those behaviors. It will also add a concise operational template for a future correction channel without publishing an unmonitored contact address.

## Counsel- and owner-dependent items

An authorized organizational owner and qualified counsel must confirm the legal entity/controller, monitored privacy/accessibility/security/correction contact routes, telemetry legal basis and any opt-out/consent requirement, Vercel/log-retention and provider statements, jurisdiction-specific terms, and any formal accessibility or compliance claim. This implementation pass will not present those unresolved decisions as completed.

## Visual safeguard verification

Fresh desktop and 390 px mobile captures confirm that the existing RWN logo, green-and-ink visual system, dense high-detail globe, category ordering, and compact mobile header remain intact. The new **See matching services** route appears before the map at both sizes, carries the live match count, and does not introduce mobile horizontal overflow. The globe remains an enhancement below the primary search-and-results path rather than a gate to text discovery.

Browser simulation of `webglcontextlost` confirmed that the event is prevented, the branded fallback appears, the text-directory route remains available, and the retry action becomes visible. Invoking the recovery action restored the globe stage, hid the fallback, and returned the live readout to `World view · 2019 visible · 1.0× · standard boundaries`.

## Production alias verification

The final Vercel production deployment for commit `bff9a129` is ready at `https://rwn-miy7ovqif-anlos.vercel.app/` and serves the updated location disclosure: “Your browser uses location to sort nearby listings…” The custom domain `https://realworldneeds.org/` still serves the previous location wording (“Your exact location stays in your browser”), even with a no-cache fetch. This is evidence of a custom-domain/project-alias mismatch or a stale domain assignment, not an application build failure. The custom-domain association must be corrected before the release can be represented as live on the primary public URL.

Subsequent browser inspection exposed a more urgent custom-domain anomaly: the page shell loaded as unstyled fallback HTML with no rendered globe or source styling, while the direct deployment URL continued to serve the current complete release. This must be treated as a production routing/static-asset delivery issue on the custom domain until direct browser verification confirms otherwise.

## Runtime asset cache remediation

Header inspection isolated the root cause: `/src/styles.css` and `/src/app.js` were served with `Cache-Control: public, max-age=31536000, immutable` while the page referenced those mutable paths without a release version. A browser could therefore retain an old bootstrap, CSS, or module graph for up to a year after a new HTML deployment. The fix adds a deterministic runtime-asset release hash during the build, applies it to the entry stylesheet, app preload, bootstrap module, and every relative JavaScript module dependency, and stores it in the release metadata. Fresh HTML now points to a unique `?v=<release-hash>` URL, allowing the existing immutable cache policy to remain efficient without mixing assets across releases. The build and 161 regression tests passed before redeployment.
