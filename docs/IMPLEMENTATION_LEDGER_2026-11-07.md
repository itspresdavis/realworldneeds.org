# RWN access-quality release — implementation and evidence

Integration owner: root engineering agent. Working branch: `release/access-quality-20261107`.
Baseline: `bfd53f5ed88cf50cb987eaba2fac6fb6f867cd75`, preserving the cumulative PR #97–101 stack without duplicate cherry-picks. Unrelated worktrees are preserved. No `AGENTS.md` was found; `CONTRIBUTING.md`, README and existing runbooks apply.

## Current-state evidence

- Baseline inspection found PRs #97–101 open, draft and unmerged. This work is now in [PR #102](https://github.com/iamhuvr/RWN-WEB/pull/102), stacked on #101 without rewriting that history. Main remains `3a2bc977e11d755a4b68bd156fadbc77bd53bd1b`.
- Both public hosts still serve release `0b2bd1f1b798`, deployment `dpl_AU7kzmhb258wa6nBeLEcdLUhrEs1`. The public artifact has previously been reproduced from #97 (`574447c8`); the CLI deployment metadata does not expose a Git SHA, so exact backend source identity remains unproven.
- Existing preview `dpl_FFDjiLQyCscEb2FS8Y7AXPcZ3MXx`, https://rwn-28866oid8-anlos.vercel.app, identifies `bfd53f5e` and serves release `a8555440c322`. Fresh sampled homepage/Bowery/locality hashes match the baseline build.
- Supabase `cytfrxldixdapjaxcqzf` now reports `ACTIVE_HEALTHY`, PostgreSQL 17.6.1.155. The previous inactive state is historical. Recovery was not performed by this work; its cause and recovery/backup history remain unverified.
- Baseline bounded hosted aggregates were 2,033 catalog rows, 1,992 published and zero `rwn_members`. Post-repair read-only verification found exactly 2,038 rows: 1,997 published and all 41 withheld records retained; memberships and correction reports remain zero. Anonymous table-wide SELECT and anonymous/authenticated `editorial_note` SELECT are denied. November 7 hosted migrations apply the three historical November 6 restrictions under different timestamps; do not reapply by filename. Correction tables were absent at baseline; subsequent applied changes are recorded below. Other unrelated hosted tables are out of scope.
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
| 3 | Typed validated route facts/actions, exact address-only destinations, stable IDs; top contact/service choice followed by route facts and directions; `service-access.js`, `resource-location.js`, `service-before-you-go.mjs`, shared contact and CSV generators | Bowery distinct addresses, invalid/legacy/confidential/contact routes, all exports, Saved/copy/print and labeled copied URLs; 15 focused three-engine journeys, native contact/facts/print/no-JS checks | **Implemented / verified locally.** Final integrated release evidence remains distinct |
| 4 | Need/place/time/food intent; explicit bounded postal areas; cancellation of stale device location; per-pass intent plan; passive refresh preserves Back/reload/Saved focus ownership; `search*.js`, directory/app | Deterministic catalog-based relevance, original/urgent/Spanish/ZIP/ambiguity/empty cases, delayed responses; unchanged native history journey and 27 Saved Browse cases | **Implemented / verified locally.** Postal reference is limited documented US coverage, never an automatic country/radius guess |
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
| 12d | Bounded private-safe telemetry; no fake INP/CLS labels; gated public catalog-health workflow | Request/privacy tests, 27 operations-report checks, local reports and successful read-only GitHub dispatch; 619 proposed review candidates, 152 high priority at November 7 | **Implemented / report verified locally and on GitHub. Operational monitoring blocked:** owner/escalation approval and tested alert delivery |
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

Integrated source `a2eeca4f` passed 1,833 Node tests (zero failures/skips), all
2,894 reproducible output hashes and the hosted PostgreSQL job. Its exact-source
Quality run `42349191727` was **failed**, not a release receipt: native copying
lost a legacy coverage line, all three engines identified an unnamed-role ARIA
group, and native coordinate QA had not classified address-only records. Repairs
preserve the original copy and accessibility assertions; the coordinate audit now
also rejects invented address-only points and verifies real search retention.
The existing contact-only browser fixture passed all 47 cases after repair.
A separate catalog-workflow context error and renamed menu-evidence variable
were corrected. All six jobs must pass again on the resulting candidate.

At `6258d060`, the complete local check passed **1,843 tests / zero failures /
zero skips** and reproduced all 2,894 output hashes. Exact-source run
`42349710133` passed SQL and Chromium (68), Firefox (63, five WebGL capability
skips) and WebKit (67, one capability skip). Its two native jobs remained failed:
the mobile seasonal-feed fixture assumed immediate offscreen globe loading, and
the new controls buried the primary action at 320px. The fixture now reveals the
globe through trusted scrolling while retaining geometry/country assertions;
desktop/mobile seasonal-feed, chaos and deep-globe checks passed separately.
The mobile layout fix preserves all controls and 44px targets: measured English
search/action bottoms improve from 413/690px to 290/450px; Spanish measures
377/536px with its scope notice visible. Component tests pass 38 Node and 12
three-engine journeys; later service-page gates remain distinct from that result.

The read-only catalog report was **verified on GitHub**, run `42349712347`,
artifact `13564913775`: exact source `6258d060`, structural pass and canonical
catalog hash `f24285108fc754820ffbc87d614abecea05952e3213b0b36bc86254b18166a12`.
No source links were fetched, public facts changed or operator alert sent.
Scheduled monitoring remains disabled and operationally incomplete.

Integrated `1a8871f7` passed 1,845 Node tests and reproducibility, SQL and all
three CI browser jobs, but its native gates remained failed. A passive intent
refresh incorrectly canceled directory Back/Saved restoration; the source fix
preserves the snapshot until real visitor input. The inspector fixture now
checks complete copied multi-service facts, while retaining legacy copy tests.
The keyboard-skip fixture now measures the native fragment destination from
pre-input geometry instead of assuming document-top zero after the new language
row. It still requires immediate focus/hash/position and header clearance before
settling; bad-position and delayed-arrival controls remain failures. Independent
asset-upgrade, Saved, chaos, offline and cache-upgrade executables passed on
`1a8871f7`; none is relabeled as certifying the later integrated commit.

At `4a3d99b2`, 1,847 Node tests passed without skips and all 2,894 output hashes
reproduced. Exact-source run `42352573095` and PR run `42352577709` remained
failed. The PR browsers exposed a 56px Saved-return shift caused by an unintended
hero-padding transition; the narrow layout fix passed 51 focused journeys across
all three engines and the unchanged native directory/27 Saved cases. Inspector
readiness and Bowery action checks now observe the rendered listing and require
both reviewed destinations plus three official detail links; the full
institutional executable passed independently with those QA repairs.

The native touch failure was separately reproduced during cold Back navigation:
a live capability-probe context preceded the first rendered zoom readout. The
existing bounded Back wait now requires the restored query and ready renderer;
all gesture, zoom-response and real context-recovery assertions remain. The full
repaired journey passed on the original Chromium 159 version. Native CI now pins
the independently reviewed/tested stable Chrome 157.0.8103.38 instead of an
unversioned snapshot; this runtime choice does not erase the earlier failure.
Deep-globe and copy/share/print executables separately passed on `9d05028f`.
The final integrated run must certify the resulting source again.

Generated-page navigation now explicitly uses six-pixel row spacing and a narrow
viewport width bound. This preserves 50px targets and focus outlines while fixing
short-screen clipping and the desktop-scrollbar overflow. The reviewed seven-link
QA contract is shared across return/reflow/dismissal fixtures, with missing,
duplicate and inaccessible-link negatives. Targeted evidence passed 170 Node,
15 persisted Back, 33 reflow, 15 dismissal and 30 Spanish keyboard/ring cases;
screenshots were inspected. The existing Saved/chaos executables now begin the
second native CI job to balance the expanded service journeys: all nine scripts,
their combined order, both 24-minute deadlines and six required names remain.

A bounded read-only security review additionally compared seven deployed
correction function-body hashes to source, with all matching, fixed search paths,
zero private client table grants and intake still disabled. It found no
reproduced blocking defect within that scope; hosted auth and operator acceptance
remain separate incomplete requirements.

At `33d49153`, local validation passed 1,868 tests and reproduced all 2,894 files.
Exact-source run `42354841437` passed five required jobs but failed WebKit;
PR run `42354845921` also exposed an early-edit viewport race during slow reload.
The WebKit trace showed a worker controller change starting a new catalog fetch
from a departing document. Directory, Saved and offline fallback now cancel work
on pagehide and recover on pageshow. The controlled pre-fix failure is retained;
the repair passed 1,871 Node tests and 119 browser/upgrade cases, with four
explicit graphics capability skips. No CORS or error assertions were relaxed.
The early-edit viewport failure had two causes: a delayed native history restore
and smooth movement already pending when typing began. The repair owns native
restoration during the early edit, preserves the original visible-input motion
cancellation, and restores the prior mode before ordinary navigation or departure.
Cancelled links, downloads and new-tab actions retain ownership. The smaller
manual-only candidate failed the unchanged native journey and is retained as
failed evidence. The combined fix passed the full desktop/mobile startup helper
at fourfold CPU slowdown, both with and without passive tracing, plus 15/15
independent Chromium/Firefox/WebKit history cases and 83 focused Node tests.
Before/after images were inspected. The necessary startup cost is 367 raw / 171
gzip bytes, with no added request; the narrow served-file limits are documented
in the performance report and aggregate runtime limits remain unchanged. These
component passes do not certify a new integrated release: all six Quality jobs
and the hosted candidate checks must pass on the resulting exact source.

Integrated `fa8546f8` passed a clean locked installation, 1,874 Node tests,
all 2,894 reproducible files, 109 release-tool checks and a zero-vulnerability
dependency audit. Its exact-source SQL, three-engine (210 passed / six explicit
graphics capability skips) and native offline/globe jobs passed. Final screenshot
review then found homepage emergency copy incorrectly defining RWN itself as a
directory. The English/Spanish correction now refers to this directory program;
the earlier results remain evidence for their exact source, and the resulting
candidate requires a fresh complete release run.

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
   test delivery/acknowledgement before enabling scheduled reporting. Manual
   branch dispatch is verified; scheduled operation also needs the reviewed
   workflow on the default branch and all explicit owner gates configured.
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
