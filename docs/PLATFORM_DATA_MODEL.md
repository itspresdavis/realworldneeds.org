# RWN Platform Data Model

This document defines the minimum record structure for a future RWN operational backend. It is a contract, not a claim that these systems are live.

## Core Records

- `resource`: official source, source type, direct/locator/network kind, address or coverage, coordinates, service layers, access method, cost note, availability warning, review date, and reviewer.
- `organization`: legal name, jurisdiction, registration evidence, public contact, safeguarding status, bank/payment beneficiary status, verification dates, and reviewers.
- `need`: responsible organization, private intake reference, public summary, location precision, category, urgency, requested amount or goods, restrictions, evidence, review state, and expiry.
- `verification`: subject, reviewer, evidence references, decision, reason, conflicts, timestamps, and superseded decision.
- `allocation`: contribution designation, approved need, authorized amount, currency, restriction, approvers, and remaining balance.
- `disbursement`: allocation, recipient, payment/procurement/shipment reference, amount, currency, authorization, processor status, and reconciliation state.
- `delivery`: responsible organization, service or goods delivered, quantity where supportable, location precision, delivery date, and evidence references.
- `evidence`: type, private storage reference, public redaction, issuer, date, reviewer, and retention class.
- `audit_event`: actor, action, subject, previous value reference, new value reference, reason, timestamp, and immutable event ID.
- `correction`: affected public statement, reason, corrected value, approver, published date, and linked audit events.

## Required Invariants

1. A need cannot be published before identity, safeguarding, scope, and evidence review.
2. An allocation cannot exceed the verified amount or violate a donor restriction.
3. A disbursement requires authorization and a processor, procurement, or shipment reference.
4. A case cannot close without delivery evidence, remaining-balance treatment, and review.
5. Every material change writes an append-only audit event.
6. Public records never expose beneficiary identity, exact sensitive locations, or unredacted evidence.
7. Corrections remain visible and link to the record they replace.
8. A resource address cannot imply walk-in access when the official source describes a locator, referral, or partner network.
9. Every public resource retains its official source, access conditions, and last-reviewed date.

## Future Backend Boundary

The static site should read only publishable, redacted records. Private intake, identity evidence, payment details, and internal safeguarding notes belong behind authenticated role-based access with field-level authorization, retention rules, backups, and audit logging.
