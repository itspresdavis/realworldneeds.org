# Optional resource accounts

Implemented on the existing server-only Supabase Auth session. `/account` is separate from the contributor workspace. Public browsing and guest suggestions remain open. No new runtime dependency.

Answers are an allowlisted set of broad resource topics and an optional city/country or U.S. ZIP. Each save needs explicit consent, including health/shelter when selected. No precise address, medical history, income, documents or freeform intake. Guest choices are never imported automatically. Suggestions use the same deterministic catalog matcher as guest suggestions and explain matching topics; they do not claim eligibility, capacity or exhaustive coverage.

`api/preferences.js` verifies a confirmed nonanonymous user, derives the row owner from that identity, checks same-origin JSON for writes, and returns no-store responses. RLS independently restricts SELECT/INSERT/UPDATE/DELETE to the owner and prevents owner reassignment. Public/anonymous access and maintenance privileges are revoked. Preferences can be downloaded or deleted immediately; Auth-user deletion cascades. The existing administrator-processed account deletion request remains explicit about not deleting immediately.

## Activation requirements

Default: `RWN_PERSONAL_ACCOUNTS_ENABLED=false`. Do not enable merely because the UI builds. Apply `supabase/migrations/20261125222003_resource_preferences.sql` only to the verified RWN project after review. Require the native GitHub PostgreSQL policy tests and browser/API tests to pass for the exact candidate. Configure working SMTP and an allowed callback `https://www.realworldneeds.org/api/account?action=callback&destination=account`; verify signup confirmation, signin, password recovery, session expiry, signout and deletion using authorized test accounts. Test production-equivalent preview origins and account redirects. Set the flag only after acceptance. No hosted migration, signup email or user creation has been performed by this change.

The account shell and API are excluded from service-worker caching. Browser history restore clears private rendered content and revalidates the account. Tokens remain in HTTP-only cookies. No service-role key is used. The account deletion worklist is still manual; publication must not promise immediate account removal.
