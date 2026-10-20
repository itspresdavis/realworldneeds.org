# Optional Supabase telemetry

This change does not alter production until someone sets environment variables. `/api/rum` still validates the same coarse payload, writes the same JSON log line, and returns 204. It inserts a row only when **both** `SUPABASE_URL` and `SUPABASE_SECRET_KEY` are non-empty. `SUPABASE_SERVICE_ROLE_KEY` is not read. A missing variable does not add a warning.

`/api/submit` is not linked from any page. Without those two variables it returns 503 and stores nothing.

## Which database

The site already uses a different Supabase project for the editorial catalog and contributor accounts:

| | Editorial catalog | Project named RWN-WEB |
| --- | --- | --- |
| Ref | `cytfrxldixdapjaxcqzf` | `bbtjojbsprmituftbehl` |
| Where it appears | `.env.example`, `server/supabase.js`, `scripts/catalog-sync.mjs`, docs, pull request #34 | Not referenced anywhere in this repository or its history |
| Role | Publishable server client, RLS, contributor auth | Separate project. Status was `INACTIVE` on 20 Oct 2026. A direct SQL connection timed out. |

`SUPABASE_URL` in `.env.example` stays the editorial project. Do not point the existing publishable client at `bbtjojbsprmituftbehl`. Setting `SUPABASE_SECRET_KEY` beside the editorial URL would write telemetry into the catalog project. That is not done in this change, and it should be a separate decision.

The Vercel project `rwn-web` (`prj_504G7M2lhnU5NlmfSAEyY4UdA4DX`) had no environment variables on 20 Oct 2026 (`hiddenProductionEnvCount` 0). Production therefore uses the hardcoded publishable fallback in `server/supabase.js`, and this persistence path stays off.

## Variables

Set these in Vercel, not in git. Never prefix the secret with a public client name.

| Name | Required for persistence | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Already documented for the editorial project. Telemetry uses the process environment only, not the hardcoded fallback. |
| `SUPABASE_SECRET_KEY` | Yes | Server only. Leave blank in `.env.example`. |
| `SUPABASE_PUBLISHABLE_KEY` | No | Existing contributor client. Not used by `/api/rum` or `/api/submit`. |

## Migration

`supabase/migrations/20261020000000_rum_and_submissions.sql` is committed and **not applied**. It creates `public.rum_events` and `public.submissions`, enables and forces row level security, adds no policies, and revokes `anon` and `authenticated`. The browser never receives a key that can read those tables.

Do not apply it to `cytfrxldixdapjaxcqzf` or to `bbtjojbsprmituftbehl` until the target project is an explicit choice. The RWN-WEB project was paused, so a push would not run there until it is restored.

## Privacy gate

The published privacy notice says diagnostic events are written to Vercel runtime logs and are not copied into a separate visitor analytics database. Supabase is described only as the contributor-account store. Leave `SUPABASE_SECRET_KEY` unset in production until that notice, the third-party table, and the retention section are updated. This draft does not change `public/privacy.html`.

## Content Security Policy

No CSP change. The browser still posts to same-origin `/api/rum`. `connect-src` remains `'self' https://services1.arcgis.com`. Server-side Supabase calls are not a browser connection.

## API shape

Static files are built by `npm run build` into `dist/` (`vercel.json`: `framework` null, `outputDirectory` `dist`, Node 24). `/api/*.js` are Vercel Node functions. Existing routes are `/api/rum`, `/api/account`, `/api/catalog`, and `/api/workspace`. `/api/rum` is capped at 5 seconds and 256 MB. The client in `src/telemetry.js` samples performance on about 2% of loads and posts schema 2 events. This draft keeps that client unchanged.

## Preview test plan

1. Open the preview deployment **without** setting `SUPABASE_SECRET_KEY`.
2. `GET /api/rum` returns 405 with `Allow: POST`.
3. `POST /api/rum` with `Content-Type: application/json` and a body such as `{"schema":2,"type":"performance","route":"finder","viewportClass":"large","lcp":100}` returns 204. The function log still contains `rwn_client_telemetry`. No Supabase request is made.
4. A cross-origin `Origin` returns 403. A body over 4096 bytes returns 413. An unknown `type` returns 400.
5. `POST /api/submit` returns 503 and writes nothing. No page links to it.
6. Confirm production env still has no `SUPABASE_SECRET_KEY`, and confirm the migration file has not been executed.
7. A later write test, only after choosing a database, restoring it if needed, and applying the migration: set both variables on this preview only, repeat the POST, expect 204, then read `rum_events` from the SQL editor. Unset the secret when finished. Do not enable it in production before the privacy notice changes.
