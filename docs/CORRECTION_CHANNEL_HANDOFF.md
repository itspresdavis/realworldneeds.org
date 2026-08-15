# Listing-Correction Channel Handoff

## Current public posture

RWN does **not** publish a correction form, mailbox, or service-provider claim route until the organization has assigned a monitored owner, response process, retention rule, and abuse controls. The public site must not imply that an unmonitored report will be received or acted on.

## Safe future implementation contract

When an approved endpoint and owner exist, every service page can add one restrained **Report a correction** action. It should prefill only public listing context: `resourceId`, listing title, canonical page URL, `sourceUrl`, and `lastChecked`. It must not prefill a visitor’s precise location, search query, saved services, or free-form narrative.

The reporting interface should offer bounded issue choices: closed service, incorrect hours, incorrect address, disconnected phone, no longer free, eligibility changed, duplicate listing, broken source, and other. The optional note should explicitly instruct visitors not to include health details, identification documents, payment information, or other sensitive personal information.

## Required owner decisions before release

| Decision | Required owner | Why it must be explicit |
| --- | --- | --- |
| Monitored endpoint and responsible role | RWN operations owner | A public contact path creates an expectation of receipt and response. |
| Retention and access control | Privacy/security owner with counsel review | Correction reports can contain personal or sensitive details despite guidance. |
| Rate limit and abuse handling | Engineering and operations | Public forms attract spam and malicious submissions. |
| Review SLA and status model | Directory operations owner | Reports must not automatically edit a verified public listing. |
| Provider verification policy | RWN editorial owner | A provider request or correction is evidence to review, not automatic authorization. |

## Non-negotiable safeguards

The future endpoint must use rate limiting, a low-friction bot mitigation appropriate to the threat level, server-side validation, audit logging that excludes unnecessary personal data, and a review queue. Reports should create review candidates only; they must never automatically alter a published service record. The public privacy notice, accessibility route, and transparency page must be updated in the same release once a monitored channel is established.
