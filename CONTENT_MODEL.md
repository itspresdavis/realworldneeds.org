# Real World Needs Content Model

## Pages

Create Shopify pages with the handles listed in `ROUTES.md`. Assign the matching theme template when available.

The theme is safe when pages are missing. Missing pages hide fallback navigation links and calls to action instead of producing dead routes.

## Blog

Create a blog named `Stories` with the handle `stories`.

Story tags may include:

- Real World Needs
- Project Update
- Completed Project
- Good in the World
- Community Story
- Field Note
- Guide

Do not publish demo articles as production content.

## Collection

Create a collection named `Supporter Shop` with the handle `supporter-shop`.

Printify products imported into Shopify should be assigned to this collection after titles, images, variants, prices, shipping, and return policy language are reviewed.

## Project Metaobject

Create a metaobject definition with type `rwn_project`.

Recommended fields:

- `unique_id`
- `title`
- `handle`
- `status`
- `category`
- `location`
- `country`
- `region`
- `coordinates`
- `short_summary`
- `full_story`
- `what_is_needed`
- `why_it_matters`
- `proposed_solution`
- `responsible_organization`
- `rwn_direct_status`
- `rwn_verified_status`
- `verification_notes`
- `funding_goal`
- `amount_raised`
- `amount_spent`
- `remaining_funds`
- `start_date`
- `expected_completion_date`
- `completion_date`
- `featured_image`
- `gallery`
- `videos`
- `donation_url`
- `external_partner_url`
- `updates`
- `expenses`
- `receipts`
- `outcome_metrics`
- `final_report`
- `current_status`
- `featured`
- `published`
- `emergency`
- `last_verified_date`

Recommended statuses:

- Being verified
- Open
- Funding
- Funded
- In progress
- Completed
- Paused
- Closed

Do not show project donation actions for completed, paused, or closed projects unless the theme logic is intentionally changed after review.

## Expenses

Use a separate metaobject definition for project expenses if expense data grows.

Recommended fields:

- `date`
- `project`
- `vendor`
- `description`
- `amount`
- `category`
- `receipt_document`
- `public_note`
- `private`

Never publish donor payment data, private beneficiary information, or private addresses.
