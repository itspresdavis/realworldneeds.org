# Real World Needs

Vercel-ready website for Real World Needs: a source-backed global aid finder and public accountability model centered on an interactive globe.

## What This Is

RWN helps people explore free or no-cost core aid from official provider, government, and network sources. The current directory contains 40 records and focuses on:

- food banks and food relief
- drinking-water and seasonal hydration support
- shelter and housing navigation
- showers, laundry, toilets, and hygiene items
- clothing and everyday material aid
- health, dental, mental-health, and recovery support
- official referral tools and food-bank networks

The site intentionally avoids invented impact numbers, unverified availability, or unsupported eligibility claims.

The globe supports inertial drag, keyboard navigation, zoom, regional focus views, geographic marker clustering, selected-layer paths, reduced motion, and an optional in-browser location marker. Directory results load progressively so the primary finder remains concise while all records stay available.

## Current Release Boundary

The public aid finder is live. Verified-needs publishing, public intake, partner accounts, donation processing, allocations, disbursements, and impact reporting remain disabled until RWN has the real organizational and operational controls to support them.

The interface exposes those future workflows as a truthful operating model and empty public ledger. It does not use placeholder transactions or invented activity.

## Operating Documentation

- `docs/PLATFORM_DATA_MODEL.md` defines future need, organization, allocation, delivery, evidence, correction, and audit records.
- `docs/DONATION_CONTROLS.md` defines payment, restricted-fund, authorization, reconciliation, and reporting controls required before accepting money.
- `docs/PROFESSIONAL_LAUNCH_REQUIREMENTS.md` defines the legal, program, logistics, finance, privacy, security, and governance gates for professional operations.

## Data Policy

Every seed listing in `src/data/resources.js` includes:

- organization name
- address or national online-service scope
- service categories
- direct-site, locator, or partner-network type
- access and cost notes
- confirmation-before-travel guidance
- official source URL
- source note
- last checked date

Only add a listing when an official organization, government, or recognized referral source supports the claim.

The globe uses the public-domain Natural Earth 1:110m country dataset stored locally in `public/data/countries.geojson`. The interface does not depend on a third-party map request at runtime.

The current release has no accounts, public forms, analytics, or marketing cookies. Optional geolocation is used only in the browser session to sort listed resources by approximate distance.

## Local Development

```bash
npm run dev
```

Open `http://localhost:5173`.

## Vercel Deployment

```bash
npm run build
```

Vercel uses `vercel.json`, runs the static build, and serves `dist`.

Production alias: `https://rwn-web.vercel.app`

## Verification

```bash
npm ci
npm run check
```

The check command validates JavaScript syntax, resource records, core filtering and distance behavior, and the production build.

## Update Workflow

1. Add or edit resources in `src/data/resources.js`.
2. Keep the source URL and source note specific.
3. Run `npm run check`.
4. Deploy through Vercel.
