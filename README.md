# Real World Needs Shopify Theme

Production theme for Real World Needs.

Primary domain: `RealWorldNeeds.org`

Secondary domain: `RealWorldNeeds.com`

This theme is built around truth first launch safety. It does not invent impact numbers, partners, testimonials, charity ratings, nonprofit status, tax deductible language, projects, events, products, locations, or stories.

## What Was Built

- Custom Shopify Online Store 2.0 theme scaffold
- Editorial homepage for Real World Needs
- Accessible global header and mobile navigation
- Guarded donation calls to action
- Guarded merchandise entry points
- Cart drawer and cart page
- Product and collection templates for Printify products imported into Shopify
- Stories blog and article templates
- Search, 404, and password templates
- Page templates for mission, transparency, legal, contact, clothing, volunteer, help, governance, financials, and policies
- Future project metaobject template for `rwn_project`
- Honest empty states for missing projects, stories, reports, events, locations, products, and filings
- Local audit scripts for links, JSON, and secrets
- Launch, legal, content model, route, and security documentation

## Theme Architecture

Core files:

- `layout/theme.liquid`
- `sections/rwn-header.liquid`
- `sections/rwn-footer.liquid`
- `sections/main-index.liquid`
- `sections/main-rwn-page.liquid`
- `sections/main-rwn-project.liquid`
- `assets/rwn.css`
- `assets/rwn.js`

Most standard pages use `sections/main-rwn-page.liquid` with a `page_role` setting configured by JSON templates.

## Content Architecture

See:

- `ROUTES.md`
- `CONTENT_MODEL.md`

Required Shopify objects before public launch are documented in `ROUTES.md`.

## Required Pages

Create Shopify pages with these handles and assign the matching templates:

- `about`
- `needs`
- `our-work`
- `programs`
- `how-it-works`
- `impact`
- `transparency`
- `financials`
- `donate`
- `give-clothing`
- `volunteer`
- `get-help`
- `contact`
- `faq`
- `governance`
- `leadership-board`
- `legal`
- `privacy-policy`
- `terms-of-use`
- `accessibility`
- `donation-policy`
- `donation-refund-policy`
- `shipping-policy`
- `return-policy`

## Required Blog

Create a blog named `Stories` with handle `stories`.

Do not publish demo posts as production stories.

## Required Collection

Create a collection named `Supporter Shop` with handle `supporter-shop`.

Assign Printify products to this collection only after product titles, images, variants, pricing, shipping, and returns have been reviewed.

## Configure Donations

Theme settings:

1. Add the global donation URL.
2. Enable `donations_enabled`.
3. Keep `tax_deductible_language_enabled` off unless legal review confirms the language.
4. Keep `tax_exempt_status_confirmed` off unless the status is verified.

If the donation URL is blank or donations are disabled, donation buttons do not render.

## Configure Printify Merchandise

1. Connect Printify to Shopify.
2. Import products into Shopify.
3. Review titles, descriptions, images, variants, pricing, shipping, and return terms.
4. Assign products to the `supporter-shop` collection.
5. Enable `merchandise_enabled` in theme settings.
6. Test cart and checkout through Shopify.

The theme does not alter Shopify checkout.

## Create Projects

Create a Shopify metaobject definition with type `rwn_project`.

Recommended fields are listed in `CONTENT_MODEL.md`.

Enable `projects_enabled` only when real project entries are ready for public display.

Project donation buttons require an individual project donation URL and will not render for completed, paused, or closed projects.

## Publish Expenses and Receipts

Use project fields or a related expense metaobject model.

Never publish:

- Personal donor information
- Payment data
- Private beneficiary information
- Private addresses
- Receipts that expose sensitive data

## Clothing Program

Enable `clothing_program_enabled` only when clothing information is ready.

The clothing page includes honest empty states for events, collection locations, and distribution locations until real information is published.

## Volunteer Opportunities

Enable `volunteer_applications_enabled` only when Real World Needs is ready to receive volunteer interest.

The form uses Shopify contact forms. Do not collect unnecessary sensitive information.

## Legal Review

See `LEGAL_LAUNCH_CHECKLIST.md`.

The theme does not claim legal compliance. It only provides editable structure and launch safety settings.

## Domain Setup

Connect domains in Shopify admin:

1. Go to Shopify admin.
2. Open Settings.
3. Open Domains.
4. Connect `RealWorldNeeds.org`.
5. Connect or redirect `RealWorldNeeds.com`.
6. Confirm SSL is active.
7. Confirm the canonical primary domain.

## GitHub Deployment

This repository can be connected to Shopify through Shopify GitHub integration or synced with Shopify CLI.

Recommended workflow:

1. Commit theme changes to GitHub.
2. Preview through Shopify.
3. Run Theme Check.
4. Test mobile, keyboard navigation, links, cart, product pages, forms, and policy pages.
5. Publish only after the public launch checklist is complete.

## Shopify Theme Syncing

In an environment with Shopify CLI:

```bash
shopify theme check
shopify theme dev
shopify theme push
```

This local Codex environment did not have Shopify CLI installed during the initial scaffold.

## Local Audits

Run:

```bash
npm run validate:json
npm run audit:links
npm run audit:secrets
```

Then run Shopify Theme Check in a Shopify CLI environment:

```bash
shopify theme check
```

## Rollback

Use GitHub history or Shopify theme versions to roll back to the last known good commit or published theme.

## Public Launch

Do not consider the site ready for public fundraising until `PUBLIC_LAUNCH_CHECKLIST.md` is complete.
