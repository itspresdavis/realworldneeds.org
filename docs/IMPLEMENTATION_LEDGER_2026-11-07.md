# RWN access-quality release — implementation and evidence

Integration owner: root engineering agent. Working branch: `release/access-quality-20261107`.
Baseline: `bfd53f5ed88cf50cb987eaba2fac6fb6f867cd75`, preserving the cumulative PR #97–101 stack without duplicate cherry-picks. Unrelated worktrees are preserved. No `AGENTS.md` was found; `CONTRIBUTING.md`, README and existing runbooks apply.

## Current-state evidence

- PRs #97–101 remain open, draft and unmerged; no newer PR was returned by the current repository search. Main remains `3a2bc977e11d755a4b68bd156fadbc77bd53bd1b`.
- Both public hosts still serve release `0b2bd1f1b798`, deployment `dpl_AU7kzmhb258wa6nBeLEcdLUhrEs1`. The public artifact has previously been reproduced from #97 (`574447c8`); the CLI deployment metadata does not expose a Git SHA, so exact backend source identity remains unproven.
- Existing preview `dpl_FFDjiLQyCscEb2FS8Y7AXPcZ3MXx`, https://rwn-28866oid8-anlos.vercel.app, identifies `bfd53f5e` and serves release `a8555440c322`. Fresh sampled homepage/Bowery/locality hashes match the baseline build.
- Supabase `cytfrxldixdapjaxcqzf` now reports `ACTIVE_HEALTHY`, PostgreSQL 17.6.1.155. The previous inactive state is historical. Recovery was not performed by this work; its cause and recovery/backup history remain unverified.
- Bounded hosted aggregates: 2,033 catalog rows, 1,992 published, zero `rwn_members`. Anonymous table-wide SELECT and anonymous/authenticated `editorial_note` SELECT are denied. November 7 hosted migrations apply the three historical November 6 restrictions under different timestamps; do not reapply by filename. Correction tables are absent. Other unrelated hosted tables are out of scope.
- Main protection is not enforced. Ruleset inspection is plan/visibility blocked; protection inspection is integration-permission blocked. Vercel project responses omit the automatic-domain-assignment setting; an earlier update acknowledgement is not independent enforcement evidence.
- Runtime: Node 24.22.1, npm 11.9.0, locked dependencies. Browser-control tool is absent despite listed skill; this assignment explicitly permits Playwright. Physical-device/assistive-technology evidence remains unavailable.

Detailed logs, provider captures, screenshots and measurements are kept outside tracked source in `/workspace/rwn-release-evidence/access-quality-20261107/`.

## Requirement checklist

Status `blocked` means incomplete, including work currently awaiting implementation or final verification. Local fixture evidence, hosted verification, staging and production are recorded separately.

| ID / requirement | Implementation owner and affected area | Evidence/tests required | Status / remaining dependency |
| --- | --- | --- | --- |
| 1–2 instructions, source reconciliation, canonical pipeline | Root; README, release docs, generators | Ancestry, remote PR/deployment reads, clean install, baseline | Verified baseline; final reconciliation blocked pending candidate |
| 3 service/site/destination contracts and all representations | Access agent + root generator integration | Bowery, legacy, invalid/missing coords, multi-route, Saved/copy/print/CSV/cache | Blocked: extension and final integrated verification underway |
| 4 need/place/time intent, postal/ambiguity, food ranking | Search agent | Deterministic relevance and real homepage/directory interactions, async/navigation/offline | Blocked: implementation underway |
| 5 schedules/intake/eligibility/provenance and review priorities | Access + coverage agents | Beacon official evidence; timezone/overnight/DST/unknown clocks; completeness report | Blocked: implementation underway |
| 6 public correction intake persistence, validation, retry | Database agent | Real isolated SQL and API/browser fixtures, privacy, denied roles | Blocked: richer workflow and hosted testing underway |
| 6 private decisions, concurrency and publication handoff | Database agent | Actor/revision/field evidence, rejection, conflict, publication failure/retry | Blocked: implementation underway |
| 6 operational correction/accessibility activation | Database agent; operational owner required | Actual authorized reviewer, monitored destination, retention/abuse decision, hosted receipt | Blocked: zero memberships and no verified operator/config; keep intake disabled |
| 7 verified additions, cost/reuse/source evidence, dedup | Coverage agent | Reviewed bounded tranche, deterministic reports/import validation, before/after counts | Blocked: verification and implementation underway |
| 7 priority communities and residual gaps | Coverage agent | Boston/Brockton/Taunton/Providence/Rosarito/Tijuana matrix by need and scope | Blocked: no exhaustive coverage claim |
| 8 mobile essential facts, reflow/focus/brand | UX agent | Rosie/Bridge restrictions, 320/390/768/desktop, keyboard, zoom, inspected images | Blocked: reproduced hidden access text; fix underway |
| 9 related locality/catchment and country-placeholder SEO | Root | Behavior fixtures, generated canonicals/breadcrumbs/sitemap/redirects, staged routing | Blocked: reproduced misleading country-as-city and distant related results |
| 10 About/Our work/Get involved/Contact/Transparency | Root | Truthful repository-approved facts, working links, no unsupported operations | Blocked: implementation underway; operator/contact facts cannot be invented |
| 11 coherent English/Spanish and non-phone access | UX/access agents + root integration | Central locale fallback, task preservation, provider-language disclosure, date/time/actions | Blocked: implementation underway; provider prose only translated when reviewed |
| 12 migrations/privacy/auth/export/cache reliability | Database/access/search agents | Full existing suite plus new SQL/upgrade/privacy cases | Blocked: exact final candidate required; historical passes retained |
| 12 performance and operational reporting | QA + coverage agents/root | Identical repeated cold/warm/search/map runs; aggregate-only diagnostics; failure reports | Blocked: before measurement underway; real alert owner/delivery unavailable |
| 13 browser/accessibility/integration matrix | QA + integration owner | Chromium/Firefox/WebKit, axe, screenshots, error/network checks | Blocked: exact final candidate required; actual mobile/AT unavailable |
| 14 reviewable PR, immutable build/preview, release gate | Root | Final SHA/lock/catalog/schema/release identity, required CI, exact hosted preview, rollback | Blocked: final candidate and production domain safeguard verification pending |
| 15 final deliverables and continuation | Root | This checklist, source report, operational handoff, tests and honest limits | Blocked until integration completes |

## Ownership and integration

Independent worktrees start at the same baseline. Search owns matcher/app search/directory/index; access owns service-action/schedule/location contracts; coverage owns reviewed source records/reports; UX owns styles/shared locale/Saved presentation; database owns correction APIs/UI/migrations; QA retains external baseline/verification evidence. Root owns shared build/static content/locality/SEO, integrates commits and resolves shared contracts. No concurrent edits to shared files are authorized without coordination.

## Release and recovery boundaries

The user's earlier instruction authorizes repair and deployment. No further general permission request is needed for that scope. Operationally incomplete corrections stay disabled; no reviewer is appointed, production test data inserted, paid service purchased or destructive migration performed. Source changes invalidate affected earlier receipts. Never roll back to unsafe grants or generic multi-service directions. Final app rollback must preserve Saved IDs, compatible catalog/schema versions and withdrawal metadata.
