# Priority coverage and access review — November 7, 2026

State: **implemented factual additions and report; integration/publication verification pending**. This review starts from `bfd53f5ed88cf50cb987eaba2fac6fb6f867cd75` and adds two direct meal-service records, two eligible free-care clinic records and one national health-information finder. It does not claim exhaustive local coverage or live availability.

## Source decisions

- **Amos House Soup Kitchen, Providence** (`amos-house-providence-meals`): [official food page](https://amoshouse.com/what-we-do/food) explicitly supports free meals without ID or proof of need at 460 Pine Street. Weekday breakfast/lunch hours are structured. Saturday lunch remains explicit text because the first Saturday of each month is closed; partial machine intervals must not produce a Saturday opening/closure claim.
- **Taunton Area Community Table** (`taunton-community-table-meals`): [official Visit Us page](https://www.tactmealcenter.org/visit-us.html) and [mission page](https://www.tactmealcenter.org/our-mission.html) explicitly support free meals with no paperwork/ID. The physical meal center at 378 Bay Street is distinguished from its mailing PO Box. Weekday sit-down/to-go hours and monthly last-Thursday dinner are separate routes. The page labels its schedule “updated July 2026”; no exact publication date is invented.
- **IMSS-Bienestar, Baja California** (`imss-bienestar-tijuana-centro`, `imss-bienestar-rosarito-urbano`): the [official clinic finder](https://www.imssbienestar.gob.mx/02_ubica_clinica.html) supplies two distinct CLUES clinic identities with clinic coordinates, addresses, phones and partial time ranges. The [official registration information](https://registro.imssbienestar.gob.mx/) explicitly states free care for people without social security coverage and includes Baja California. Operating days remain unknown; no open/closed status is derived. A separate contact-only national finder (`imss-bienestar-mexico-finder`) supports eligibility/registration information without turning headquarters or a coverage point into a care location.
- **The Beacon, Houston** (`beacon-houston`): [official Get Help page](https://www.beaconhomeless.org/gethelp) supplies the Caroline Street entrance, separate breakfast/lunch schedules, limited first-come capacity and housing-assessment intake. Shower/laundry end times remain unknown. The prior no-cost claim is retained, not newly certified by a source that does not state it. Its broad August 4 review date remains unchanged.
- **The Bowery Mission** (`bowery-mission`): [official Get Help page](https://www.bowery.org/get-help/) again distinguishes 227 Bowery meals from 90 Lafayette shelter intake. Meal start times do not become fabricated intervals. Gender-specific shelter/shower intake, medical-van hours and no-ID/insurance restrictions receive scoped evidence. The ID, existing reference coordinates and broad August 4 review date remain unchanged.

The two new physical sites use `locationPrecision: address` and null coordinates. Directions use complete provider-published service addresses. No map point, geocoding precision or provider endorsement is invented. No original listing was removed or split; existing Saved IDs remain valid.

The [source/evidence ledger](2026-11-07-priority-access.json) records scopes, successful fetch times, document hashes, source publication uncertainty, exclusions and limited reuse basis. These are bounded original factual summaries with attribution and source links, not republication of provider prose, imagery, logos or datasets. No bulk-feed licence or authorization for unrestricted scraping is asserted. Full fetched documents and failed requests remain in private local evidence storage outside tracked source.

## Comparable static-snapshot counts

Both columns use `createCoverageReport` with the same explicit date, November 7. These are catalog measures, not people served or guaranteed assistance.

| Measure | Baseline | Candidate |
| --- | ---: | ---: |
| Published listings | 1,992 | 1,997 |
| Direct service records | 1,814 | 1,818 |
| Unique normalized physical service addresses | 1,801 | 1,805 |
| Referral/network records | 178 | 179 |
| Address-only direct records | 0 | 2 |
| Direct records missing the broad structured hours field | 1,692 | 1,691 |
| Direct records with service-specific machine schedules | 0 | 4 |
| Direct records without structured record/route eligibility | 46 | 45 |

Multiple services at the same normalized address count once. Bowery's two service destinations count separately; a network's coverage marker counts zero physical sites. Written-address aliases can still require manual deduplication. All four new physical records have populated hours, so they do not increase the missing-hours count. These measures do not say that the remaining 1,691 records have no narrative schedule.

US static records increase from 437 to 439; Mexico records increase from one national finder to four records (two clinics and two national finders). Massachusetts WIC remains 101; New York WIC 293; the Trussell dataset 1,373. `trussell-*` prefix counts can include a separate finder and must not be used as the feed count. The dynamic USDA seasonal feed remains entirely outside these totals.

## Priority-community matrix and remaining gaps

The generated report contains all six needs for every community, plus exact record IDs. The concise summary below counts country-qualified static records only; the UK places called Boston and Taunton are excluded from the Massachusetts rows.

| Community | Direct records before → after | Explicit direct meal records before → after | Remaining evidence gaps |
| --- | ---: | ---: | --- |
| Boston, Massachusetts | 15 → 15 | 10 → 10 | This tranche preserves existing coverage; it is not a new comprehensive check of every provider, pantry, diaper or free-health service. |
| Brockton, Massachusetts | 2 → 2 | 0 → 0 | Existing WIC records are food-benefit programs. Smith Family Housing Resource Center and Charity Guild have usable official access facts, but explicit no-cost wording was not established in the reviewed pages. FBMS terms also restrict reuse. Candidates remain unpublished. |
| Taunton, Massachusetts | 1 → 2 | 0 → 1 | Adds a verified free meal site. Pantry, shelter, hygiene, diapers and free-health gaps remain. |
| Providence, Rhode Island | 0 → 1 | 0 → 1 | Adds a verified free meal site. The reviewed Crossroads source supplies housing-referral contact details but does not independently establish a no-cost claim, so no extra record is published. Other need gaps remain. |
| Playas de Rosarito, Baja California | 0 → 1 | 0 → 0 | Adds a verified IMSS-Bienestar clinic for eligible uninsured people. Meals, groceries, shelter, hygiene and diapers remain gaps. DIF pages are inaccessible through the current environment. |
| Tijuana, Baja California | 0 → 1 | 0 → 0 | Adds a verified IMSS-Bienestar clinic for eligible uninsured people. Other need gaps remain: Padre Chava and DIF service pages did not explicitly establish no-cost terms. General office hours are not assumed to be meal/intake hours. |

A missing record is not evidence that a service does not exist. The new official IMSS-Bienestar finder and existing UNHCR Mexico finder remain options for their respective eligible audiences; it is not counted as verified local Baja coverage. No broad referral is relabeled as a local physical provider to fill a quota.

## Repeatability, refresh and publication

The additions are an explicit reviewed source module, not a live scrape. Stable IDs and the normal deterministic catalog/build pipeline make repeated builds idempotent. `scripts/review-imss-clinics.mjs --input source.json --output new-private-candidates.json` prepares only two allowlisted CLUES candidates from a bounded local source file, deduplicates repeated postal matches, rejects conflicting/missing facts and never writes the published source module. It preserves clinic coordinates separately from postal centroids; changed hours are review candidates, not an automatic publication. The source module is included before editorial overrides, preserving existing editorial precedence and withheld IDs. No hosted catalog rows or review history are overwritten by this change.

Run:

```sh
node --test tests/coverage-report.test.js tests/priority-community-resources.test.js tests/imss-clinic-review.test.js
node scripts/coverage-report.mjs --date 2026-11-07 --output /private/local/path/coverage.json
npm run catalog:health -- --date 2026-11-07 --output /private/local/path/health.json
```

The focused data/report tests pass: 16 passed, zero failed/skipped on the work package. The full address-only validator, final generator, search/index budgets, rendered journeys and hosted release require integration with the access-contract change and a fresh final-candidate receipt. No prior CI run certifies these new records.

Review should start with unsafe destinations, immediate-need intake and missing access facts. `catalog:health` supplies the existing risk-based queue and source-health outcomes; `coverage-report` adds completeness and locality gaps. Neither a successful fetch nor this report advances the broad review date. No staffing assignment, alert delivery, recurring operational monitor, provider contact or response commitment is claimed.

If a reviewed source fails on a later refresh, retain the current evidence and create a review candidate; do not replace records with empty or guessed fields. If a fact is shown unsafe, withhold the affected action and preserve a useful official contact route while investigating. Remove a newly published record only through the established retirement/publication flow so cached consumers and Saved can explain its status.
