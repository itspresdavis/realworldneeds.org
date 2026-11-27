# Vercel Web Analytics

RWN is a static JavaScript site. The official plain-HTML integration needs no React component or additional npm package. `public/rwn-web-analytics.js` queues the documented `beforeSend` hook before loading the same-origin `/_vercel/insights/script.js`. Existing first-party RUM measures technical reliability separately.

## Collection scope

Only HTTPS production home and directory landing pages on realworldneeds.org / www.realworldneeds.org qualify. Queries, fragments, referring pages, other routes, previews, custom events, Global Privacy Control and Do Not Track are excluded. The filter rechecks the current URL before every event. No resource, need, search, account or saved-service events are sent. Vercel can derive approximate location/device information and a short-lived visitor hash from the ordinary request. The privacy notice and Why RWN explain this limited scope. Counts therefore do not represent all site traffic.

## Activation and cost

Production defaults off. Set `RWN_VERCEL_WEB_ANALYTICS=1` for the Production environment and rebuild only after metered usage is approved. Preview builds include the loader to inspect integration but the hostname guard prevents analytics requests. Remove the flag and rebuild to stop collection; Vercel's Analytics dashboard can disable collection immediately. Do not enable Analytics Plus or change the account plan.

Vercel Pro pricing checked November 27, 2026: $0.03 per 1,000 collected events, subject to the Pro usage credit; Pro has no separate included event allowance. This client filter is not a monthly spending cap. No account-wide spending settings are changed by this integration.

## Verification

Use a Vercel cloud build and native browser review. After authorized activation, open a clean production landing URL, inspect the same-origin `/view` request in Network, then confirm a visit in the Analytics dashboard. Inspect its payload for only the clean landing URL and SDK metadata; no query, fragment, referrer, identity or event data. Negative cases are covered in `tests/rwn-web-analytics.test.mjs` for native GitHub Actions when minutes are available. Never claim these tests passed without an actual run.

References: https://vercel.com/docs/analytics/quickstart · https://vercel.com/docs/analytics/redacting-sensitive-data · https://vercel.com/docs/analytics/privacy-policy · https://vercel.com/docs/analytics/limits-and-pricing
