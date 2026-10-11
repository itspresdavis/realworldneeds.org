# Authentication and catalog architecture

The existing static site remains the public delivery system. Supabase is the editorial database and identity provider. Vercel functions enforce account routes and use a user-scoped Supabase client; no service-role credential is required by the deployed app.

## Request flow

`/join` submits same-origin JSON to `/api/account`. Supabase Auth issues a session stored in HTTP-only, SameSite=Lax cookies (Secure in production). The browser never receives tokens in an API payload or localStorage. Email confirmation and password recovery use PKCE and the exact callback route. The callback never accepts an arbitrary next URL.

`/workspace` rewrites to `/api/workspace`. Before serving its private HTML, the handler remotely verifies the user with `getUser`, rejects anonymous or unverified identities, and disables caching. `/api/catalog` repeats user verification and queries through that user's session. The service worker explicitly excludes account and workspace routes.

Every write requires the configured exact Origin and JSON content type. Bodies and fields are bounded. Supabase handles password checks and Auth rate limits; application errors avoid disclosing whether an email exists. Network calls have timeouts and private responses use `no-store`.

## Tables and permission model

| Table                  | Public visitor       | Contributor                      | Editor                                                     |
| ---------------------- | -------------------- | -------------------------------- | ---------------------------------------------------------- |
| `rwn_locations`        | Read published facts | Read published facts             | Read all; create/update/withhold/delete under RLS          |
| `rwn_members`          | None                 | Read own membership              | Read own membership; grants require project administration |
| `rwn_reviews`          | None                 | Insert/read own notes            | Read notes for editorial review                            |
| `rwn_location_history` | None                 | None                             | Read immutable change evidence                             |
| `rwn_account_requests` | None                 | Insert/read own deletion request | Read administrator worklist                                |

Private editor invitations cannot be read or written by client roles. The activation trigger checks a trusted verified email and consumes a single invitation. Membership is looked up from the database, so removing a role takes effect on the next query rather than waiting for a JWT claim refresh.

`rwn_locations.record` preserves the complete existing source record. Generated columns expose the most useful review fields without duplicating editable state. Constraints protect record identity, coordinate ranges, HTTPS source attribution, listing kind, service arrays, and review dates. B-tree indexes cover country, review date, stable pagination, ownership and history; a trigram index supports bounded name/place searches.

The API allows only an explicit set of editorial fields. Its update predicate includes the original `updated_at` value. A concurrent change returns 409 instead of silently overwriting another review. An AFTER trigger captures complete generated fields in immutable before/after JSON; a separate BEFORE trigger assigns a fresh revision timestamp.

## Reproducible database operations

Apply the committed migrations in order. `npm run catalog:seed` prepares 100-row SQL batches under ignored `supabase/import/`. The bootstrap importer uses `ON CONFLICT DO NOTHING`; rerunning it never overwrites editorial changes.

`npm run catalog:verify` compares a canonical SHA-256 digest of every published database record with the exact site snapshot, including all nested fields. Reads require exact server counts and complete ranges, continue across server-capped short pages, reject duplicate or malformed records, and require two consecutive complete reads with identical records and revisions. This detects changes during the read; it is not a database transaction or a lock on future edits.

`npm run catalog:export` creates reviewed editorial overrides consumed by the globe and static generators. It refuses an empty or incomplete catalog and database records whose review date is older than their corresponding source snapshot, including removed records from a refreshed dataset. When source imports are ahead, reconcile those reviewed changes into the database before exporting. Never use an export to erase a synchronization warning. Preserve existing editorial notes and use exact revision/record guards when applying reviewed source changes; withhold retired IDs instead of deleting audit evidence.

Run `npm run catalog:verify` before a data release and again after database reconciliation. It must pass before treating the editorial database and public snapshot as synchronized. Builds never mutate the database or silently pull new content.

Run `supabase/tests/permissions.sql` through the SQL editor or an authorized SQL tool. It creates transactional fixtures and rolls them back, testing contributor isolation, privilege escalation denial, editor writes, withheld records, immutable audit visibility, and optimistic concurrency. Run Supabase security/performance advisors after schema changes.

Generated TypeScript database definitions are in `server/database.types.ts`. The application remains plain JavaScript to fit the existing codebase; types document the integration and support future typed consumers.

## Operational setup and limits

- Production Auth origin and callback must match `.env.example` and the deployed hostname. Preview domains need their own explicit SITE_URL/redirect configuration to test email flows.
- Supabase's built-in email service is limited. Configure a verified SMTP provider and test confirmation/recovery before broad public onboarding.
- Accounts and editorial APIs have no offline mode. The public directory does.
- Direct database owners can bypass RLS and modify audit evidence; use project access controls and Supabase platform logs to govern administrators.
- Review account-deletion requests and source-review queues as an ongoing editorial responsibility. The application does not promise an unattended review or deletion schedule.
- Back up the database before migrations and rehearse restore procedures appropriate to the active Supabase plan. Git preserves published facts and migrations, not private account data.
