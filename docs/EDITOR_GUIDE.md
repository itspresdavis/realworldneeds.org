# Reviewing the RWN catalog

Every published listing has one durable row in `public.rwn_locations`. The same ID connects the database, globe marker, service page, CSV export, and review history.

## Open the database directly

Open [RWN locations in Supabase](https://supabase.com/dashboard/project/cytfrxldixdapjaxcqzf/editor/25704). Search for a listing ID or name. Open its `record` field to inspect every original service fact. The separate name, country, coordinates, source URL, and review-date columns are generated from that record, so they cannot drift apart.

The [editor queue](https://supabase.com/dashboard/project/cytfrxldixdapjaxcqzf/editor/25811) provides a sortable worklist, a review-due label after 180 days, and links to the public listing and globe. A review-due label signals age; it does not claim a service has closed.

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

Review `src/data/generated/editorial-overrides.js`, commit the approved diff, and deploy the release. Every public surface then receives the same snapshot. The export includes edited/new records and withheld IDs. It refuses an empty catalog. Existing source-refresh scripts remain explicit maintenance operations: reconcile upstream changes with editorial overrides before releasing.

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

For New York WIC, `lastChecked` records when rows were fetched. The importer does not fetch an authoritative source update date, so new imports omit `sourceUpdatedAt` rather than reuse a hard-coded date. Existing historical snapshot/source-ledger dates are unchanged by this code fix; review the source ledger against the next actual refresh before release.
