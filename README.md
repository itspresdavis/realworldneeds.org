# Real World Needs

Vercel-ready website for Real World Needs: a source-backed global aid finder centered on an interactive globe.

## What This Is

RWN helps people explore free aid resources from verified public sources. The first version focuses on:

- food banks and food relief
- clothing and everyday material aid
- shelter or homelessness support
- referral/search hubs
- global food-bank networks

The site intentionally avoids invented impact numbers, unverified availability, or unsupported eligibility claims.

## Data Policy

Every seed listing in `src/data/resources.js` includes:

- organization name
- address or national online-service scope
- service categories
- official source URL
- source note
- last checked date

Only add a listing when an official organization, government, or recognized referral source supports the claim.

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

## Update Workflow

1. Add or edit resources in `src/data/resources.js`.
2. Keep the source URL and source note specific.
3. Run `npm run build`.
4. Deploy through Vercel.
