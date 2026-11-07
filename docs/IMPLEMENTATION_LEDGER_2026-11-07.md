# RWN access-quality release — implementation and evidence

Integration owner: root engineering agent. Working branch: `release/access-quality-20261107`.
Baseline: `bfd53f5ed88cf50cb987eaba2fac6fb6f867cd75`, preserving the cumulative PR #97–101 stack without duplicate cherry-picks. Unrelated worktrees are preserved. No `AGENTS.md` was found; `CONTRIBUTING.md`, README and existing runbooks apply.

## Current-state evidence

- PRs #97–101 remain open, draft and unmerged; no newer PR was returned by the current repository search. Main remains `3a2bc977e11d755a4b68bd156fadbc77bd53bd1b`.
- Both public hosts still serve release `0b2bd1f1b798`, deployment `dpl_AU7kzmhb258wa6nBeLEcdLUhrEs1`. The public artifact has previously been reproduced from #97 (`574447c8`); the CLI deployment metadata does not expose a Git SHA, so exact backend source identity remains unproven.
- Existing preview `dpl_FFDjiLQyCscEb2FS8Y7AXPcZ3MXx`, https://rwn-28866oid8-anlos.vercel.app, identifies `bfd53f5e` and serves release `a8555440c322`. Fresh sampled homepage/Bowery/locality hashes match the baseline build.
- Supabase `cytfrxldixdapjaxcqzf` now reports `ACTIVE_HEALTHY`, PostgreSQL 17.6.1.155. The previous inactive state is historical. Recovery was not performed by this work; its cause and recovery/backup history remain unverified.
- Bounded hosted aggregates: 2,033 catalog rows, 1,992 published, zero `rwn_members`. Anonymous table-wide SELECT and anonymous/authenticated `editorial_note` SELECT are denied. November 7 hosted migrations apply the three historical November 6 restrictions under different timestamps; do not reapply by filename. Correction tables were absent at baseline; subsequent applied changes are recorded below. Other unrelated hosted tables are out of scope.
- Main protection is not enforced. Ruleset inspection is plan/visibility blocked; protection inspection is integration-permission blocked. Vercel project responses omit the automatic-domain-assignment setting; an earlier update acknowledgement is not independent enforcement evidence.
- Runtime: Node 24.22.1, npm 11.9.0, locked dependencies. Browser-control tool is absent despite listed skill; this assignment explicitly permits Playwright. Physical-device/assistive-technology evidence remains unavailable.

Detailed logs, provider captures, screenshots and measurements are kept outside tracked source in `/workspace/rwn-release-evidence/access-quality-20261107/`.

## Requirement-to-implementation checklist

“Verified locally” below identifies component evidence, not a production release.
The exact integrated source must additionally pass all six Quality jobs and hosted
preview checks. The release PR on `release/access-quality-20261107` records its
immutable SHA, run/deployment IDs and final receipt; earlier component artifacts
are never relabeled as testing that final commit.

| ID | Implemented behavior / principal files | Verification and environment | Remaining dependency / state |
| --- | --- | --- | --- |
| 1–2 | Preserved cumulative PR #97–101 ancestry at `bfd53f5e`; isolated integration branch; source generators remain authoritative | Fresh PR, Git, deployment and live-manifest reads; baseline artifact comparison | **Verified baseline.** Main and deployed backend SHA are not assumed equivalent; account enforcement limitations below |
| 3 | Typed validated route facts and actions, exact address-only destinations, stable IDs; `service-access.js`, `resource-location.js`, `service-before-you-go.mjs`, CSV generator | Bowery distinct addresses, invalid/legacy/confidential/contact routes, all compact exports, Saved/copy/print; 15 focused Chromium/Firefox/WebKit journeys on the inline-action build | **Implemented / verified locally.** Final integrated release evidence remains distinct |
| 4 | Need/place/time/food intent; explicit bounded postal areas; cancellation of stale device location; per-pass intent plan; `search*.js`, directory/app | Deterministic catalog-based relevance, original/urgent/Spanish/ZIP/ambiguity/empty cases, actual UI and delayed-response fixtures | **Implemented / verified locally.** Postal reference is limited documented US coverage, never an automatic country/radius guess |
| 5 | Time-zone schedules, overnight/exceptions/unknown state, intake/eligibility/entrance and scoped field evidence; `service-schedule.js`, priority sources | Controlled-clock unit cases; official Bowery/Beacon sources; generated Before you go facts; original broad dates preserved | **Implemented / verified locally.** Live availability remains unknown; review cadences require operational approval |
| 6a | Anonymous bounded correction intake, durable SQL idempotency/rate limits, optional reply/source/proposal; API/public correction files | 60 focused Node checks; disposable PostgreSQL persistence, retries and abuse cases; isolated real-browser form journeys | **Implemented / verified locally.** No production test report or owner delivery is claimed |
| 6b | Private transitions/assignment/revisions, atomic catalog apply, retained old notes, immutable events, fixed-origin publication verification | Real SQL role/concurrency/clean-upgrade fixtures; 15/15 three-engine correction journeys, full-page axe, publication failure/retry | **Implemented / verified locally.** Complex service-route edits retain the full source/publication gate |
| 6c | Hosted queue migrations and denial behavior, disabled configuration | Anonymous Data API and nonmember SQL denied review/private data; status false; zero reports/members | **Deployed schema and verified denial. Activation blocked:** confirmed reviewer, monitored queue, approved retention/abuse/capability and hosted test recipient |
| 7a | Five reviewed additions; two existing scoped corrections; stable CLUES/provider IDs and idempotent candidate extraction | Official provider/government captures; 1,997 published records / 1,818 direct / 1,805 normalized physical addresses / 179 finders-networks | **Verified locally and reconciled to hosted catalog.** Static production website has a separate release gate |
| 7b | Six-community need matrix, no-cost/reuse scopes and explicit exclusions; `coverage-report.mjs`, priority evidence ledger | Comparable baseline/candidate report; Boston/Brockton/Taunton/Providence/Rosarito/Tijuana IDs and residual gaps | **Verified report. Coverage incomplete** where free access/source/reuse evidence is missing; no invented providers or quota padding |
| 7c | Existing source-reuse uncertainty separately recorded in source registry/data-pipeline guide | Bounded current terms review; Trussell attribution is not a licence; UNHCR terms fetch rate-limited | **Blocked source decisions:** applicable Trussell bulk-reuse permission; separate UNHCR country-link terms review. Neither feed refreshed or mass-withheld |
| 8 | Mobile eligibility/age/referral facts and review dates visible; wrapping rows, consistent focus/navigation | Inspected Rosie/Bridge before/after images; 320/390/768/1440 and enlarged text, short-height keyboard menu; CSS stays below unchanged 38 KB cap | **Implemented / verified locally.** Physical-device and assistive-technology checks unavailable |
| 9 | Explicit municipal/regional/national scope, relevant related help, no country-placeholder city; legacy New York and country routes redirect | Locality/negative-related fixtures, generated titles/canonicals/sitemap/structured-data and route tests | **Implemented / verified locally.** Actual hosted routing must be checked on candidate preview |
| 10 | Truthful About/Our work/Get involved/Contact and broader mission; `organization-content.js`, generator, Transparency | Generated page/link/copy checks; approved repository facts only | **Implemented / verified locally.** Volunteer placement, donations, RWN case intake and unverified program/partner claims remain unavailable |
| 11 | Central English/Spanish public UI; scoped correction/account adapters; original provider/private text retained; non-phone route contacts | 59 focused public/account Node checks; 27 three-engine locale journeys; input/draft/revision/Saved/destination preservation; inspected Spanish images | **Implemented / verified locally.** Original provider prose is explicitly identified; no claim of provider Spanish capability or complete catalog translation |
| 12a | Scoped grant repair, address contract, disabled queue schema; existing account/export behavior preserved | Hosted grant/Data API denials, complete catalog reconciliation; PostgreSQL clean install/upgrade, column/row grants and audit fixtures | **Deployed database repairs and verified boundaries.** Real sign-in/email/recovery/reviewer flows and backup drill remain blocked separately |
| 12b | Exact-byte offline dependency graph, optional postal caching, legacy workers/tombstones/Saved; `sw.js`, versioning and upgrade fixtures | Real Chromium asset/cache upgrades plus unit/three-engine compatibility journeys; frozen legacy fixture unchanged | **Implemented / verified locally.** A disconnected device cannot receive immediate withdrawal; origin-specific Saved storage is retained |
| 12c | Deferred offscreen globe; validated lost-context fallback; module preloads and one intent parse per pass | Identical repeated cold/warm profiles, real globe/native cases, request counts, no unsolicited maps; detailed performance report | **Implemented / measured locally.** No overall/field speedup claim. Final candidate and hosted profiles recorded separately |
| 12d | Bounded private-safe telemetry; no fake INP/CLS labels; gated public catalog-health workflow | Request/privacy tests, 27 operations-report checks, actual local reports; 619 proposed review candidates, 152 high priority at November 7 | **Implemented / verified locally. Operational monitoring blocked:** owner/escalation approval and tested delivery; workflow presence is not monitoring |
| 13 | Full unit, SQL, native and three-engine release suites; actual screenshots and failures retained | Component evidence below; exact final source requires the mandatory Quality workflow | **Verified component coverage.** Real iPhone/Android/Edge/AT and hosted auth remain explicit capability/ownership gaps |
| 14 | Traceable candidate/preview, GitHub-first checks, safe staging and rollback procedure | Exact-source selector requires six distinct successful jobs; pinned actions/lockfile; deployment metadata and bytes compared | **Production staging blocked** until scoped CLI authentication permits `--prod --skip-domain` and raw control verification. No live domains moved |
| 15 | This ledger, source matrix, database/correction/locale/performance/operations runbooks, reviewable commit series | Evidence stored outside tracked source; final PR/receipt identifies source, build, schema, catalog, CI and preview separately | **Implemented handoff.** A blocked item remains incomplete and is not hidden by an implementation claim |

## Evidence index and integration results

- Database controls, migration timestamp mapping and full catalog reconciliation:
  [database verification](DATABASE_VERIFICATION_2026-11-07.md). Hosted catalog hash:
  `f24285108fc754820ffbc87d614abecea05952e3213b0b36bc86254b18166a12`.
- Source scopes, cost/reuse evidence, exclusions and before/after matrix:
  [priority coverage review](catalog-reviews/2026-11-07-priority-coverage.md) and its JSON ledger.
- Correction activation/review/recovery: [correction handoff](CORRECTION_CHANNEL_HANDOFF.md).
- Language boundaries and task preservation: [localization](LOCALIZATION.md).
- Performance profiles, raw/compressed budgets and measured tradeoffs:
  [performance evidence](PERFORMANCE_2026-11-07.md).
- Owner-gated reporting and escalation prerequisites:
  [catalog operations](CATALOG_OPERATIONS.md).

Intermediate integrated Node runs are retained rather than erased: first
1,753/1,779 passed; second 1,805/1,810; third 1,819/1,824. Remaining failures in
that third run were two VM fixture assumptions after lexical wrapping (fixed by
executing the real scoped renderer with browser globals) and three instances of
one 49-byte CSS overrun (fixed by consolidating duplicate declarations). No URL,
role, legacy-worker, visibility or accessibility assertion was removed. The core
budget exception has measured required behavior and new aggregate guards in the
performance report; it is not presented as a broad performance pass. Final
complete results belong to the exact-candidate receipt, not these intermediate
counts. Release-tool tests separately passed 40 + 42 + 27 cases; locked dependency
audit reported zero vulnerabilities at the recorded run.

The later 1,822/1,824 integrated run exposed a 32,009-byte page stylesheet and a
1,094-byte early-input script. Shared identical declarations and input-capture
logic brought them below their unchanged 32 KB and 1 KB limits. The delayed-module
fix preserves places typed or cleared before enhancement. Publication verification
now binds the exact catalog bytes to `catalogSha256` in a stable manifest; 48
focused correction/security tests pass, including stale or missing hash rejection.
The exported metadata explicitly disclaims a blanket dataset reuse licence.

Images include Rosie/Bridge narrow cards before and after, Spanish Beacon access,
private correction/workspace fixtures, short-height focused navigation and the
detailed globe. Component browser evidence uses Chromium 158, Firefox 159 and
WebKit 27.2 where recorded; native-system runs record their own Chrome version.
WebKit used the existing official Playwright 1.65 image, digest
`sha256:6e3fb709361521eb27161606e6da6d2674e5e89fa16516cb37d6fdd91372273d`.
Unsupported host launches and WebGL capability skips remain recorded. Browser
emulation/enlarged text is not actual mobile hardware, screen-reader use or a
claim of every browser's native zoom behavior.

## Ownership and integration

Independent worktrees preserve unrelated changes. Search owns matching and search
state; access owns route/schedule contracts; coverage owns reviewed facts and
reports; UX owns locale/styles/account presentation; database owns correction
APIs/SQL; QA owns independent measurement and retained evidence. Root integrates
shared generators, scope/SEO/content, telemetry, offline graph and release checks.
Changes were committed as coherent packages and integrated without rewriting the
historical PR stack or applied migration history.

## Completed hosted repair

`20261107055114_restrict_rwn_private_table_privileges.sql` (source patch `639f129e`, integrated as `5912a9fd`) was tested in a disposable PostgreSQL 17.11 clean/upgrade fixture before applying to the existing PostgreSQL 17.6 project. SQL SHA-256: `6a75a274ed6e2eefdcdcc35d8051cc3c1ea01a5998010a66d714f60a89487628`. The supported migration tool recorded hosted version **20261107055509**, name `restrict_rwn_private_table_privileges`. Match name/content; do not apply the local timestamp again.

Preflight reproduced excessive TRUNCATE/TRIGGER/REFERENCES rights for anon/authenticated on four RWN private tables and authenticated audit-sequence UPDATE. No destructive probe was used. No waiting or exclusive locks on affected tables were observed. The scoped REVOKE/GRANT statements change privileges only, preserving service-role maintenance and existing RLS/audit functions.

Hosted postflight: zero unsafe private-table maintenance grants; sequence UPDATE denied; legitimate authenticated review INSERT retained. Actual anonymous SQL reads count 1,992 published rows. Anonymous and authenticated `SELECT editorial_note ... WHERE false` both receive 42501 permission denial without extracting rows. Totals remain 2,033 catalog / 1,992 published / zero memberships. No role assignment or production fixture data was created. This is a verified hosted permission repair, not proof of hosted email flows, backups, correction operation or publication of the new source catalog. Details: external `hosted-grant-repair.json`.

The rollback is a forward permission correction preserving confidentiality; never restore the old excessive grants. The migration is compatible with the current public snapshot and existing contributor operations exercised in the fixture.

## Release and recovery boundaries

The user's earlier instruction authorizes repair and deployment. No further general permission request is needed for that scope. Operationally incomplete corrections stay disabled; no reviewer is appointed, production test data inserted, paid service purchased or destructive migration performed. Source changes invalidate affected earlier receipts. Never roll back to unsafe grants or generic multi-service directions. Final app rollback must preserve Saved IDs, compatible catalog/schema versions and withdrawal metadata.


## Exact external unblock actions

1. **Production staging:** Vercel CLI 65.12.1 is installed outside the repository
   at `/workspace/.rwn-tools/vercel-65.12.1/node_modules/.bin/vercel`; Node 24 is
   supported. `whoami --format json --non-interactive` reports `loggedIn:false`.
   Establish scoped authentication through the approved credential store or
   deliberate Vercel login, never by posting a token in chat. Verify project
   `prj_504G7M2lhnU5NlmfSAEyY4UdA4DX` / team `anlos`, then use the existing exact-SHA
   release gate and `--prod --skip-domain`. The connector's summaries omit domain
   auto-assignment/check fields and its create operation has no skip-domain input;
   an update acknowledgement is not independent proof. Test the production
   artifact before promotion, then check both public hosts. No general release
   permission needs to be requested again.
2. **Corrections/auth:** identify a real confirmed operator account, monitored
   queue, retention/abuse policy and approved test recipients. An authorized owner
   makes explicit reviewer assignments and configures scoped capability values in
   approved stores. Run real hosted role/auth/submission/publication acceptance;
   keep intake disabled until all pass. Never select the first signup or expose
   private reports in artifacts.
3. **Monitoring:** approve an owner, escalation owner, cadence and destination;
   test delivery/acknowledgement before enabling scheduled reporting. The new
   workflow may need default-branch registration before hosted dispatch.
4. **Source rights, backup and devices:** obtain the source-specific reuse
   decisions above; establish supported backup inventory/recovery evidence; run
   the documented journeys on actual iOS/VoiceOver, Android/TalkBack and Windows
   Edge when authorized devices are available. No service or plan purchase is
   required or authorized by this handoff.

## Safe maintenance and rollback

Preserve the 41 withheld records and all legacy IDs. Do not replay differently
named/timestamped migrations with a blind `db push`; compare the recorded mapping
and semantics. Never restore excessive grants or audit-sequence access. The
address-only constraint cannot be rolled back after publishing its records;
use a forward-compatible application/catalog. The correction schema is additive
and remains disabled; stop intake through both gates rather than deleting reports.

Use only a tested compatible application artifact that retains distinct service
destinations, Saved compatibility and withdrawal metadata. The old live generic
Bowery routing is not an acceptable safety rollback merely because it was live.
If a new release fails, hold promotion or forward-fix against the recorded source
and catalog; never reset main or erase newer editorial rows to force parity.
Regenerate pages/index/CSV/service-worker output from source and repeat affected
checks after any change. Detailed QA and provider captures stay in ignored/local
or access-controlled CI storage, never tracked build/dependency/dump output.
