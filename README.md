# Real World Needs

Real World Needs (RWN) is a static, privacy-minimizing humanitarian service directory. The production site is [realworldneeds.org](https://www.realworldneeds.org/).

## What this repository contains

- A browser-rendered 3D globe and accessible text directory.
- Source-backed public resource records with review dates and map coordinates.
- Progressive Natural Earth 1:10m close-view boundaries and an 8,192 px NASA surface for capable desktop GPUs.
- Browser-only search, filters, saved-service IDs, and optional location sorting.
- Privacy, Terms, Accessibility, and Editorial Policy pages.
- A deterministic static build for Vercel. No application server, database, account system, donation flow, analytics SDK, or form intake is present.

## Current release boundary

The public finder is live with 93 source-backed records. Verified-needs publishing, public intake, partner accounts, donation processing, allocations, disbursements, and impact reporting remain disabled until RWN has the organizational and operational controls required to run them safely. The repository must not use placeholder transactions, invented availability, or unsupported impact claims.

## Operating documentation

- `docs/PLATFORM_DATA_MODEL.md` defines future need, organization, allocation, delivery, evidence, correction, and audit records.
- `docs/DONATION_CONTROLS.md` defines payment, restricted-fund, authorization, reconciliation, and reporting controls required before accepting money.
- `docs/PROFESSIONAL_LAUNCH_REQUIREMENTS.md` defines the legal, program, logistics, finance, privacy, security, and governance gates for expanded operations.

## Local development

Requires Node.js 24.

```sh
npm ci
npm run check
npm run dev
```

`npm run check` validates JavaScript syntax, resource data, unit tests, and the production build. The local site is served at `http://localhost:5173` by the development command.

## Data standard

Resource records live in `src/data/resources.js`. Each record must have a stable ID, name, public place, coordinates, listing type, aid category, practical access information, original HTTPS source, source name, and ISO review date. `npm run check` rejects missing fields, unsafe URLs, duplicate IDs, invalid coordinates, and implausible dates.

The production build also creates a no-JavaScript `/directory`, `/directory.csv`, and `/data/resources.json` from the same reviewed records. Globe close views progressively load a topology-preserving 1:10m Natural Earth derivative and an 8,192 × 4,096 derivative of NASA’s official February Blue Marble 21,600 × 10,800 image. The fast initial globe remains local and deterministic; higher-resolution imagery is skipped on small screens, Data Saver connections, or GPUs that cannot use it safely.

Physical service-site markers should use the provider-published public location. Official locators and networks use representative points and must never be described as walk-in sites. See the public [Editorial Policy](https://www.realworldneeds.org/editorial-policy).

## Privacy and security model

- Search and filtering run locally in the browser.
- Location is requested only after an explicit click, held in memory, and used only for distance sorting.
- Saved records are service IDs in local storage; the footer provides a clear-data control.
- Shared resource IDs use URL fragments so they are not sent in HTTP request paths.
- Vercel provides static hosting and standard edge/security logs.
- Production responses use CSP, HSTS, no-referrer, clickjacking protection, MIME sniffing protection, origin isolation, and a restrictive Permissions Policy.

## Deployment

The Vercel project builds with `npm run build` and publishes `dist/`. The build copies reviewed first-party assets and the lockfile-pinned Three.js browser modules; it performs no network downloads.

Changes should pass the GitHub quality workflow and a production browser verification before merge. Do not add analytics, forms, accounts, donations, or personal-data collection without first updating the privacy architecture, public policies, retention rules, consent controls where required, and organizational contact details.

## Governance still required

The code cannot establish the organization’s legal identity. Before representing RWN as a fully registered or legally reviewed nonprofit service, authorized leadership and counsel must confirm the legal entity name and status, jurisdiction, registered address, public privacy/accessibility/corrections contact, retention schedule, governing-law position, safeguarding process, and policy owner.
