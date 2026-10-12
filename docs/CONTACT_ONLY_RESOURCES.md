# Contact-only resource contract

Use `locationPrecision: "contact-only"` for reviewed phone, web, or network access routes that have no published walk-in service location. Keep the existing `kind` meaning (`locator` or `network`); `direct` still means a physical service location.

## Required evidence

- Omit both `lat` and `lng`, or set both to `null`. Never substitute an office, capital, country centre, or zero coordinate.
- `country` identifies the country directory in which the route belongs. It does not establish nationwide eligibility. `address` contains coverage text, not a fabricated street address. `city` is optional and never makes a contact-only listing part of local-city pages.
- `coverageNote` states the reviewed geographic limits; `eligibility` states who can use the route and any known limits. Unknown availability must remain explicit.
- Supply a public HTTPS `accessUrl`, a `phone`, or both. When supplying a phone, also supply plain-text `phoneAccess` describing the reviewed dialing scope, domestic shortcode limits and known charge caveats. Do not invent an international prefix.
- Existing attribution, review-date, category, cost and availability requirements still apply. `free-navigation` describes the navigation route only, not the cost of downstream services.

## Public behavior

Contact-only listings appear in country, region and need discovery, accessible service pages, saved results, full JSON, country/category shards and CSV. Search remains local to the visitor's browser. Coverage, eligibility and dialing limits appear before a visitor relies on the contact details.

These records do not produce globe vertices, DOM pins, connection lines, map links, directions, nearby distances or city-SEO memberships. A selected record opens its contact details without moving the globe. Map-index counts include mapped records only; full-directory counts include contact routes too.

The service structured data uses reviewed `coverageNote` as `areaServed` and supplies the available contact channels without a physical location. Existing physical and coverage-marker records retain their behavior. New search-index fields are present only for contact-only records; there is no additional network request or tracking.

## Database rollout gate

The current database's generated latitude and longitude columns are NOT NULL. This code change does not modify that schema or publish new records. A separately reviewed migration is required before contact-only records can enter the database. That review must cover nullability, shape constraints, coordinate-review view semantics and generated client types; audit history and editorial fields must remain intact.

Deploy compatible code first. Apply a reviewed migration only after approval, then reconcile reviewed data through the normal guarded publication process. Reverting to the old NOT NULL schema is unsafe while any row retains missing coordinates, including withheld rows. Never fill invented points to enable rollback.

`tests/contact-only-generation.test.js` runs synthetic physical, phone-only, web-only and mixed fixtures through validation and the full static build in a temporary copy. No test fixture is published in the catalog.

The rendered CI harness also creates an isolated, loopback-only fixture app using the normal renderer. It checks the homepage exports, phone-only/web-only/mixed service pages, copied facts, domestic shortcodes, long URLs, search, Saved, failed-probe recovery at desktop and narrow widths, plus no-JavaScript reading at 320px. The temporary pages are visibly labelled synthetic and noindex; the production build never imports them. Provider feeds are stubbed, external resources are rejected, and the app is cleaned up after the checks.
