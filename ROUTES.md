# Real World Needs Route Audit

This theme never renders intentional placeholder links, empty links, or script based dead links.

Visible calls to action are guarded by Shopify object existence and theme settings. If a destination does not exist, the control is hidden or replaced with an informational empty state.

| Route purpose | Expected Shopify object | Expected handle | Fallback behavior | Navigation source | Required before public launch |
| --- | --- | --- | --- | --- | --- |
| Home | Theme template | `/` | Always available | Header wordmark | Yes |
| Needs index | Page | `needs` | Header and CTAs hide if absent | Primary menu or fallback nav | Recommended |
| Our Work | Page | `our-work` | Header hides if absent | Primary menu or fallback nav | Recommended |
| Programs | Page | `programs` | Page template available but links hide if absent | Admin menu | No |
| How It Works | Page | `how-it-works` | CTAs hide if absent | Primary menu or fallback nav | Recommended |
| Impact | Page | `impact` | Page template available, no fake metrics | Admin menu | No |
| Transparency | Page | `transparency` | CTAs hide if absent | Primary menu or fallback nav | Recommended |
| Financials | Page | `financials` | Honest empty state | Footer | Recommended before fundraising |
| Donate | Page | `donate` | Donation actions hidden unless URL and setting are enabled | Admin menu | Required before fundraising |
| Give Clothing | Page | `give-clothing` | Clothing CTAs hidden unless enabled | Primary menu or fallback nav | Required before clothing launch |
| Volunteer | Page | `volunteer` | Form hidden unless enabled | Primary menu or fallback nav | Required before volunteer intake |
| Get Help | Page | `get-help` | Intake form hidden unless enabled | Footer or admin menu | Required before help intake |
| Contact | Page | `contact` | Contact form still works through Shopify | Footer | Recommended |
| FAQ | Page | `faq` | Honest starter state | Footer or admin menu | No |
| About | Page | `about` | Header hides if absent | Primary menu or fallback nav | Recommended |
| Leadership and Board | Page | `leadership-board` | No invented names | Admin menu | Required when public leadership is published |
| Governance | Page | `governance` | Honest empty state | Footer | Recommended |
| Privacy Policy | Page | `privacy-policy` | Starter language requires review | Footer | Required before launch |
| Terms of Use | Page | `terms-of-use` | Starter language requires review | Footer | Required before launch |
| Accessibility Statement | Page | `accessibility` | Starter language requires review | Footer | Required before launch |
| Donation Policy | Page | `donation-policy` | Starter language requires review | Footer | Required before fundraising |
| Donation Refund Policy | Page | `donation-refund-policy` | Starter language requires review | Footer | Required before fundraising |
| Shipping Policy | Page | `shipping-policy` | Starter language requires review | Footer | Required before merchandise launch |
| Merchandise Return Policy | Page | `return-policy` | Starter language requires review | Footer | Required before merchandise launch |
| Legal and Disclosures | Page | `legal` | Starter language requires review | Footer | Required before launch |
| Stories | Blog | `stories` | Story sections show honest empty state | Header if enabled | Required before stories launch |
| Supporter Shop | Collection | `supporter-shop` | Shop sections hide unless products exist and merchandise is enabled | Header if enabled | Required before merchandise launch |
| Product | Product object | Shopify product handle | No fake product pages | Collection/product routes | Required for merchandise launch |
| Project detail | Metaobject | `rwn_project` entry route | No donation button unless project URL exists and status permits | Needs index | Required before projects launch |
| Search | Theme template | `/search` | Shows useful no results state | Shopify route | No |
| Cart | Theme template | `/cart` | Shows empty cart state | Cart drawer | Required before merchandise launch |
| 404 | Theme template | Missing routes | Recovery links only render when valid | Shopify route | Yes |
| Password | Theme template | Password page | Shopify password form | Shopify route | Optional |

## Routing QA

Run:

```bash
npm run audit:links
```

Then preview the Shopify theme and manually test every visible header, footer, button, product, article, cart, and form route.
