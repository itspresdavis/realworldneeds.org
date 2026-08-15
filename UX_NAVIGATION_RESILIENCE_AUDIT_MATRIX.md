# UX, Navigation, Motion & Resilience Audit Matrix

## Protected product baselines

This pass must preserve the established **RWN logo, green-and-ink visual identity, typography, homepage composition, detailed globe, deep zoom, pointer-anchored zoom behavior, and page-scroll ownership**. Work is additive and evidence-driven; no generic redesign, replacement map, fabricated impact content, or decorative motion is permitted.

## Audit scope

| Surface | Review questions | Evidence required |
| --- | --- | --- |
| Finder and results handoff | Can a first-time visitor search, use a core need, use location, reset, and reach results without ambiguity? | Browser journeys, keyboard checks, query latency, no-result/recovery review |
| Navigation and history | Can users orient, return, use browser history, and operate mobile navigation at narrow widths? | Desktop/mobile/tablet flows, back/forward, focus and scroll-lock checks |
| Visual system and motion | Are hierarchy, spacing, focus, actions, and transitions deliberate without visual noise? | Multi-viewport screenshots, reduced-motion review, source-style audit |
| Directory and service pages | Can users scan, call, obtain directions, see access constraints, inspect sources, and find alternatives? | Mobile and desktop card/service journeys, long/missing-data regression tests |
| Globe | Does the existing signature globe remain smooth, readable, resilient, and subordinate to service discovery? | Existing and expanded globe interaction/resilience QA, context-loss checks |
| Input and state resilience | Do unusual input, rapid interaction, malformed client state, URL changes, resize/orientation, and offline transitions fail safely? | Deterministic local abuse suite and browser resilience tests |
| Performance and compatibility | Does the UI remain usable under reasonable stress, across responsive widths, without stale assets or console errors? | Browser matrix, asset/version checks, interaction measurements, console review |

## Prioritization policy

P0 blocks the ability to discover or act on a service. P1 creates meaningful confusion, loss of state, inaccessible navigation, or crash/recovery failure. P2 lowers polish, perceived quality, or scanability. P3 is a refinement. P0 and P1 are fixed first; P2 improvements are accepted only when they do not slow search, obscure service actions, or increase risk.

## Release gates

The release must retain the prior automated suite, pass new deterministic UX/resilience coverage, preserve zero known console errors on core flows, show no horizontal overflow at target viewport widths, retain usable keyboard and reduced-motion experiences, keep the globe recoverable, and verify the live custom domain loads matching versioned assets.
