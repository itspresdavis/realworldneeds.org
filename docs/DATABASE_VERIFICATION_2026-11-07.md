# RWN database verification — November 7, 2026

Target: `cytfrxldixdapjaxcqzf`, Realworldneeds Org. The current control plane reports **ACTIVE_HEALTHY**, PostgreSQL 17.6.1.155. Earlier INACTIVE evidence is historical. This engineering package did not resume the database; who resumed it, the earlier pause cause, and backup inventory are not established by these checks.

## Bounded hosted results

- Exact SQL aggregates: **2,033** catalog rows, **1,992** published rows, **0** reviewer memberships (including editors/admins). No private record bodies were extracted.
- Anonymous and authenticated roles cannot SELECT `editorial_note` or select the catalog with `*`. Public column allowlists and published-row policies are present.
- Hosted migration names establish that anonymous/contributor column restrictions and contact-only support have already been applied under **different timestamps** than their repository files. Do not apply them twice by filename or rewrite their history.
- Actual anonymous Data API requests used the published client key and `limit=0`: public ID selection returned HTTP 206 with `Content-Range: */1992`; withheld selection returned HTTP 200 with `*/0`; editorial-column, wildcard, membership, history and review selections returned HTTP 401. No private error bodies were read. Seven bounded requests, zero extracted rows. Node's non-proxy HTTP path initially failed before upstream; the supported proxy-aware HTTP client succeeded. Connectivity failure was not misreported as database failure.
- A read-only SQL transaction with the `authenticated` role and transaction-local synthetic nonmember claims could read published IDs but no private memberships/reviews/history/account requests. A user-editable `user_metadata.role=admin` did not grant editor status. Sensitive columns/wildcard reads were denied. No user or membership was created. This checks hosted SQL policy behavior, **not sign-in or token issuance**.
- Security advisors returned informational unrelated-table “RLS enabled, no policy” findings. Those are neither authorization failures nor proof that RWN security is complete; unrelated application schemas were left untouched.

## Reproduced and repaired grant defect

Historical hosted defaults granted `anon` and `authenticated` broad maintenance rights on RWN private tables and their audit sequence. The earlier maintenance repair covered only `rwn_locations`. RLS does not protect TRUNCATE or sequence mutation. Read-only ACL checks established those rights; no destructive hosted probe was run.

`20261107055114_restrict_rwn_private_table_privileges.sql` removes anonymous private-table grants, keeps only documented authenticated SELECT / SELECT+INSERT rights, removes audit-sequence access and catalog maintenance rights, and preserves owner audit triggers, existing RLS and service-role maintenance. It touches only the five named RWN tables and the RWN audit sequence. It neither deletes rows nor assigns roles.

- SQL SHA-256: `6a75a274ed6e2eefdcdcc35d8051cc3c1ea01a5998010a66d714f60a89487628` (content identity, not a signature).
- Implemented commit: `639f129e`.
- Verified in a clean detached worktree using PostgreSQL **17.11**. The fixture first reproduced anonymous truncation on isolated synthetic history under the hosted-style broad defaults, then proved maintenance/sequence denial, contributor isolation, legitimate editor CRUD/audit, clean installation and upgrade. The local fixture is not a hosted backup/restore test.
- Applied by the integration owner through the supported hosted migration tool under existing repair authorization. Hosted version: **20261107055509**, name `restrict_rwn_private_table_privileges`. Postflight counts remained 2,033 / 1,992 / 0; unsafe private-table maintenance grants became zero, sequence UPDATE false, legitimate contributor review INSERT true. Record this mapping before any future migration synchronization.

## Migration mapping and release boundary

| Repository migration | Observed hosted version | State |
| --- | --- | --- |
| 20261106045706_restrict_anonymous_catalog_columns | 20261107044429 | Applied; column-denial behavior verified |
| 20261106052235_restrict_contributor_catalog_columns | 20261107044434 | Applied; column-denial behavior verified |
| 20261106052237_support_contact_only_catalog | 20261107044440 | Applied; hosted contract present |
| Earlier catalog-only maintenance restriction, not in this source history | 20261107044447 | Applied; new repair preserves its restrictions |
| 20261107055114_restrict_rwn_private_table_privileges | 20261107055509 | Applied; aggregate/privilege postflight verified |
| 20261106203221_private_correction_queue | None observed | Prepared; disabled by default |
| 20261107053912_correction_workflow_details | None observed | Prepared; apply only after base queue migration |
| 20261107053913_address_only_service_locations | None observed | Prepared; forward extension, no row changes |

Names, semantics and definitions must be reconciled with hosted history; `db push` across the differently timestamped historical migrations is not an appropriate blind deployment. The additive queue migrations preserve existing data and start disabled. The address constraint replacement runs atomically with a two-second lock timeout and validates existing rows; check active locks and current constraint before hosted application. It keeps coordinate requirements for mapped records and permits source-backed direct addresses without made-up coordinates.

## Remaining checks and rollback

Hosted sign-in/out, confirmation, recovery, expired/revoked sessions, authorized reviewer use and end-to-end correction persistence remain incomplete: no approved test recipients/accounts or operational reviewer were established. Zero memberships is a blocker to activating review, not permission to appoint the first signup. Correction intake remains unavailable until ownership, monitored queue, retention, abuse procedure, scoped server capability and hosted acceptance are confirmed.

Backup metadata/recovery drill remains unverified. No restore, dump extraction, account deletion or hosted test report was performed in this work package. Current static public facts and editorial catalog still require complete revision/hash reconciliation before publication of new source facts.

Rollback should stop correction intake through its existing gates and roll application source forward to a compatible repair. Do not restore broad grants or audit-sequence privileges. Queue additions are backward-compatible with old application code, which ignores them. Address-only records require a compatible application/catalog export; do not restore the old coordinate constraint after adding such records. Preserve Saved IDs and approved service destinations when choosing an application artifact.
