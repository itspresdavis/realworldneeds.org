# Catalog operations reports

The **Catalog operations report** workflow produces read-only reports from the selected repository snapshot. It does not fetch provider pages by default, refresh source data, change review dates, edit the database, publish records, or deploy the site. It uses the existing Node.js 24 runtime and pinned actions without installing application dependencies. GitHub Actions availability and the repository's existing billing restrictions still apply; this adds no service or paid subscription.

## Run and inspect a report

When the workflow is registered on the default branch, select **Actions → Catalog operations report → Run workflow**, choose the reviewed source branch, and leave **Check source links** off. A new workflow existing only on a pull-request branch may not yet be dispatchable; use the local commands below until it is registered. A successful report is not a successful production release.

The run summary shows static listing, direct-record, distinct normalized physical-address, and referral/network counts separately, plus missing structured hours/eligibility and proposed high-priority review counts. The six-community coverage matrix identifies remaining gaps. Location-triggered USDA seasonal results are excluded from these totals. Missing structured fields may still have useful narrative information; neither an empty field nor an overdue date proves a service has closed.

The artifact contains `catalog-health.json`, `catalog-coverage.json`, optional `catalog-source-health.json`, and `report-receipt.json`. The receipt binds the report to the source SHA, canonical catalog hash, lockfile hash, Node version, and UTC report date. Hashes are unsigned integrity evidence. Artifacts contain public catalog IDs, public source URLs and review candidates, never correction text, reply contacts, memberships, account records, raw searches, precise visitor locations, or credentials. Artifacts expire after **seven days** and follow repository Actions access; do not add private inputs to this workflow.

Run the same reports locally, keeping output outside tracked source:

```sh
report_dir="$(mktemp -d)"
node scripts/catalog-health.mjs --output "$report_dir/catalog-health.json"
node scripts/coverage-report.mjs --output "$report_dir/catalog-coverage.json"
```

For a repeatable historical comparison, supply the same explicit `--date YYYY-MM-DD` to both commands. Compare receipts and the same catalog populations before interpreting a change. Local output does not establish a hosted workflow pass.

## Optional source sampling

Only an explicit manual dispatch with **Check source links** enabled samples the first **20 unique source URLs in catalog order**. Scheduled runs never sample providers. The sample uses at most four concurrent requests, a ten-second deadline per source across redirects, at most five followed redirects, HEAD first and a status-only GET fallback for HTTP 405. It is bounded reachability evidence, not an exhaustive or random source audit and not provider verification. No page content is imported or republished.

The transport validates HTTPS destinations and all DNS answers, pins public addresses, checks connected addresses and revalidates every redirect. Proxy-only environments that cannot preserve that guarantee report **blocked**, never bypass the proxy. HTTP 404/410 is broken-source evidence; timeouts, denials, rate limits and blocked transport remain unknown/incomplete. Broken results mark the run **needs-review**; unknown or blocked results mark it **incomplete**. Both retain artifacts and fail the report job so an unfinished check cannot appear green. No automatic retries or refreshes run against providers.

Local equivalent, only when a bounded provider check is intended:

```sh
node scripts/catalog-health.mjs --check-links --limit 20 --output "$report_dir/catalog-source-health.json"
```

## Scheduling is disabled pending ownership

The workflow declares a weekly Monday 13:17 UTC trigger, but its job stays skipped unless **all** repository variables below are configured on `iamhuvr/RWN-WEB`. A skipped job is not monitoring. No values have been appointed by this change.

| Repository variable | Required owner decision |
| --- | --- |
| `RWN_CATALOG_MONITOR_ENABLED` | Set exactly `true` only after the operating arrangement is approved. |
| `RWN_CATALOG_MONITOR_OWNER` | Existing accountable account/team that accepts reviewing runs and candidates. This grants no access or editorial role. |
| `RWN_CATALOG_MONITOR_ESCALATION_OWNER` | Existing authorized account/team accepting escalation when the first owner is unavailable. |
| `RWN_CATALOG_MONITOR_APPROVAL_REF` | Link/reference to the recorded approval of ownership, weekly cadence, seven-day artifact retention, review response expectations and escalation procedure. |

Before setting these variables, the repository owner must confirm that the named operators can access Actions artifacts and the legitimate editorial workspace, select how they will notice failed/missed runs, and test that arrangement with an actual report and an acknowledged review. Configure any future notification destination separately with authorization; this workflow sends no messages or webhooks. GitHub's account notification preferences are not a verified alert route. A source-control file or successful job alone does not establish staffed monitoring or delivered alerts.

The proposed freshness intervals in `src/utils/review-schedule.js` remain proposals. Approval to run this report does not approve those editorial policies, appoint reviewers, or promise provider response times. A reviewed policy can be tested separately through `catalog-health.mjs --review-policy <file>`; do not silently infer policy approval from a nonempty workflow variable.

## Review, escalation and recovery

1. For structural failures, missing reports, blocked source transport or failed execution, inspect the receipt and available artifacts. Fix the tooling or restore the permitted execution path, then rerun the exact source. Do not label an incomplete report a source closure or override transport restrictions.
2. Prioritize evidence of unsafe directions, expired services, broken official sources and high-risk shelter access. Review relevant official evidence and compare existing scoped reviews before editing. Preserve stable IDs, prior evidence, unknown fields and useful contact/referral alternatives.
3. Use the existing authorized editorial review/history workflow for assignment, evidence, reason and decisions. Candidate generation never publishes a correction or withholds an aging listing. Catalog publication still requires the normal validation, compatibility and release gates. See [Editor guide](EDITOR_GUIDE.md), [correction handoff](CORRECTION_CHANNEL_HANDOFF.md), and [data pipeline](RESOURCE_DATA_PIPELINE.md).
4. If an operator cannot complete the agreed review, follow the approved escalation arrangement. Response deadlines and ownership are unresolved until recorded in the approval reference; this document invents no staff or service commitment.
5. Disable future scheduled reporting by clearing `RWN_CATALOG_MONITOR_ENABLED`; already-running jobs can be canceled through Actions. No data rollback is required because reporting does not mutate source or hosted state. Keep meaningful source-review decisions in the existing audit history before the seven-day report artifact expires.

This workflow does **not** read the private correction queue, hosted publication failures, account-service health, public availability, search-failure analytics, or alert delivery. Those operating checks remain separate incomplete requirements until scoped credentials, approved owners/destinations and real delivery/integration evidence exist. Do not broaden this public artifact workflow to export private reports.
