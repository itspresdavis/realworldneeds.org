# Security Notes

This theme does not implement custom payments, custom authentication, or custom checkout. Shopify handles checkout and payment security.

## What the theme avoids

- No custom credit card forms
- No stored payment data
- No hard coded access tokens
- No external JavaScript libraries
- No fake donation notifications
- No hidden recurring donation choices
- No unguarded placeholder links

## Configurable URLs

The global donation URL is public theme configuration. Do not store private API keys, webhook secrets, admin credentials, app tokens, or payment credentials in theme settings.

## Liquid output

Theme copy and settings are escaped where they render as plain text. Rich page and article content is rendered from Shopify managed content because administrators intentionally edit it in Shopify.

## External links

When adding external links to Shopify content, use trusted destinations and avoid unreviewed third party scripts. Add `rel="noopener noreferrer"` to manually authored external links that open in a new tab.

## Local audits

Run:

```bash
npm run audit:secrets
npm run audit:links
```

Also run Shopify Theme Check in an environment with Shopify CLI:

```bash
shopify theme check
```

## Security Review Required Before Public Launch

Review forms, donation processor links, Printify and Shopify apps, analytics, email marketing, cookies, customer data handling, beneficiary privacy, volunteer data, and public project documents before launch.
