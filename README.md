# Real World Needs Shopify Theme

Production Shopify theme for Real World Needs.

Primary domain: `RealWorldNeeds.org`

Secondary domain: `RealWorldNeeds.com`

This repository is the source of truth for the website theme. Shopify remains the system of record for products, Printify fulfillment, inventory, checkout, orders, customers, payments, and store data.

## What This Theme Is

Real World Needs is presented as a new organization with a serious long-term vision. The theme is built around the message:

Real problems. Real solutions.

The site is designed to explain the organization, begin with donated clothing, prepare a transparent project system, publish Stories, and sell mission-related merchandise through native Shopify products.

## Core Theme Files

- `layout/theme.liquid`
- `layout/password.liquid`
- `sections/rwn-header.liquid`
- `sections/rwn-footer.liquid`
- `sections/main-index.liquid`
- `sections/main-rwn-page.liquid`
- `sections/main-rwn-project.liquid`
- `sections/main-blog.liquid`
- `sections/main-article.liquid`
- `sections/main-collection.liquid`
- `sections/main-product.liquid`
- `assets/rwn-base.css`
- `assets/rwn-home.css`
- `assets/rwn-pages.css`
- `assets/rwn-responsive.css`
- `assets/rwn.js`

Most static pages use `sections/main-rwn-page.liquid` with a `page_role` configured in the matching JSON template.

## Shopify Admin Setup

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

Create a blog named `Stories` with handle `stories`.

Create a collection named `Supporter Shop` with handle `supporter-shop`.

## Navigation

Navigation should primarily be managed through Shopify menus.

If no primary menu is selected, the theme renders a guarded fallback navigation. Important links point to working homepage sections until the matching Shopify page exists. Once a page is created, the same control automatically uses the page URL.

## Images

Homepage images can be replaced in the Shopify theme editor. The repository includes licensed editorial fallback images so the theme never renders empty image boxes.

Image sources and licenses are documented in `IMAGE_SOURCES.md`.

Use editorial photography only as context. Captions must say when an image is not Real World Needs work. Replace editorial images with approved Real World Needs photography as soon as real documentation exists.

## Projects

Create a Shopify metaobject definition with type `rwn_project`.

The project template supports status, category, location, verification information, responsible organization, RWN Direct, RWN Verified, funding fields, dates, updates, expenses, receipts, outcomes, donation URL, partner URL, and final reporting fields.

Enable `projects_enabled` only when real project entries are ready.

Project donation buttons render only when the project has a donation URL and the status allows support.

Project updates and public expenses should be separate referenced metaobjects when the record grows. Review every receipt, photograph, and document for private information before publishing it.

## Stories

Use Shopify's native blog system.

The recommended blog is `Stories` with handle `stories`.

Suggested categories can be managed as article tags:

- Real World Needs
- Good Around the World
- Project Update
- Completed Project
- Community
- Solutions
- People
- Field Notes

Only publish real articles, updates, or editorial pieces that are ready for public viewing.

Article featured images, author names, dates, excerpts, tags, and source links come from Shopify. The theme calculates reading time and builds related Story links automatically.

## Printify and Merchandise

Printify products should be imported into Shopify normally.

Recommended workflow:

1. Connect Printify to Shopify.
2. Import products into Shopify.
3. Review product titles, descriptions, images, variants, pricing, shipping, and returns.
4. Assign approved products to the `supporter-shop` collection.
5. Test product pages, cart, checkout, shipping, taxes, and fulfillment.

The theme does not modify Shopify checkout or Printify fulfillment.

Homepage merchandise stays hidden until the configured collection contains a published product. Collection, product, variant, inventory, cart, and checkout behavior use Shopify objects rather than hard coded merchandise.

## Donations

Donation calls to action are controlled by theme settings:

- `donations_enabled`
- `donation_url`
- `monthly_donation_url`
- `donation_processor_name`
- `donation_receipt_information`

Donation buttons do not render when donations are disabled or the relevant URL is blank.

Do not enable tax deductibility language until legal status and required disclosures are verified.

## Legal Status

Configure legal and trust language in theme settings:

- Legal organization name
- Organization status
- Federal tax status
- Tax deductibility status
- Charitable solicitation disclosures
- State disclosures
- Donation processor
- Public mailing address
- Public email
- Public phone

See `LEGAL_LAUNCH_CHECKLIST.md` before launch.

## Theme Editor

The homepage section exposes editable headline, introduction, hero image, clothing image, Stories image, and alt text settings. Global settings control donation availability, program visibility, newsletter availability, public contact details, legal status, social accounts, and default sharing imagery.

Navigation is managed in Shopify menus. Products, articles, pages, and project metaobjects are managed in Shopify. Theme structure, styling, Liquid, JavaScript, and fallback content are managed only in this repository.

## Transparency Updates

Add project status, verification, dates, funding figures, updates, expenses, photographs, outcome information, and a final report to the matching `rwn_project` entry. Publish only reviewed fields. The Transparency page counts real public project records and keeps every unsupported category in an honest empty state.

## Production Workflow

Do not use Shopify's GitHub integration, GitHub Actions, or ZIP uploads for normal updates.

Permanent workflow:

1. Edit the theme in this repository.
2. Validate locally.
3. Commit and push to GitHub.
4. Deploy the same repository code to the existing Shopify theme with Shopify CLI.
5. Do not overwrite the repository with Shopify's remote theme.
6. Do not create a new Shopify theme for routine updates.

There is no two way Shopify and GitHub sync. Shopify's GitHub integration is intentionally not used. GitHub stores the authoritative code and version history. Shopify CLI sends that tested code to the saved live theme ID. Theme code edited in Shopify Admin is not pulled back and may be overwritten by the next repository deployment.

Production target:

- Store: `f7gmze-fa.myshopify.com`
- Theme name: `Real World Needs`
- Theme ID: `141693190207`
- Config: `shopify.theme.toml`

## Validation

Run:

```bash
npm run validate:json
npm run audit:links
npm run audit:secrets
npm run theme:check
```

Deployment command:

```bash
npm run theme:deploy
```

Codex runs these commands as part of every finished website change. Administrators can use Shopify's theme preview controls to review the deployed theme and should test at least one real product through cart and checkout before a merchandise launch.

## Rollback

Use GitHub history to identify the last known good commit. Deploy that commit back to the saved production theme ID with Shopify CLI.

Do not pull the live theme over the repository during rollback. Check out the known good GitHub revision, validate it, and push that revision to theme `141693190207`.

## Further Documentation

- `ROUTES.md` for page and object routes
- `CONTENT_MODEL.md` for Shopify content structures
- `IMAGE_SOURCES.md` for image provenance and licenses
- `SEO.md` for metadata, structured data, and editorial growth
- `SECURITY.md` for the storefront security boundary
- `LEGAL_LAUNCH_CHECKLIST.md` for legal review items
- `PUBLIC_LAUNCH_CHECKLIST.md` for final launch verification
