# Reviewing the RWN catalog

Every published listing has one durable row in `public.rwn_locations`. The same ID connects the database, globe marker, service page, CSV export, and review history.

## Open the database directly

Open [RWN locations in Supabase](https://supabase.com/dashboard/project/cytfrxldixdapjaxcqzf/editor/25704). Search for a listing ID or name. Open its `record` field to inspect every original service fact. The separate name, country, coordinates, source URL, and review-date columns are generated from that record, so they cannot drift apart.

The existing hosted [editor queue](https://supabase.com/dashboard/project/cytfrxldixdapjaxcqzf/editor/25811) uses a legacy 180-day review label. Its hosted replacement is pending database recovery and an approved operational cadence. A review-due label signals age; it does not claim a service has closed.

The workspace record inspector and `npm run catalog:health` now provide a separate **proposed** risk schedule: 14 days for shelter access, 30 days for changing food/hygiene/water access and other records, and 90 days only for records explicitly reviewed as `freshnessRisk: "stable-official-dataset"`. Shelter risk always takes priority. These are planning proposals awaiting the operations owner's approval, not staffing or provider commitments. No current catalog record receives a new freshness classification automatically.

To produce a deterministic candidate worklist without network requests:

```sh
node scripts/catalog-health.mjs --date 2026-11-06 --output /tmp/rwn-review-candidates.json
```

An optional `--review-policy /path/to/policy.json` accepts `{"intervals":{"shelter":7,"changingAccess":30,"stableOfficialDataset":90,"other":30}}`; omitted intervals retain defaults. Intervals must be integers from 1 to 365 days. The output remains labeled proposed. `reviewQueue.candidates` contains stable listing identity, due date, risk priority, reasons and source evidence. Expired seasonal dates and sampled broken/redirected source links also generate candidates; an HTTP success never confirms service facts. Link sampling remains an explicit separate operation, outside builds.

New structured evidence can be retained in a record's `reviewEvidence` object as separate `sourcePublishedAt`, `sourceFetchedAt`, `reviewedAt`, `providerConfirmedAt`, `nextReviewDue`, `verificationMethod`, and `evidenceReference` fields. Dates use `YYYY-MM-DD`. Do not populate provider confirmation without an actual confirmation or reviewed-at from a fetch. Legacy `lastChecked` remains unchanged and is explicitly described as a source check that may have recorded retrieval. Missing/invalid review evidence creates work, not a fabricated fresh date. An explicit earlier due date accelerates the schedule; it cannot extend the risk interval.

Candidates are unassigned and do not change publication status. Use existing private review notes and editor changes to record evidence and a reason, preserving the immutable catalog history and separate publication gate. Persistent assignment, a richer decision workflow, hosted schedule migration, and alert ownership remain prerequisites for a staffed review queue. Never mass-withhold records solely because the proposed cadence makes them overdue.

Use the website's `/workspace` for a readable listing inspector and validated editing form. Database dashboard access and website editor access are separate permissions. A website contributor account does not grant Supabase project administration.

## Review a listing

1. Search the workspace by name, city, country, or category.
2. Choose **Inspect database record** to read all fields, follow the original source, and inspect history.
3. Check location precision. A `direct` record identifies a service location; `locator` and `network` coordinates describe coverage or an office, not a walk-in destination.
4. Confirm details against the provider. Update only facts supported by that source. Set the review date to when that check actually happened.
5. Explain the change and save. If another editor saved first, reopen the record and reconcile the differences; the stale edit is rejected.
6. If a listing should not appear in the next release, choose **Withheld from the next release**. Preserve the row and evidence rather than deleting it.

Contributor notes are in `rwn_reviews`. Catalog changes are in `rwn_location_history`, with before/after values, time, and actor. A null actor identifies a direct database maintenance operation; Supabase's own platform logs provide the corresponding dashboard/operator context. Ordinary editors cannot alter history through the Data API.

Direct SQL changes should update `record` and `editorial_note` together. Never edit generated columns. Project owners can bypass application policies in the dashboard; use the workspace for ordinary editorial work.

## Publish a reviewed release

Saving the database is deliberately separate from publishing. This protects the public directory from incomplete reviews and database outages.

```sh
npm run catalog:export
npm run check
npm run catalog:verify
```

Review `src/data/generated/editorial-overrides.js`, commit the approved diff, and deploy the release. Every public surface then receives the same snapshot. The export includes edited/new records and withheld IDs. It refuses an empty, incomplete, unstable, or older-than-source catalog. A synchronization failure can mean that a source refresh is newer than the database: reconcile that approved refresh into the database first, preserving editorial notes and history, rather than exporting stale rows back onto the site. Existing source-refresh scripts remain explicit maintenance operations: reconcile upstream changes with editorial overrides before releasing.

To withhold urgently, update the database, export, and deploy promptly. A database status change alone does not remove a record from an already deployed static release or a visitor's offline cache. Previously cached public pages can persist until the next worker update or browser eviction.

## Accounts and editor access

Use `/join` to create an account and verify its email in the same browser. Only the project owner can prepare a private editor invitation. Invitations activate only when Supabase reports that the matching email is verified, and expire after 30 days. Role claims in user-editable metadata are ignored.

The project owner's requested email has a pending private administrator invitation. It is stored in the database, not in repository source. Once verified, that account can review and edit listings in the workspace. Other signups can inspect published records and submit their own notes.

Before opening signup widely, configure production SMTP in Supabase and test delivery, confirmation, recovery, and rate limits with actual recipients. The exact production callback is `https://www.realworldneeds.org/api/account?action=callback`; do not allow broad wildcard redirect domains.

## Contributor privacy requests

Contributors can export their notes and request deletion in account settings. Review `rwn_account_requests` regularly. To process a request, revoke the user's sessions in Supabase Auth, delete the Auth user, and verify that memberships, private notes, and the request cascaded away. Editorial audit evidence remains with the catalog. Never claim deletion is complete until the database checks confirm it.

Do not put personal case details, private medical information, donor information, or credentials into catalog notes.

## Coordinate review

Open the [coordinate worklist](https://supabase.com/dashboard/project/cytfrxldixdapjaxcqzf/editor/25929). It distinguishes coverage markers from physical locations and flags shared points, rounded coordinates, and absent source precision declarations. These are review prompts, not automatic error classifications: multiple services can share a building.

The initial audit found 1,796 source-declared locations without these flags, 26 listings sharing coordinates, 20 physical listings needing precision confirmation, and 177 coverage markers. Check the original source and address before changing coordinates. Never scatter overlapping markers or infer a street address from a network's coverage center. The globe preserves every supplied latitude and longitude; increased visual detail does not independently verify those source coordinates.

## Refreshing source snapshots

`npm run refresh:data` runs the Massachusetts WIC, New York WIC, and Trussell importers in sequence. Each source also has its own `refresh:data:*` command. These commands fetch external sources and change local generated files; inspect the diff and run `npm run check` before publication. Trussell refreshes its paginated finder, so it can take longer than the WIC feeds. An earlier source may have changed locally if a later importer fails; review the complete diff rather than assuming an all-or-nothing refresh.

Trussell's collection status and its snapshot date stay separate from current availability. “Closed” and “Temporarily closed” mean the source reported that status in the dated snapshot. They do not establish that a centre is closed today. Preserve these fields when reviewing editorial overrides. Other statuses are not proof that a service is open now.

Massachusetts WIC now checks exact displayed result ranges, map/listing identity agreement, raw identity uniqueness, complete page coverage, an empty overflow page and a repeat of the first page before preparing any output. Its 30-page/1,000-row ceiling and 25-second deadline for each request **and its body** bound collection. Any failed response (including 403), redirect, malformed response, invalid required field or incomplete snapshot stops immediately without retrying. Coordinate values must be numbers or nonblank decimal strings inside the conservative Massachusetts envelope (latitude 41.1–42.9, longitude -73.6–-69.8); this is not parcel or boundary verification. All current 101 points fit that envelope.

Massachusetts only refreshes name, city, coordinates, address, phone, hours, source URL and `lastChecked`. Missing optional source phone/hours are not silently retained. Membership, military eligibility, presence of published hours and changes conflicting with known accessibility language require editorial reconciliation. A retrieval never creates a Massachusetts `sourceUpdatedAt`; existing legacy values are preserved pending a separate evidence review, not validated by their survival. This code-only hardening does not alter the current public catalog or claim a new source check.

Massachusetts protocol coverage is network-free. The current Mass.gov route was previously access-blocked and has not been retried for this work. The collector deliberately requires `Showing 0-0 of N results` plus an empty map/listing on the overflow response; an undocumented/clamped/redirected empty page fails for review rather than being guessed. Before an authorized real refresh, review the actual accessible page format and its empty-page behavior. First-page bracketing detects changes to that page and advertised totals, but cannot establish an atomic publisher-wide snapshot of every page. No denied route should be retried or bypassed to satisfy these checks.

New York WIC now reconciles the official count against every raw site ID, consumes every 500-row page, verifies an empty overflow page, and checks count and publisher metadata again before writing. Only Permanent and Temporary are direct service types. Administrative and Vendor Management Agency rows are explicitly excluded; an unknown type stops the refresh. Missing/invalid coordinates and missing street addresses have separate exclusion counts. `sourceUpdatedAt` comes from NYSDOH's `rowsUpdatedAt` metadata, while `lastChecked` is the retrieval date. A recent retrieval does not imply recent publisher data or current availability.

Trussell requires every reported page, matching totals and exact page sizes, unique UUID coverage before location filtering, and a matching first-page bracket check. Missing geometry does not erase a source identity. The bracket detects first-page changes during collection; it is not a claim that all pages form an atomic publisher snapshot. Source-hidden records never enter output, including preserved fields. Exclusions are counted once by their first applicable reason. Requests are sequential, at least one second apart, with no retry after a source failure.

All three importers preserve existing categories, summaries, service descriptions, notes, and unknown provenance fields. Only the explicitly listed source-owned facts in each importer are refreshed. A changed service type, a collection status conflicting with retained availability instructions, or changed known Trussell referral instructions stops the refresh for editorial reconciliation. Publisher-date regressions also stop it. A failed collection or validation leaves the generated snapshot untouched; successful writes use a temporary file, an exclusive refresh lock, and a before-bytes check before replacement. If a crashed process leaves a `.refresh.lock` file, confirm no refresh is running before removing it.

A changed published ID set stops replacement for explicit review. A source diff is review evidence, not a database insertion, restoration, withholding or closure instruction. New source IDs can already exist as withheld database rows. Re-read current database state before any separate reviewed synchronization, preserve publication decisions and history, and reconcile source-hidden changes with editorial overrides before release. A moved page-number URL is provenance movement rather than a changed service. These code safeguards do not update existing catalog records, source-ledger dates, or database state.


## Private correction review (activation pending)

The workspace has a separate correction queue for authorized editors and administrators. Public intake is disabled until the operating and hosted acceptance requirements in [CORRECTION_CHANNEL_HANDOFF.md](CORRECTION_CHANNEL_HANDOFF.md) are satisfied. A visible module or local test does not establish a monitored live channel.

Review the submitted public-listing issue against official evidence. Set priority and take the report yourself or leave it unassigned; no staffing commitment is implied. Every decision needs a reason and the current revision. Ready, rejected and duplicate decisions require an HTTPS evidence reference. If another reviewer changed the report, reload it and reconsider before saving. Revoked roles cannot continue reading or deciding reports.

“Ready for catalog review” does not publish anything. Prepare the source-backed listing update through the existing editorial workflow, retain service-specific access evidence, and pass the publication gate separately. Do not paste private report text into public catalog fields, repository issues, logs or source artifacts. Retention deletion is an owner operation under the approved policy, not a reviewer action.
