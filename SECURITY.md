# Security Notes

This theme does not implement custom payments, custom authentication, or custom checkout. Shopify handles checkout and payment security.

## What the theme avoids

- No custom credit card forms
- No stored payment data
- No hard coded access tokens
- No external JavaScript libraries
- No invented donation notifications
- No hidden recurring donation choices
- No unguarded setup-only links
- No custom checkout logic
- No private donor, customer, or beneficiary data stored in theme files

## Review Areas

- XSS through rich content added in Shopify admin
- Unsafe configurable URLs in donation, partner, and social settings
- External links that open in new tabs without `rel="noopener noreferrer"`
- Public documents that include private donor, beneficiary, address, payment, or account data
- Third party Shopify apps that inject scripts
- Analytics, cookies, and email marketing behavior
- Sensitive console logging in any future JavaScript
- Project receipts that need redaction before publication

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
