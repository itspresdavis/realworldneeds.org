# Service access and schedules

`src/utils/service-access.js` is the shared interpretation boundary for authored
records, generated pages, the compact index, finder actions, Saved and exports.
An explicit invalid contract produces no actions; consumers must not fall back to
the organization's generic coordinates. Existing resource and route IDs remain
stable. Saving a resource saves the organization listing and its complete set of
current service choices, not an arbitrary route.

Each `serviceAccess` route has an ID, label, categories, mode, instructions,
official HTTPS source and substantive route review date. Physical routes use a
complete source-backed operating address. Mailing boxes, confidential locations,
contact routes and delivery routes do not acquire walk-in directions. Intake
routes retain the official details action first; `directions: true` explicitly
adds directions to that intake address. Optional `contacts` have a reviewed
label, matching `email`, `sms`, `chat` or `online` type and URL. Email/text URLs
cannot include recipients, message bodies or other query parameters.

Optional plain-text facts are `entrance`, `eligibility`, `intake`, `capacity` and
`hours`. `documents` is a bounded list. `intakeCutoff` is an explicit local HH:MM
time and requires the schedule time zone. A signup start time is not a cutoff.
Keep published partial hours in `hours` or `schedule.text`; never invent an end
time merely to produce a machine-readable interval.

`beforeYouGoFacts(resource, { locale })` returns the labeled service facts and
their evidence. `serviceAccessSummary` carries the same present facts into
plain-text representations. Provider wording remains in its source language;
the English/Spanish option translates RWN's labels, not eligibility or promises.

On details pages each reviewed route places its own actions directly after its
access facts. Actions match the stable route ID; another service's destination
or the organization's general phone is never substituted. The top Next steps
section offers organization contact and a local jump to the service choices;
explicit route directions remain beside their restrictions. Copied handoffs
retain each route's labeled actions and facts. These static links work without JavaScript;
maps open only when a visitor follows a directions link.

Legacy records also receive `beforeYouGoFacts`: existing access instructions,
eligibility, cost and hours are shown before actions, with an explicit unknown
message for missing access facts. Physical addresses and coverage descriptions
have different labels. This presentation fallback does not manufacture a
`serviceAccess` route, change legacy directions or advance its review date.

## Field evidence

`fieldEvidence` maps an existing supported field to `{sourceUrl, checkedAt,
scope, verification}`. `checkedAt` is a real UTC timestamp; `scope` names what
was actually checked. Verification is `source-reviewed`, `provider-confirmed`,
`link-checked` or `unverified`. An HTTP success is only a link check. Neither a
field review, a formatting change nor a build advances the resource's broad
`lastChecked` date. Exports must preserve the full route JSON in addition to any
human-readable summary so these distinctions survive round trips.

## Structured schedule

`schedule` contains an explicit IANA `timeZone` and 1–28 `weekly` intervals.
Each interval has `days` (Sunday 0 through Saturday 6), `opens` and `closes` in
HH:MM. An interval crossing midnight must declare `endsNextDay: true`; its
closing time is exclusive. Equal opening/closing times are accepted only for
an explicitly declared full-day overnight interval.

Optional `validFrom`/`validThrough` are inclusive local dates. Optional dated
`exceptions` contain either `closed: true` or replacement `intervals`, and may
include a short source-backed note. An exception replaces the entire local
calendar day, including ordinary overnight carry-over. Do not represent a
partial-day exception as an entire-day closure.

`complete` defaults to false. A partial machine-readable schedule can establish
that the current instant falls within a reviewed published interval, but cannot
establish that all other times are closed. For example, keep a first-Saturday
exception in the narrative and structure only known weekday intervals unless
all of the recurring exception can be modeled accurately. Set `complete: true`
only when the reviewed schedule establishes the whole weekly pattern.

`serviceScheduleStatus(route, {now, locale})` uses the provider's local calendar,
including daylight-saving transitions. It requires substantive evidence for the
schedule field. Missing evidence, an invalid time zone/date, incomplete hours or
an instant outside seasonal validity produce `unknown` where applicable. Its
states are `scheduled-open`, `scheduled-closed` and `unknown`; availability is
always `unconfirmed`. They do not establish beds, inventory, capacity, admission
or whether a separate intake cutoff has passed. Do not calculate these statuses
at build time or embed them as a permanent public fact.

## Address-only physical sites

An official operating address can support a useful physical service even when
verified coordinates are unavailable. Such a record uses `kind: "direct"`,
`locationPrecision: "address"`, null coordinates, a reviewed city/country/address
and an explicit physical service route matching that operating address. The
site is searchable and its actions use the full verified address. It has no
globe point or computed distance. It must not be relabeled a finder or assigned
a city centroid. Updating its precision to mapped coordinates requires a
separately reviewed source change.

Hosted schema support is a separate migration and verification requirement.
Local contract tests do not establish that an older hosted schema accepts these
records. Existing mapped and contact-only contracts remain unchanged.
