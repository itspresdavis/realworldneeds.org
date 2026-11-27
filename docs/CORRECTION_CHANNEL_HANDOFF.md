# Listing correction workflow and activation handoff

## Current state

**Implemented for review; public intake remains disabled and is not launched.** No operator, monitored destination, retention rule or abuse process has been approved in this work. The hosted queue schema is applied and anonymous/nonmember denial checks are verified; no hosted test report, notification, or activation has occurred. The backend is healthy; see DATABASE_VERIFICATION_2026-11-07.md for catalog reconciliation, permission repairs and exact migration mappings. Missing ownership does not block independent finder fixes.

The public `/corrections` page shows honest unavailable/retry states. Its form becomes usable only after the server reports that both server and database activation gates are satisfied. Service-page links are separately source-controlled by `platformStatus.publicCorrectionLinksEnabled`, currently `false`. There is no live availability request in service handoff actions.

## Submission and review contract

- `GET /api/corrections` exposes only availability. With default configuration it returns `{enabled:false}` without contacting the backend.
- `POST /api/corrections` accepts a published `resourceId`, one category, an optional plain-text description of at most 1,000 characters, a UUID submission ID, and an optional empty bot-trap field. Optional fields are a validated service route ID, a proposed correction (1,000 characters), an HTTPS source reference (2,048 characters), and a reply email (254 characters). An email is never required; it remains private and does not promise a reply. No account, exact location, attachments or hardship account is requested. Only public listing/service identity is prefilled; source/name/date and original public record are snapshotted from the authoritative catalog. URL query text cannot prefill a description or contact.
- Categories are wrong address, wrong hours, closed service, disconnected phone, eligibility change, no longer free, duplicate and broken source. The open-ended “other” category is excluded. Website accessibility reports use only the dedicated `rwn-website` identity and `accessibility` category, accessible at `/corrections?resourceId=rwn-website`; they never masquerade as provider records. Their source-code fixes still require a separate reviewed release.
- Requests require the approved same origin and bounded JSON. A dedicated server capability authorizes only intake/status RPCs. Daily HMAC actor keys derive from trusted platform client addresses; raw IPs are not stored by this queue. Actor/global quotas and idempotent receipts are atomic in the database. A public success response requires committed acceptance and never exposes a private report ID.
- Storage uncertainty shows a retry state. Retrying the same submission ID and payload cannot create another report; reusing an ID with changed content is rejected. Equivalent reports within a bounded window share a private review candidate. New optional fields participate in the retry fingerprint; different reply contacts are never collapsed into one report. Legacy empty-detail fingerprints remain compatible across upgrade.
- `GET/PATCH/POST /api/correction-review` requires a remotely verified, confirmed user and current editor/admin database membership. Anonymous users and contributors cannot read reports, decision history, configuration, rate keys or receipts through tables or RPCs.
- Reviewer assignment is self/unassigned/unchanged; no staff list is invented. Priority and decisions require an expected revision and bounded reason. Ready, rejected and duplicate decisions also require an HTTPS evidence reference. All review text is rendered as text.
- **Ready means a reviewed candidate, not a published change.** A separate explicit apply action accepts independently reviewed summary, hours, phone or eligibility text. It never copies the report proposal automatically, changes the broad review date, or publishes the static site. Service-specific hours/eligibility and route changes require the full catalog/source review; generic overwrites are rejected. The apply transaction checks both report and catalog revisions, updates the authoritative catalog and immutable audit history, records original/new values, and moves ready → applied atomically. A lost response can retry the exact action without duplicate catalog edits. The publication gate then exports/reviews/builds/releases the snapshot. An explicit verification action fetches only the fixed production manifest and catalog, with deadlines, byte limits, no credentials or redirects, and stable before/after release identity. It marks resolved only when the complete deployed public record equals the applied record and current catalog. A failure leaves applied unchanged for a safe retry. The resolve RPC requires the private server capability and a currently confirmed editor; reviewers cannot supply an arbitrary URL or forge a release through their client RPC. Role revocation and immutable decision history are checked directly in SQL.

The public page and endpoints are no-store/noindex. The service worker bypasses correction navigations and APIs. Browser form content is not saved to local storage or sent to analytics. Private account and editorial caching restrictions remain in place.

## Required decisions and approvals before activation

| Requirement | Exact owner action |
| --- | --- |
| Responsible operator and monitored destination | Name the responsible operations role/person in the operational record; establish actual monitoring of the workspace queue and acknowledge an authorized end-to-end test report. No notification delivery is claimed by this implementation. |
| Retention and access | Approve the period, access list and deletion procedure, including decision history and duplicate receipts. Publish matching privacy wording before intake opens. |
| Abuse handling | Approve actor/global hourly limits, escalation and incident handling. Verify trusted client-address behavior on the actual Vercel deployment. |
| Review process | Approve statuses, evidence requirements and handling of urgent unsafe destinations. Do not invent staffing or a response deadline. |
| Hosted migration and compatibility | The existing target is ACTIVE_HEALTHY. Compare actual migration history/definitions with DATABASE_VERIFICATION_2026-11-07.md; do not repeat security fixes under their older local timestamps. Apply only missing reviewed additive correction migrations under the existing repair scope after exact preflight. No restoration or arbitrary reviewer grant is needed. |
| Hosted acceptance | Verify real Data API persistence, direct grants/RPC denial, concurrent limits, auth/role revocation, failure/retry behavior and operator receipt using approved test data/accounts. Local simulated auth and mocked browser transport are not these checks. |
| Release activation | Approve the identified source/artifact and target. Update privacy, accessibility/transparency and correction-status wording in that artifact; approve the source-controlled listing-link flag. Revalidate the exact candidate before enabling server/database gates. |

## Prepared configuration, never committed secrets

Migrations: `supabase/migrations/20261106203221_private_correction_queue.sql`, then `20261107053912_correction_workflow_details.sql`, generated with pinned Supabase CLI 3.0.0. It adds private tables and narrowly scoped functions, starts disabled, and does not rewrite migration history or publish catalog facts.

Server variables (see `.env.example`):

- `RWN_CORRECTIONS_ENABLED=false` by default.
- `RWN_CORRECTIONS_INGEST_TOKEN`: dedicated random 43–128 character base64url capability, configured only through an approved secret store.
- `RWN_CORRECTIONS_APPROVAL_REF`: operational approval identifier; must match the private database configuration. Do not use personal information in the identifier.

The private singleton `rwn_private.correction_config` starts disabled with the other values NULL. Its approved configuration contains the capability's SHA-256 digest, matching approval reference, retention days, actor/global hourly limits and enabled state. Retention accepts 1–365 days; actor/global limits have bounded ranges. These ranges are implementation limits, not an approved policy. Never put the plaintext capability in source, chat, command output, evidence artifacts or a public client.

Environment activation alone cannot bypass the database gate; database activation alone cannot bypass the server gate. Reviewers cannot enable intake. Configuration changes are hosted mutations and require the identified target/action approval.

## Retention, outage and rollback

The owner-only `rwn_private.purge_corrections()` procedure is prepared; no schedule has been installed. Each call deletes at most 1,000 expired receipts, 1,000 decision events, 1,000 child-free reports and 1,000 expired rate buckets, returning each count separately. Restrictive foreign keys prevent cascading deletion. At most 1,000 expired parent rows are locked while their children are drained; a two-second lock timeout refuses contention. A parent with remaining children survives for another batch. Use the approved retention value, review all aggregate counts and repeat controlled batches only under the approved operating procedure. Set a suitable statement timeout in the operator transaction and inspect actual hosted indexes/volumes before rollout; local fixture timing does not establish hosted lock duration. Decision history cannot be altered by reviewers; deletion under the separately approved retention policy is an owner operation.

If storage is unavailable, public requests must not receive a success receipt. Keep the directory usable and the queue's outage state explicit. Do not copy reports into public logs or issue bodies to work around unavailable storage.

Publication verification for already-reviewed reports may continue with the valid approved server capability while public intake is disabled; no intake switch is required to resolve an existing report. Clearing/rotating that capability also stops verification. For an authorized emergency stop, disable both server and database intake gates through approved stores, retain the queue for review/retention, and keep service links disabled until recovery is verified. Do not drop tables, erase reports, restore unsafe grants or roll back service-direction safeguards. The additive private migration is compatible with prior source, which ignores these objects; prefer a reviewed forward fix.

## Verification and limits

`tests/corrections-api.test.js` exercises real handlers and the Supabase SDK with intercepted HTTP; UI fixtures test built pages with explicitly mocked transport. `supabase/tests/corrections.sql` and `scripts/qa-postgres-permissions.py` exercise persistent local PostgreSQL state, direct privileges, clean installation and upgrade, competing connections, review concurrency, publication separation and retention. These layers do not establish hosted operation or a monitored channel.

Record the exact candidate SHA, test counts, evidence and operational dependencies in `IMPLEMENTATION_LEDGER_2026-11-06.md` and the external verification receipt. Public submission stays disabled until every activation requirement above has been satisfied and authorized.

## Explicit workflow transitions and interfaces

- New (`open`) → in-review, ready, rejected or duplicate; existing status/assignment changes require a current revision and a bounded reason.
- Rejected or duplicate → in-review before another decision. Reopening is explicit and auditable.
- Ready → applied only through the catalog-application transaction. Ready/rejected/duplicate decisions require source evidence. Applied/resolved cannot be forged through the general review PATCH.
- Applied → resolved only through server-verified production output. The stable release manifest must include `catalogSha256` matching the exact fetched catalog bytes before parsing; a stale or mixed catalog cannot finalize publication. This unsigned integrity hash is not an attestation. A newer catalog revision, missing/changed public record, unstable or older incompatible manifest, network failure or revoked membership prevents completion. A failed publication can be retried without another catalog write.
- Accessibility reports remain review candidates for a source-code change; this bounded catalog apply action does not edit website code. Record a source-review decision and link the actual code/release through the existing engineering workflow. Do not label a website fix published merely because a report is ready.

The English/Spanish interface uses `public/correction-localization.js` and the shared locale preference. Language changes preserve entered values, current revision, selected service and retry identity. Provider and submitted text remains original; it is not automatically translated. Public intake never writes drafts or reply email into browser storage. Original/new catalog snapshots and reply contacts remain private and are removed with their report by the approved retention procedure. The actual retention period and a monitored operator are still unapproved; code limits do not establish policy.

The UI transport fixtures are explicitly isolated simulations. Real PostgreSQL tests verify durable submission, retry, private-field boundaries, transitions, role denial, catalog CAS, audit behavior and finalizer capability separately. Rendered Chromium/Firefox/WebKit tests do not establish hosted login, email delivery or operator monitoring. Keep those states separate in release evidence.

Correction application preserves earlier private editorial notes in full. It appends the new reason only when the combined note fits the existing 1,000-character constraint; the complete reason and evidence always remain in the immutable correction event. A full earlier note is never truncated to make a new change fit.
