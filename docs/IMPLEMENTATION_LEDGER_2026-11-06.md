# RWN implementation ledger — November 6, 2026

This is a bounded repair candidate, not a declaration that the master release acceptance is complete. Production, database restoration/migrations, merge and domain promotion remain unauthorized for this candidate. Screenshots, traces, downloaded provider HTML and logs stay outside source under `/tmp/rwn-evidence` and `/tmp/rwn-*.log` in this execution workspace.

## Starting point and source precedence

- Clean new checkout; no pre-existing user modifications. No `AGENTS.md` or supplied `RWN_Production_Audit_2026-11-06.md` found. Read README, CONTRIBUTING, quality/recovery/correction guidance, scripts and tests.
- Main is `3a2bc977e11d755a4b68bd156fadbc77bd53bd1b`. PR #97 remains open/draft at `574447c8463f0af7b901df8338d993b34e687a25`. Older overlapping PRs remain unmerged; no historical PR authorization is reused.
- Working branch `release/service-safety-20261106` descends directly from PR #97. Review the new PR against that branch; merge/reconcile #97 through the documented gate before retargeting and revalidate the resulting main candidate.
- Live www resolves to `dpl_AU7kzmhb258wa6nBeLEcdLUhrEs1`, project `prj_504G7M2lhnU5NlmfSAEyY4UdA4DX`, immutable URL `rwn-90ir4oado-anlos.vercel.app`. Baseline manifest reproduced byte-for-byte: release `0b2bd1f1b798`, offline `3a7a213f7929`, 1,992 records. Public deployment metadata identifies a CLI deployment and supplies no Git SHA; a manifest match plus prior release evidence supports the base, but is not a cryptographic attestation of the entire deployed backend.
- Current GitHub main reports `protected:false`; rulesets returned 403 requiring a plan/visibility change, which is not authorized. Branch protection read returned integration-permission 403. Vercel project/domain settings return 404 in connected account scope despite successful public-domain lookup: auto-assignment, ignoreCommand, deployment checks and admin bypass cannot be freshly certified. Preserve existing release controls; account enforcement remains a release blocker.

## Work packages

| ID / classification | Evidence and implementation | Verification / remaining dependency |
| --- | --- | --- |
| DIR-01 Reproduced; Implemented | Bowery official page still separates meals at 227 Bowery from overnight intake at 90 Lafayette. Stable `bowery-mission` ID retained. `src/utils/service-access.js`, finder/renderer, build/contact/SEO scripts and exports share reviewed service routes; invalid explicit routes fail closed. Intake opens provider details; only explicit walk-in destinations get directions. | Baseline generated-page regression fails on missing labels/actions; candidate targeted tests pass. Browser verification pending integration. Source review: `catalog-reviews/2026-11-06-service-access.json`. Original broad review date retained; individual route review dates are explicit. |
| DATA-01 Reproduced; Implemented | Older database rows could discard new route evidence while passing record-date checks. `scripts/catalog-sync-core.mjs` now refuses differing/missing source-reviewed service routes until explicitly reconciled. | Regression reproduced then passed. No hosted import/export or catalog count/ID changes. |
| AUTH-01 Reproduced; Implemented | Account export accepted a server-capped page as complete. `server/account-export.js` and account integration require complete counted pages and matching reads, reject partial/changing/duplicate/oversized responses, retain a bounded deadline. | Targeted tests and isolated SQL fixture results recorded at integration. Hosted auth/email/export acceptance Blocked on inactive backend and authorized test recipients. |
| DB-01 Already fixed locally; Blocked hosted | Preserve PR #97 anonymous/contributor grant restrictions and contact-only migrations dated `20261106045706`, `20261106052235`, `20261106052237`. Supabase `cytfrxldixdapjaxcqzf` is still INACTIVE; metadata SQL fails. Empty advisor response is not a pass. | Disposable PostgreSQL fixture passes. No hosted migration or restoration performed. Backup availability, existing hosted grants, recovery exposure and safe restoration prerequisites remain unverified. |
| FRESH-01 Implemented; proposed policy | Configurable risk scheduling and ranked review candidates are being integrated without changing publication status or substituting fetch dates for substantive review. | Operational approval of cadence/ownership still required; no staffing or response commitments invented. |
| RELEASE-01 Blocked | GitHub-first validation and existing pinned actions, locked versions, browser/SQL gates retained. Generated assets/dependencies stay ignored. | Exact candidate CI and local integration receipts required. No merge, production build, promotion or alias change authorized/performed. |

## Remaining master-prompt scope and exact dependencies

- **Corrections: Blocked / not launched.** Existing `CORRECTION_CHANNEL_HANDOFF.md` applies. A complete UI, durable private queue, duplicate/rate-limit behavior and reviewer flow are not implemented in this package. Operations must name the responsible owner and monitored destination; privacy owner must approve retention/access; engineering and operations must agree abuse handling and review status. Public submission remains disabled. These decisions do not block independent finder fixes.
- **Hosted recovery/auth: Blocked.** Owner must obtain/verify backup and recoverability evidence and assess pre-migration public API exposure, then authorize restoration and identified migration target. Separately authorize test recipients/account lifecycle tests. Do not restore first and assume old grants are safe.
- **Coverage/reuse: Intentionally deferred.** No batch published, no blanket licensing clearance inferred from historical PRs, and no records restored or removed. MA/RI/Baja depth, source-health change detection, source-fetch SSRF review and full import/license inventory need a separate reviewed work package.
- **Full search/localization/UX scope: Intentionally deferred.** Preserve current matcher, globe and prior cross-browser/offline repairs. A new 30-case evidence-backed relevance benchmark, complete Spanish core UI, unique-site reporting and all-surface polish are not claimed by this repair.
- **Monitoring: Blocked.** Field p75 LCP/INP/CLS are not measured here; no running monitoring or delivered alerts claimed. Owner/destination/retention and alert-delivery verification are still required. No tracking service or capacity claim added.
- **Devices: Blocked.** Real iPhone Safari/VoiceOver, Android/TalkBack and Edge/Windows need authorized devices/operators. Browser emulation and Playwright WebKit are not those checks.
- **Staging/production:** No production-environment artifact authorized. Existing preview may be used if available, but account-scope Vercel settings currently cannot be read. A preview with different environment values cannot certify production. An exact source/target approval and passing gates are required before production staging/promotion.

## Rollback and maintenance

Production is unchanged. Revert a repair commit in a new review branch if needed; preserve the PR #97 base and withheld-record protections. Never reset user work or restore unsafe database grants. No new hosted migration rollback is needed. Re-review a changed service route at its official source, update its individual evidence/date, reconcile editorial JSON deliberately, then regenerate and run all action/search/offline checks. Disconnected devices cannot receive immediate withdrawals; existing cache-version/retirement gates remain required.

## Integration evidence

To be finalized with exact candidate SHA, counts, browser/performance artifacts and PR state after integration. A documentation-only evidence commit following the tested implementation must be identified separately; no earlier tree is presented as certification of a later source change.
