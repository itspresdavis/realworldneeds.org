# Listing correction workflow and activation handoff

## Current state

**Implemented for review; public intake remains disabled and is not launched.** No operator, monitored destination, retention rule or abuse process has been approved in this work. No hosted migration, test report, notification, or activation has occurred. Missing ownership does not block independent finder fixes.

The public `/corrections` page shows honest unavailable/retry states. Its form becomes usable only after the server reports that both server and database activation gates are satisfied. Service-page links are separately source-controlled by `platformStatus.publicCorrectionLinksEnabled`, currently `false`. There is no live availability request in service handoff actions.

## Submission and review contract

- `GET /api/corrections` exposes only availability. With default configuration it returns `{enabled:false}` without contacting the backend.
- `POST /api/corrections` accepts a published `resourceId`, one category, an optional plain-text note of at most 1,000 characters, a UUID submission ID, and an optional empty bot-trap field. No account, email, exact location, attachments or personal account of hardship is requested. Only public listing identity is prefilled; listing name/source/date are derived from trusted catalog records.
- Categories are wrong address, wrong hours, closed service, disconnected phone, eligibility change, no longer free, duplicate and broken source. The earlier proposed open-ended “other” category is intentionally excluded.
- Requests require the approved same origin and bounded JSON. A dedicated server capability authorizes only intake/status RPCs. Daily HMAC actor keys derive from trusted platform client addresses; raw IPs are not stored by this queue. Actor/global quotas and idempotent receipts are atomic in the database. A public success response requires committed acceptance and never exposes a private report ID.
- Storage uncertainty shows a retry state. Retrying the same submission ID and payload cannot create another report; reusing an ID with changed content is rejected. Equivalent reports within a bounded window share a private review candidate.
- `GET/PATCH /api/correction-review` requires a remotely verified, confirmed user and current editor/admin database membership. Anonymous users and contributors cannot read reports, decision history, configuration, rate keys or receipts through tables or RPCs.
- Reviewer assignment is self/unassigned/unchanged; no staff list is invented. Priority and decisions require an expected revision and bounded reason. Ready, rejected and duplicate decisions also require an HTTPS evidence reference. All review text is rendered as text.
- **Ready means a reviewed candidate, not a published change.** No correction function edits the catalog. A source-backed catalog update must pass the existing editorial/publication gate separately. Role revocation and immutable decision history are checked directly in SQL.

The public page and endpoints are no-store/noindex. The service worker bypasses correction navigations and APIs. Browser form content is not saved to local storage or sent to analytics. Private account and editorial caching restrictions remain in place.

## Required decisions and approvals before activation

| Requirement | Exact owner action |
| --- | --- |
| Responsible operator and monitored destination | Name the responsible operations role/person in the operational record; establish actual monitoring of the workspace queue and acknowledge an authorized end-to-end test report. No notification delivery is claimed by this implementation. |
| Retention and access | Approve the period, access list and deletion procedure, including decision history and duplicate receipts. Publish matching privacy wording before intake opens. |
| Abuse handling | Approve actor/global hourly limits, escalation and incident handling. Verify trusted client-address behavior on the actual Vercel deployment. |
| Review process | Approve statuses, evidence requirements and handling of urgent unsafe destinations. Do not invent staffing or a response deadline. |
| Hosted recovery and migration | Establish backup/recoverability and pre-restoration API exposure first; obtain separate target/action authorization for restoring `cytfrxldixdapjaxcqzf`. Inventory actual migration history and authorize only missing migrations. Follow `CATALOG_RECOVERY.md`; inactivity is not a security pass. |
| Hosted acceptance | Verify real Data API persistence, direct grants/RPC denial, concurrent limits, auth/role revocation, failure/retry behavior and operator receipt using approved test data/accounts. Local simulated auth and mocked browser transport are not these checks. |
| Release activation | Approve the identified source/artifact and target. Update privacy, accessibility/transparency and correction-status wording in that artifact; approve the source-controlled listing-link flag. Revalidate the exact candidate before enabling server/database gates. |

## Prepared configuration, never committed secrets

Migration: `supabase/migrations/20261106203221_private_correction_queue.sql`, generated with pinned Supabase CLI 3.0.0. It adds private tables and narrowly scoped functions, starts disabled, and does not rewrite migration history or publish catalog facts.

Server variables (see `.env.example`):

- `RWN_CORRECTIONS_ENABLED=false` by default.
- `RWN_CORRECTIONS_INGEST_TOKEN`: dedicated random 43–128 character base64url capability, configured only through an approved secret store.
- `RWN_CORRECTIONS_APPROVAL_REF`: operational approval identifier; must match the private database configuration. Do not use personal information in the identifier.

The private singleton `rwn_private.correction_config` starts disabled with the other values NULL. Its approved configuration contains the capability's SHA-256 digest, matching approval reference, retention days, actor/global hourly limits and enabled state. Retention accepts 1–365 days; actor/global limits have bounded ranges. These ranges are implementation limits, not an approved policy. Never put the plaintext capability in source, chat, command output, evidence artifacts or a public client.

Environment activation alone cannot bypass the database gate; database activation alone cannot bypass the server gate. Reviewers cannot enable intake. Configuration changes are hosted mutations and require the identified target/action approval.

## Retention, outage and rollback

The owner-only `rwn_private.purge_corrections()` procedure is prepared; no schedule has been installed. Each call deletes at most 1,000 expired receipts, 1,000 decision events, 1,000 child-free reports and 1,000 expired rate buckets, returning each count separately. Restrictive foreign keys prevent cascading deletion. At most 1,000 expired parent rows are locked while their children are drained; a two-second lock timeout refuses contention. A parent with remaining children survives for another batch. Use the approved retention value, review all aggregate counts and repeat controlled batches only under the approved operating procedure. Set a suitable statement timeout in the operator transaction and inspect actual hosted indexes/volumes before rollout; local fixture timing does not establish hosted lock duration. Decision history cannot be altered by reviewers; deletion under the separately approved retention policy is an owner operation.

If storage is unavailable, public requests must not receive a success receipt. Keep the directory usable and the queue's outage state explicit. Do not copy reports into public logs or issue bodies to work around unavailable storage.

For an authorized emergency stop, disable both server and database intake gates through approved stores, retain the queue for review/retention, and keep service links disabled until recovery is verified. Do not drop tables, erase reports, restore unsafe grants or roll back service-direction safeguards. The additive private migration is compatible with prior source, which ignores these objects; prefer a reviewed forward fix.

## Verification and limits

`tests/corrections-api.test.js` exercises real handlers and the Supabase SDK with intercepted HTTP; UI fixtures test built pages with explicitly mocked transport. `supabase/tests/corrections.sql` and `scripts/qa-postgres-permissions.py` exercise persistent local PostgreSQL state, direct privileges, clean installation and upgrade, competing connections, review concurrency, publication separation and retention. These layers do not establish hosted operation or a monitored channel.

Record the exact candidate SHA, test counts, evidence and operational dependencies in `IMPLEMENTATION_LEDGER_2026-11-06.md` and the external verification receipt. Public submission stays disabled until every activation requirement above has been satisfied and authorized.
