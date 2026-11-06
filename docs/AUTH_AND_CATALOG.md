# Authentication and catalog architecture

The existing static site remains the public delivery system. Supabase is the editorial database and identity provider. Vercel functions enforce account routes and use a user-scoped Supabase client; no service-role credential is required by the deployed app.

## Request flow

`/join` submits same-origin JSON to `/api/account`. Supabase Auth issues a session stored in HTTP-only, SameSite=Lax cookies (Secure in production). The browser never receives tokens in an API payload or localStorage. Email confirmation and password recovery use PKCE and the exact callback route. The callback never accepts an arbitrary next URL.

`/workspace` rewrites to `/api/workspace`. Before serving its private HTML, the handler remotely verifies the user with `getUser`, rejects anonymous or unverified identities, and disables caching. `/api/catalog` repeats user verification and queries through that user's session. The service worker explicitly excludes account and workspace routes.

Every write requires both the configured exact Origin and matching Host, plus JSON content type. Forwarded host and protocol headers are never used for authorization. Unsupported methods and cross-origin writes are rejected before the authentication client is initialized. Bodies are limited to 12,000 bytes; malformed/non-object JSON returns 400 and oversized JSON returns 413. Streamed UTF-8 is decoded only after chunks are joined. Fields are separately bounded. Supabase handles password checks and Auth rate limits; application errors avoid disclosing whether an email exists. Network calls have timeouts and private responses use `no-store`.

## Canonical domain and release checks

The canonical public origin is `https://www.realworldneeds.org`. The rollout is deliberately staged: `vercel.json` permanently redirects the exact apex host `realworldneeds.org` only for `/join`, `/workspace`, `/api/account`, `/api/catalog`, and `/api/workspace`. The destination keeps the route; Vercel carries the query string through the redirect. No wildcard host or forwarded header is an allowed origin.

Public apex pages continue to work with canonical-www tags. Saved service IDs and offline caches are origin-scoped; an immediate site-wide redirect would strand existing apex saves. Full-public permanent redirection is deferred until a tested, explicit local Saved transfer/recovery path exists. This candidate does not claim completion of that migration.

`SITE_URL` must be an HTTPS origin without credentials, a path, query, or fragment. A trailing slash is normalized. The historical apex value is normalized to www so email links and session cookies use the same host. The loopback development origin `http://127.0.0.1:<port>` works only outside Vercel.

Use these settings when an authorized administrator reviews the active Supabase project:

- Vercel production `SITE_URL`: `https://www.realworldneeds.org`
- Supabase Auth Site URL: `https://www.realworldneeds.org`
- Exact allowed callback: `https://www.realworldneeds.org/api/account?action=callback`
- A preview needs its own explicit `SITE_URL` and exact callback in Supabase's redirect allowlist. Default preview hosts do not gain authentication trust automatically.

Cookies stay host-only. Existing apex sessions and pending apex PKCE links are not transferred to www; users must reopen www and sign in or request a fresh link. A stale apex form redirected across origins may send `Origin: null`; that request remains rejected. Do not allow null origins or share cookies across all subdomains to mask this transition.

Before release, verify the deployed preview belongs to the tested commit, then inspect the apex redirect and its path/query handling in Vercel. Once a release is approved, repeat those checks on both public domains. Sign-in, confirmation, recovery, callbacks, sign-out, deletion requests and editorial writes still need acceptance using an isolated test account on an active Supabase project. Fixture tests simulate these operations without sending mail or editing real accounts.

Run `node --test tests/auth-api.test.js tests/contributor-auth.test.js` for handler/SDK fixtures, cookie attributes, request errors, origin attacks, membership enforcement, stale editor writes, and private workspace denial. They do not prove live RLS configuration or mail delivery.

The live release manifest `/data/release.json` is explicitly `no-store` in both the browser and Vercel CDN. It is a changing release/connectivity probe and must not inherit the year-long shared cache policy used for versioned assets. The service worker does not cache it. The obsolete project-ID-specific `ignoreCommand` was removed after the referenced project returned 404 and the active project was verified separately; this does not replace required quality checks or authorize a production release.

## Tables and permission model

| Table                  | Public visitor       | Contributor                      | Editor                                                     |
| ---------------------- | -------------------- | -------------------------------- | ---------------------------------------------------------- |
| `rwn_locations`        | Read published facts | Read published facts             | Read all; create/update/withhold/delete under RLS          |
| `rwn_members`          | None                 | Read own membership              | Read own membership; grants require project administration |
| `rwn_reviews`          | None                 | Insert/read own notes            | Read notes for editorial review                            |
| `rwn_location_history` | None                 | None                             | Read immutable change evidence                             |
| `rwn_account_requests` | None                 | Insert/read own deletion request | Read administrator worklist                                |

Private editor invitations cannot be read or written by client roles. The activation trigger checks a trusted verified email and consumes a single invitation. Membership is looked up from the database, so removing a role takes effect on the next query rather than waiting for a JWT claim refresh.

Anonymous and authenticated client SELECT grants are column-scoped: public facts remain readable under RLS, while `editorial_note` and future columns stay private by default. Both historical table grants exposed internal reasons, including to any new contributor. Candidate migrations `20261106045706_restrict_anonymous_catalog_columns.sql` and `20261106052235_restrict_contributor_catalog_columns.sql` repair those grants. Editor/admin writes retain their RLS checks; internal reasons remain readable through the editor-only immutable audit history. The API already selects explicit public fields after writes. These migrations were tested in isolated PostgreSQL, not applied to a hosted database. Live grants/RLS must be checked before an approved schema release; the configured free project was reported inactive and a read-only metadata query failed.

Candidate migration `20261106052237_support_contact_only_catalog.sql` permits null generated coordinates only for contact-only locator/network records with documented coverage, eligibility and a valid contact channel. Mapped records still require both coordinates and retain range checks. This repairs the historical NOT NULL constraint that prevented the existing frontend contact-only contract from reaching the database. Database type declarations reflect the conditional nullability.

`rwn_locations.record` preserves the complete existing source record. Generated columns expose the most useful review fields without duplicating editable state. Constraints protect record identity, coordinate ranges, HTTPS source attribution, listing kind, service arrays, and review dates. B-tree indexes cover country, review date, stable pagination, ownership and history; a trigram index supports bounded name/place searches.

The API allows only an explicit set of editorial fields. Its update predicate includes the original `updated_at` value. A concurrent change returns 409 instead of silently overwriting another review. An AFTER trigger captures complete generated fields in immutable before/after JSON; a separate BEFORE trigger assigns a fresh revision timestamp.

## Reproducible database operations

Apply the committed migrations in order. `npm run catalog:seed` prepares 100-row SQL batches under ignored `supabase/import/`. The bootstrap importer uses `ON CONFLICT DO NOTHING`; rerunning it never overwrites editorial changes.

`npm run catalog:verify` compares a canonical SHA-256 digest of every published database record with the exact site snapshot, including all nested fields. Reads require exact server counts and complete ranges, continue across server-capped short pages, reject duplicate or malformed records, and require two consecutive complete reads with identical records and revisions. This detects changes during the read; it is not a database transaction or a lock on future edits.

`npm run catalog:export` creates reviewed editorial overrides consumed by the globe and static generators. It refuses an empty or incomplete catalog and database records whose review date is older than their corresponding source snapshot, including removed records from a refreshed dataset. When source imports are ahead, reconcile those reviewed changes into the database before exporting. Never use an export to erase a synchronization warning. Preserve existing editorial notes and use exact revision/record guards when applying reviewed source changes; withhold retired IDs instead of deleting audit evidence.

Run `npm run catalog:verify` before a data release and again after database reconciliation. It must pass before treating the editorial database and public snapshot as synchronized. Builds never mutate the database or silently pull new content.

Run `supabase/tests/permissions.sql` on an isolated test database through the SQL editor or an authorized SQL tool after applying the candidate migrations. The source grant contract also runs with `node --test tests/catalog-column-permissions.test.js`; that check does not execute PostgreSQL. It creates transactional fixtures and rolls them back, testing contributor isolation, privilege escalation denial, editor writes, withheld records, immutable audit visibility, and optimistic concurrency. Run Supabase security/performance advisors after schema changes.

For repeatable local SQL execution, run `python3 scripts/qa-postgres-permissions.py` from this checkout with Docker and the already-installed `postgres:17.11-bookworm` image. The runner pins that image ID, never pulls, creates a unique container with no network, host ports or persistent data mounts, and removes its exact container in a finally block. It reproduces both historical private-column disclosures, applies all candidate migrations, executes RLS permission assertions and the actual Carapicuíba contact-only record plus invalid-coordinate/contact cases, and verifies transactional users are rolled back. `supabase/tests/local-auth-fixture.sql` supplies minimal auth.users/auth.uid/auth.jwt stand-ins: this is real PostgreSQL RLS evidence with simulated JWT claims, not an end-to-end Supabase Auth/PostgREST acceptance test. Do not run the local auth fixture on a hosted database.

Generated TypeScript database definitions are in `server/database.types.ts`. The application remains plain JavaScript to fit the existing codebase; types document the integration and support future typed consumers.

## Operational setup and limits

- Production Auth origin and callback must match `.env.example` and the deployed hostname. Preview domains need their own explicit SITE_URL/redirect configuration to test email flows.
- Supabase's built-in email service is limited. Configure a verified SMTP provider and test confirmation/recovery before broad public onboarding.
- Accounts and editorial APIs have no offline mode. The public directory does.
- Direct database owners can bypass RLS and modify audit evidence; use project access controls and Supabase platform logs to govern administrators.
- Review account-deletion requests and source-review queues as an ongoing editorial responsibility. The application does not promise an unattended review or deletion schedule.
- Back up the database before migrations and rehearse restore procedures appropriate to the active Supabase plan. Git preserves published facts and migrations, not private account data.
