# UX, Navigation, Motion & Resilience Audit Findings

## Responsive baseline

The 320 × 568 mobile finder retains the established RWN mark, label, ink-and-green palette, full 44px-plus category controls, and an immediately visible matching-services action. The 1440 × 900 desktop view retains a calm compact header, clearly subordinate organizational links, a task-led finder, and the detailed globe as a complementary wide visualization rather than a blocker to search. No horizontal overflow or displaced core control was observed in these two baseline screenshots.

## Initial friction map

| Priority | Finding | Evidence | Candidate remediation |
| --- | --- | --- | --- |
| P1 | A stale or mismatched mobile/desktop QA finding must not be treated as product evidence until the current script is run. | Current `qa-directory` completed all 23 checks, including no overflow, touch targets, semantic search, source/review-date presence, and console hygiene. | Retain the working directory QA and add coverage only for reproducible gaps. |
| P2 | Finder state, including a selected result and no-result recovery, needs a more explicit, reversible handoff contract. | Current source and independent audit identify limited user-visible state restoration and no one-click interactive finder reset. | Add bounded URL/history state only for non-sensitive finder controls; retain raw coordinates in memory only. |
| P2 | Mobile header and core finder already read clearly in the rendered 320px baseline; deeper stress testing should target menu focus/escape/outside behavior and dynamic state rather than restyling the header. | Rendered baseline and current native disclosure navigation. | Add lightweight disclosure behavior and deterministic browser checks only if the current rendered behavior is incomplete. |
| P2 | The existing visual identity is strong and must not be replaced. | Desktop screenshot shows coherent RWN header, finder hierarchy, green service action, and detailed globe. | Improve focus, loading parity, and state feedback additively rather than redesigning palette, logo, or globe. |

## Deterministic baseline checks

The current directory QA completed **23/23** checks, including semantic search, no-result recovery, tap-target sizing, service source and checked-date visibility, mobile overflow, and console hygiene. The existing browser chaos suite completed desktop/mobile rapid search and filter churn, globe input, WebGL loss/recovery, reduced-motion, accessibility-name, static route, pagination, and compact-index checks successfully. The two protected globe suites also passed: **15/15** scroll/zoom ownership checks reached 11.69× deep zoom without horizontal overflow or console exceptions, and the complementary WebGL/deep-view suite preserved live rendering, integrated points, and bounded layout at 6.13×.

The implementation pass will therefore focus on measurable recoverability and state continuity: bounded query input, explicit interactive-finder recovery, non-sensitive history restoration, mobile-menu dismissal/focus continuity, and expanded deterministic interaction/abuse coverage. It will not replace working directory, globe, or navigation systems merely because they are complex.

## Interaction-test diagnostic

Direct browser inspection confirmed that finder state is now stored as a bounded, non-sensitive `history.state.rwnFinder` object after a search. It also confirmed that the refined results surface does not expose the raw `data-resource-id` buttons assumed by an initial draft interaction assertion. The QA will therefore exercise the public result-link surface and explicit `popstate` state restoration rather than relying on a private card selector that the presentation layer intentionally replaces.

## Implemented safeguards and verification

The finder now bounds text input to 180 cleaned characters and uses a short cancellable timer rather than animation-frame-only scheduling, so constrained or background browser states still settle a search deterministically. Its no-result surface gives an explicit **Clear search and filters** route, and the finder preserves only non-sensitive query/filter/selected-listing state in `history.state`; coordinates remain out of history state.

Location failure feedback now provides an explicit retry control when the platform can retry. The native mobile menu closes on Escape, outside click, or desktop breakpoint change and returns focus to its summary trigger on Escape/outside dismissal. Offline cache/service-worker registration remains fail-open but now emits a clear status-toast warning if offline saving is unavailable.

Post-implementation validation passed: 166/166 release tests, the complete browser resilience suite, dedicated interaction QA, and 15/15 globe regression checks. Interaction QA now covers input bounds, no-result recovery, popstate restoration, location retry, menu focus return, and the established globe layout.

## Live-production verification hold

After the `6a46e95f` deployment reached Vercel `READY`, the initial browser capture showed the intended no-JavaScript fallback during startup, so delivery was paused and the live asset graph was inspected instead of relying on the Vercel state alone. The custom domain loaded release-hashed `styles.css`, `clarity.css`, `app.js`, and `bootstrap.js`; the initialized document had the professional/refined/accessibility/result-action classes, a rendered search input and results surface, five root children, and a live 797 px globe canvas. This was a startup-capture timing artifact, not a stale-asset or runtime failure.
