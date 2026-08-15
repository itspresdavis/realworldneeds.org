# Deep RWN-WEB Readiness Scope

## Protected Baselines

The Real World Needs logo, green-and-ink color system, public-service editorial tone, existing typography, detailed globe, deep zoom, marker architecture, and scroll-safe interaction remain protected. The objective is to make the current product visibly clearer, calmer, faster to scan, and more operationally resilient—not to replace its identity with a generic redesign.

## Visible-Polish Criteria

The deep pass will look for reproducible issues in first-screen hierarchy, headline clarity, input density, need-filter readability, action contrast, spacing rhythm, mobile touch affordance, service-card scanability, directory and service-page flow, keyboard focus, and motion/reduced-motion behavior. Visual changes must be noticeable to a first-time visitor while remaining consistent with the existing RWN system.

## Static-Scale Criteria

RWN is a static directory delivered at the edge. This pass will prioritize deterministic build output, immutable versioned assets, bounded client interactions, no unbounded data fetches, conservative cache behavior, resilient offline installation, static SEO crawlability, and browser/runtime error freedom. It cannot certify an exact daily-user ceiling; traffic capacity ultimately depends on Vercel edge infrastructure, upstream provider availability, and operational monitoring.

## Acceptance Evidence

Any proposed change must survive the source/data/build gate, browser chaos and interaction suites, globe regression suite, visual review at narrow and wide viewports, no-cache production fetch, and a production deployment that reaches `READY`.
