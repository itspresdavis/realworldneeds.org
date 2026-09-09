# Contributing to Real World Needs

RWN exists to make practical help easier to find. Keep the directory useful, accessible, and honest about what each source can establish.

## Start locally

Use Node.js 24, then run `npm ci` and `npm run dev`. The preview at `http://127.0.0.1:5173` serves the static site and the same account/catalog handlers used by Vercel. Copy `.env.example` only if you need a different project or site origin. Never commit a service-role key.

Run `npm run check` before a pull request. It validates syntax, all catalog records, generated pages, internal links, privacy boundaries, accessibility contracts, payload budgets, and unit tests. Browser tests use the existing `npm run test:browser:qa` workflow. Set `CHROME_PATH` when Chrome is not in PATH.

## Where to work

| Area                     | Files                                                               | Responsibility                                                     |
| ------------------------ | ------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Finder and globe         | `src/app.js`, `src/globe-points.js`, `src/utils/`                   | Search, selection, geometry, gestures, fallback                    |
| Public presentation      | `src/professional.js`, `src/clarity.css`, `src/styles.css`          | Copy, navigation, responsive public layout                         |
| Shared catalog           | `src/data/resources.js`, `src/data/generated/`                      | Exact published snapshot used by every public surface              |
| Contributor UI           | `public/join.html`, `public/contribute.js`, `public/contribute.css` | Sign-in, review and editing interactions                           |
| Protected page           | `api/workspace.js`, `server/workspace.html`                         | Remote user verification before HTML is returned                   |
| Account and catalog APIs | `api/account.js`, `api/catalog.js`, `server/`                       | HTTP-only sessions, CSRF checks, validation, RLS-aware data access |
| Database                 | `supabase/migrations/`, `supabase/tests/`                           | Versioned schema, row policies, constraints, audit triggers        |
| Public page generation   | `scripts/build*.mjs` and subsequent build steps                     | Directory, service, source, SEO and export output                  |

## Design boundaries

- The public directory remains open and works without an account. Never gate essential service information behind signup.
- An auth cookie alone is not trusted. The server calls Supabase `getUser`; database policies independently enforce ownership and editor membership.
- Use the publishable key in the server integration. Privileged database work goes through reviewed migrations and explicit maintenance operations.
- Database edits are not an automatic public release. Export and review a deterministic snapshot so the globe and directory cannot disagree.
- Preserve source URLs, original review dates, precise-versus-coverage distinctions, free-access evidence, and accessibility fallbacks.
- Use plain, respectful language. Do not invent nonprofit registration, partners, testimonials, impact counts, availability, or verification claims.
- The line illustration is an editable original SVG; keep graphics light and avoid introducing trackers or remote font dependencies.

See [the editor guide](docs/EDITOR_GUIDE.md) and [the architecture notes](docs/AUTH_AND_CATALOG.md) for operating details. Keep pull requests focused, explain the user-visible behavior, and include verification evidence and any unresolved limitations.
