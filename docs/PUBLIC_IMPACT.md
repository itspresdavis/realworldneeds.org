# Public impact rollup

The public `/impact` page reads only `/impact-summary.json`, a static file. The empty default is intentional. The site does not connect to RWN Core, grant public access to the ledger, accept writes or process donations.

Publish an exact schema-version 1 JSON object only after reconciling completed distributions in the private system and having a second reviewer check the aggregate. Do not count offers, incoming goods, packed boxes or unverified downstream handoffs. Do not count the same item twice. Calculate and retain valuation evidence privately. Currency is USD and the estimate is integer cents, or null when unsupported. Counts may publish when the estimate is unavailable. Use UTC publication time, not an approximate distribution date. State which scope the rollup covers if it changes.

Categories and units:
- shoes: pairs
- clothing: individual articles, excluding shoes and socks
- socks: clean pairs verified as distributed
- water: individual drinking-water bottles
- food: individual food units consistent with distribution records, never labeled meals
- hygiene and other: individual items

Only the categories, values, status, currency, and publication timestamp may enter this public file. No personal records, contact information, event/location detail or private IDs. Build fails on additional keys, unknown categories, and invalid values; retain a known-good public version to roll back. Before changing the default, confirm the organization has approved any necessary public reporting policy, the data has been reviewed, and the publication can be tested in preview. The browser checks on page load or when a visitor chooses Refresh totals, with a small cooldown. There is no polling, push connection or background tab traffic. It shows publication time, distinguishes unknown estimates, and labels a failed refresh without relabeling stale totals as current. Backend sync is not part of this release.
