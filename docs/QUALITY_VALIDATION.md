# Exact-commit quality validation

Current policy — November 25, 2026: automated qualification runs natively in GitHub Actions using the included 2,000-minute allowance. No SSH, rwn-mini, self-hosted runner or local fallback is an available testing backend. If Actions cannot run, report the blocker; do not enable paid usage. The historical local-validator sections below document earlier receipts only. `quality-backend.py` accepts only `--provider github`.

The Quality workflow retains the source, catalog, unit, generated-link, static-budget, native-globe and offline suites. It also requires Chromium, Firefox and WebKit and rejects tracked build output/dependencies. Dependencies are locked, and a high-severity dependency audit fails the check instead of being silently ignored.

## November 27 P0 checkpoint: production identity and CI diagnosis

This checkpoint establishes the source baseline and corrects three browser-test assumptions. It does **not** qualify a release or complete P0. No runtime, catalog or database changes are included. Do not merge to `main` or deploy this candidate until the remaining failures and exact-commit gates are resolved.

### Confirmed production source

The authenticated [Vercel deployment overview](https://vercel.com/anlos/rwn-web/5wpRg9Loiv8THxhgGuEzcyVxLumk) identifies project `anlos/rwn-web`, environment **Production / Current / Ready**, deployment `dpl_5wpRg9Loiv8THxhgGuEzcyVxLumk`, source branch `dot/public-site-relaunch-20261125` and Git commit **`f0201672d38b7afbbe0277d0401549ef705a390a`**. Its immutable URL is https://rwn-pkrz48did-anlos.vercel.app. The connector still returned 404; authenticated dashboard evidence, not the connector, establishes that relationship.

Both public domains and the immutable deployment returned identical bytes for `/`, `/directory`, `/data/release.json`, `/src/app.js`, `/src/utils/search.js`, `/directory.js` and `/directory-results.js` (21 HTTP 200 responses). Public release `43ecc64c8284` contains 6,137 listings; catalog SHA-256 is `8ca7c33acc3459eb21bed9e031ea72f40095c476b03e62d923633f4e7d10aa0d`. The catalog hash is not a Git commit.

`src/app.js` and `src/utils/search.js` match this Git source after accounting for existing import/version transformations and the build's cluster-markup replacement; `public/directory-results.js` matches directly. `directory.js` is bundled/minified by `scripts/enhance-generated-pages.mjs`, so a direct authored-file comparison is not valid. Its delivered bytes match the immutable deployment. This is a sampled artifact comparison, not a full reproducible-build attestation.

The remediation branch `codex/remediation-p0-20261127` starts at **`214c6900fbb7075681b16d547e4dd6ace4c76d59`**, a verified descendant of the production commit. It preserves newer dormant analytics work; analytics stays off. Its PR base is `dot/public-site-relaunch-20261125`, not the older `main` (`3a2bc977e11d755a4b68bd156fadbc77bd53bd1b`). `vercel.json` disables automatic Git deployment for this remediation branch only, using [Vercel's branch-scoped configuration](https://vercel.com/docs/project-configuration/git-configuration). No production settings or required checks are bypassed.

### Failed-run evidence and classification

[Quality 45734800526](https://github.com/itspresdavis/RWN-WEB/actions/runs/45734800526) tested head `101b7cf965ac3ecf9f34990b20d58ae54e922019`, starting November 26 at 01:17:56 UTC. Core tests: **1,899 passed, 10 failed, 1 cancelled**. Each of Chromium, Firefox and WebKit: **72 passed, 3 failed**. Native offline/globe and isolated PostgreSQL jobs passed. These are historical results, not candidate validation. [Earlier successful run 45726092530](https://github.com/itspresdavis/RWN-WEB/actions/runs/45726092530) tested `d3298e6cf52d56d27db079121c9f6b252eebff24`.

| Failure location in the failed run | Evidence / classification | Disposition |
| --- | --- | --- |
| `browser-tests/catalog-service-access-upgrade.spec.js:47` | The assertion counted generic directions across all Bowery search results, including a different clinic on Bowery Avenue. The Mission's separate meal and shelter routes remained correct in the captured browser context. | Scope assertions to the exact Mission result, including uniqueness and wrapper checks. All original destination and forbidden-map assertions remain. |
| `browser-tests/search-intent.spec.js:232` | Directory renders 60 of 91 ZIP 02108 matches. Rosie’s Place is in the next batch, not absent from the search. Native Chrome reproduced this on production: 91 of 91 after one Show More action, with Rosie’s Place visible in the accessibility tree. | Exercise pagination on both surfaces, require row-count progress and eventual exhaustion; retain Rosie’s inclusion, Bowery exclusion, postal intent and no-geolocation assertions. |
| `browser-tests/search-safety.spec.js:91` | New Title X record `title-x-a377bbf4-f78d-41d2-8534-139c5c9e32b4` is a distinct Taunton service. [Citizens for Citizens](https://cfcinc.org/programs/family-planning/) confirms its 1 Taunton Green address. | Add that explicit ID to the independent exact-membership oracle; retain equality before/after location denial. This is not a count-only change. |
| `tests/cache-release-build.test.js:21` | Two full builds inside a data-removal fixture exceeded 120 seconds. Catalog growth / concurrent build contention is a hypothesis, not a verified root cause. | Open: profile on a GitHub runner; preserve removal/cache assertions and existing deadline until evidence supports a change. |
| `tests/correction-publication.test.js:75`; `server/correction-publication.js:43` | Genuine contract mismatch: verifier bounds catalog reads at 8,000,000 bytes; current published catalog is 14,269,490 bytes. It rejects before the hash/record verification can succeed. | Open: reconcile with a bounded publication contract and test both declared and streamed overflow. Keep correction intake disabled. |
| `tests/institutional-ux.test.js:171` | Search-index assertion allows 1,650,000 bytes, while failed artifact was 4,485,001 and `scripts/check-static-scale.mjs` allows 5,500,000. Current live index is larger still. | Open: conflicting budgets plus real payload growth. Measure startup use and reduce cost before deciding a documented budget; do not simply raise assertions. |
| `tests/local-seo.test.js:7` (assertion at 14) | Assertion accepts country/city-only paths; generated path includes `/directory/local/united-states/az/douglas`. Likely stale route-shape assumption; collision handling still needs focused verification. | Open: validate route uniqueness, generated links and compatibility before changing expectations. |
| `tests/qa-catalog-expectations.test.js:9` | Fixture emits formatted `4,284 listings`; assertion interpolates unformatted `4284`. | Open: align the independently verified display-format expectation; retain exact membership checks. |
| `tests/qa-catalog-expectations.test.js:20`; `tests/search-relevance.test.js:146` | Literal WIC search also matches `title-x-83e928b0-241c-4017-becb-9e043ea8a6f1`, named Bedford Co. Health Dept. Annex WIC And Health Department. The [official HHS directory](https://opa.hhs.gov/sites/default/files/2026-10/title-x-directory-july-2026.pdf) corroborates the name/address. A Title X record alone does not prove WIC food-benefit service. | Open: distinguish literal provider-name recall from verified WIC program membership/category. Do not replace 395 with 396 without those assertions. |
| `tests/search-geography.test.js:83` | The first-17 Boston-only assertion fails after import. Exact ranked counterexample and intended city-vs-provider-name semantics remain unverified. | Open: capture both full and compact index results before changing matcher or rank expectations. |
| `tests/search-safety.test.js:14`, fixtures S05 and S44 | Same newly documented Taunton Title X service is outside the old two-ID oracle. | Open: update source fixtures with the same independent provider evidence, not matcher-derived expectations. |
| `tests/search-safety.test.js:14`, fixture S26 | Cambridge was expected empty; import adds 16 matches including Cambridge and nearby-city providers bearing Cambridge in their name. | Open: separate obsolete coverage-gap assumption from possible geographic overmatching; verify each intended match. |

### Measurement, boundaries and next action

November 27 production HTTP measurements, decoded bytes: catalog JSON **14,269,490**; search-index JSON **5,283,326**; CSV **7,443,586**. These are artifact sizes, not initial-page transfer totals or representative device benchmarks. No LCP, INP, CLS, heap or GPU improvement is claimed. This patch does not change those assets.

No database permissions, records, grants or enabled features changed. Hosted Supabase security/data-integrity audit remains pending; historical isolated PostgreSQL success is not proof of hosted configuration. No accessibility compliance claim or dead-code removal is made. Existing route safety and location-denial assertions are preserved. Full mobile/assistive-technology review, build-source mutation removal, data-reuse decisions and architecture cleanup remain later milestones.

Run the existing six Quality jobs on the exact candidate using GitHub Actions only. If account allowance blocks execution, retain the draft PR and report the blocker; do not substitute local tests, SSH, paid usage or a Vercel build. The three revised scenarios must pass in all engines; a full green gate is still required before release. Revert the remediation commit to roll back this test-only patch and branch-scoped deployment guard. Next milestone: finish P0 implementation fixes and the remaining independent search/data fixtures, then rerun the complete gate.

## Six mandatory GitHub jobs

The exact-source release selector requires every job below to complete successfully in the selected `push` or `workflow_dispatch` run attempt. It verifies job identity, source SHA, complete job-list retrieval and unique names/IDs. Workflow-level success alone is insufficient. Missing, failed, skipped, timed-out, duplicate or unexpected jobs fail closed. Historical five-job successes remain historical evidence; they do not satisfy this current contract.

| Required check name | Workload | Job limit |
| --- | --- | --- |
| `test` | Locked installation, dependency audit, complete validation/build/tooling tests, native globe touch, service/directory QA and asset upgrade | 24 minutes |
| `Native browser / offline and globe` | Independent locked installation/build, Saved, chaos, institutional interactions, deep globe, offline navigation, service actions and cache upgrade | 24 minutes |
| `PostgreSQL permission and migration tests` | Pinned disposable database fixture | 10 minutes |
| `Cross-browser / chromium` | Locked Chromium journeys and accessibility | 20 minutes |
| `Cross-browser / firefox` | Locked Firefox journeys and accessibility | 20 minutes |
| `Cross-browser / webkit` | Locked WebKit journeys and accessibility | 20 minutes |

The two native jobs run independently. Run `42293453337` exhausted the former single job's 24-minute deadline near its final cache-upgrade script. Its service/Saved/chaos boundary was approximately 16 minutes 40 seconds after job start; the later printed journeys occupied about another 7 minutes 30 seconds. Splitting those existing workloads preserves every script, assertion and deadline. It does not classify the cancelled run as passing. The original full `npm run test:browser:qa` command remains unchanged for local validation; tooling tests check that both CI groups together run those same nine scripts exactly once and in order.

Native evidence is retained for seven days in separate `rwn-visual-qa` and `rwn-native-offline-globe-qa` artifacts. Each job installs from the lockfile and uses the existing pinned actions. This configuration does not purchase capacity or alter account limits. It is a release-tool requirement, not a claim that account-level branch protection has been enabled; configure and verify all six check names where that enforcement is available.

The expanded service/menu journeys remain in `test`; the existing Saved and chaos
executables now begin the other native job. This balances the two workloads while
preserving all nine browser executables, their combined order, both 24-minute
deadlines and the same six required check names. The workflow-contract test
compares the combined sequence with the unchanged full local command.

Both native CI jobs use Chrome for Testing **157.0.8103.38**, the official stable
version in the [November 6 channel metadata](https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json).
The pinned setup action defaults to a changing Chromium snapshot when no version
is supplied; explicit versions make native results repeatable. The reviewed
Linux archive SHA-256 is
`8cdeb344e9b2cefe59f4aea8d1d93d5d93054c03cde217665c16fc1f62e72a66`.
An unchanged touch journey passed on this version before selection. The retained
Chromium 159 cold-return failure is investigated independently; changing browser
versions does not turn that failure into a pass. Review official release metadata
and rerun the complete native gates when updating this version. Playwright's
three engines remain tied to the dependency lockfile.

## Five mandatory local stages

`scripts/ubuntu-quality.py` retains its historical filename and supports explicit Linux and macOS runs. It exports the selected Git commit into a new isolated directory and requires:

1. `install`: clean `npm ci`.
2. `check`: release-tooling regression tests, dependency audit, and complete `npm run check`.
3. `touch`: the existing native globe touch stress suite.
4. `browser`: the existing rendered-service, saved-resource, error-recovery and offline suites.
5. `cross-browser`: lockfile-pinned Chromium/Firefox/WebKit installation, then the complete Playwright suite.

No failed, missing, skipped, or nonzero stage qualifies. A failed touch or browser stage still permits other browser evidence to be collected, while the overall result remains failed. Cross-browser uses port 4199 and refuses an occupied port instead of terminating another process. Existing browser stages use their own explicit ports. New browser artifacts are collected under `qa-cross-browser/`; screenshots, JSON and traces receive SHA-256 hashes in the receipt. Prior generated reports are excluded from the source archive.

Run against an immutable candidate commit, after committing the tested changes:

```sh
python3 scripts/ubuntu-quality.py --ref <full-commit-sha> --output-root /absolute/path/outside/checkout
```

The run needs Node 24, npm, Git, Python 3, Google Chrome, network access for locked dependencies/browser binaries, and the platform libraries required by Playwright. The configured Ubuntu fallback remains Linux-only. A Mac run is always an explicit decision and produces a `macos` receipt; it does not masquerade as the Ubuntu fallback.

On macOS, prepend the installed Node 24 binary directory to PATH and select Chrome explicitly when needed:

```sh
python3 scripts/ubuntu-quality.py --ref <full-commit-sha> --output-root /absolute/path/outside/checkout \
  --chrome-path '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
```

The validator records operating system, architecture, Node/Chrome versions and executable paths. Linux records allowed CPU affinity; Darwin explicitly records that affinity is OS-managed. Install/check keep an isolated HOME. Mac browser stages use the native account HOME for Chrome system integration, while browser profiles, XDG directories, npm/Git configuration, temporary directories and the Playwright browser cache remain isolated. Credentials and arbitrary target URLs are scrubbed from the subprocess environment.

For explicitly selected user-local Linux libraries, `--browser-library-path /absolute/library/directory` applies the directory only to cross-browser testing, records file hashes and rejects changes during the run. It does not install OS packages, bypass Playwright dependency checks, or make missing libraries acceptable. Some Playwright checks inspect the system loader cache and cannot recognize a user-local library tree; that is a real environment blocker. Use a supported host or an independently authorized system setup, never a skip-validation flag.

## Moving an exact source candidate to a testing host

Use a validation-only Git bundle/temporary clone after the candidate commit exists. Preserve the bundle SHA-256 on both hosts. Set the temporary clone's origin to the verified repository `https://github.com/iamhuvr/RWN-WEB.git`, check out the exact commit detached, and verify its commit and tree hashes. The clone is a disposable test input, not a second canonical editing repository. The validator independently exports and hashes that exact Git tree before installation. Do not combine stage results from different platforms, commits, or runs.

Keep the complete receipt, logs, source archive hash, validator source hash and browser evidence. The release tool checks the commit, tree, archive, validator bytes, platform consistency and a maximum receipt age of 24 hours. An older four-stage receipt is invalid for the current validator.

## Account enforcement and publishing

The repository workflow declares checks; it cannot activate repository protection or change account billing. Inspection on November 5–6, 2026 found historical October 29–30 Quality jobs blocked before any step by billing/spending status. Those old annotations do not establish current eligibility: on November 6 the owner reported that minutes were available again and requested GitHub-first validation. Fresh Quality run 42172565854 then executed every job; historical billing is no longer a current blocker. Its application/harness failures must be repaired and rerun through GitHub without switching to a local fallback. Private-repository branch-protection APIs separately required an eligible plan when inspected; recheck current permissions before claiming enforcement. No plan upgrade, spending change or visibility change is authorized by running tests.

Before release, independently verify required checks on main and Vercel Deployment Checks for `anlos/rwn-web`. Vercel READY means a deployment built; it does not prove application tests passed. GitHub-first selection remains in `quality-backend.py`; an old billing annotation cannot silently authorize a fresh local fallback.

An explicit passed receipt can be checked without creating a deployment:

```sh
python3 scripts/release-tested.py --ref <full-commit-sha> --receipt /absolute/path/receipt.json --dry-run
```

The deploy tool stages production with domain assignment disabled. Merge/promotion still require explicit release authorization and complete checks. No test command sends account mail, changes real accounts, promotes production, or alters plan settings.

## Isolated database integration evidence

The separate mandatory PostgreSQL CI job loads the official PostgreSQL 17.11 Bookworm image by immutable registry digest and runs `python3 scripts/qa-postgres-permissions.py`. The runner uses a unique disposable container with no network, host ports or host mounts; the database resides in bounded temporary memory. It exercises the real PostgreSQL permission model and candidate migrations, including the baseline private-column exposure and corrected role access.

The database fixture supplies a minimal simulated Supabase auth schema. These tests do not validate hosted Supabase configuration, real sign-in, email delivery or deployed migrations. The five-stage local quality receipt does not include this separate database run. Preserve its logs, image identity and source commit alongside that receipt, and require the CI database job when account-level checks become available. No production database is contacted.

The November 6 local SQL evidence uses the already-installed PostgreSQL 17.11 image. The CI registry digest selects a different image build of that version and has been verified against official registry response bytes, but has not been pulled or executed locally under the existing no-pull constraint. The pinned-image PostgreSQL job passed in fresh GitHub Quality run 42172565854 for head 20cded56a78b747cb7a9a3981a715f9f4cc30874. This provides CI evidence for that exact image independently of the older local image. The overall run failed other application/harness checks and is not a successful release gate. Do not label the local run as testing that exact CI image.
