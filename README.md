# Real World Needs

Vercel-ready website for Real World Needs: a source-backed global aid finder and public accountability model centered on an interactive globe.

## What This Is

RWN helps people explore free aid resources from verified public sources. The first version focuses on:

- food banks and food relief
- clothing and everyday material aid
- shelter or homelessness support
- referral/search hubs
- global food-bank networks

The site intentionally avoids invented impact numbers, unverified availability, or unsupported eligibility claims.

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
- official source URL
- source note
- last checked date

Only add a listing when an official organization, government, or recognized referral source supports the claim.

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
