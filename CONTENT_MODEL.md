# Real World Needs Content Model

## Pages

Use the handles documented in `ROUTES.md`. Assign each page its matching JSON template where available.

Missing pages are safe. The theme hides navigation links and calls to action when the destination does not exist.

## Blog

Create a blog named `Stories` with handle `stories`.

Recommended article tags:

- Real World Needs
- Good Around the World
- Project Update
- Completed Project
- Community
- Solutions
- People
- Field Notes

Articles support featured images, categories through tags, publication dates, reading time, long-form typography, pull quotes through rich text, image captions through Shopify image alt text, and related story states.

## Collection

Create a collection named `Supporter Shop` with handle `supporter-shop`.

Printify products imported into Shopify should be assigned to this collection after titles, images, variants, prices, shipping, and return policy language are reviewed.

## Project Metaobject

Create a metaobject definition with type `rwn_project`.

Recommended fields:

- `title`
- `project_id`
- `status`
- `category`
- `location`
- `country`
- `region`
- `short_summary`
- `full_story`
- `what_is_needed`
- `proposed_solution`
- `why_it_matters`
- `responsible_organization`
- `rwn_direct`
- `rwn_verified`
- `verification_information`
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
- `video`
- `updates`
- `expenses`
- `receipts`
- `outcome_metrics`
- `final_outcome`
- `final_report`
- `donation_url`
- `partner_url`
- `published`
- `featured`
- `last_updated_date`

Recommended statuses:

- Being Reviewed
- Verified
- Open
- Funding
- Funded
- In Progress
- Completed
- Paused
- Closed

Donation actions should not render for completed, funded, paused, or closed projects unless that behavior is intentionally changed after review.

## Expenses

Use a separate project expense metaobject if expense data grows.

Recommended fields:

- `date`
- `project`
- `vendor`
- `description`
- `amount`
- `category`
- `public_note`
- `receipt`
- `private`

Never publish donor payment data, private beneficiary information, private addresses, unredacted account numbers, or documents containing sensitive personal information.

## Theme Settings

Nontechnical administrators can control:

- Donation availability and URLs
- Legal and tax status language
- Charitable solicitation disclosures
- Public contact information
- Social links
- Default SEO description
- Social sharing image
- Homepage editorial images
- Project/story visibility toggles
- Volunteer and get-help form availability
