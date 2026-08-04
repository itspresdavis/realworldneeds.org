export const platformStatus = {
  donationProcessingEnabled: false,
  publicNeedIntakeEnabled: false,
  partnerPortalEnabled: false,
  managedNeedsPublished: 0,
  managedFundsPublished: 0,
  statusNote:
    "RWN does not currently solicit or process contributions through this site."
};

export const supportStages = [
  {
    id: "intake",
    label: "Intake",
    description: "Receive a need without exposing private details."
  },
  {
    id: "verify",
    label: "Verify",
    description: "Confirm the organization, scope, urgency, and evidence."
  },
  {
    id: "allocate",
    label: "Allocate",
    description: "Assign restricted or flexible funds to an approved need."
  },
  {
    id: "deliver",
    label: "Deliver",
    description: "Record procurement, transfer, shipment, or service."
  },
  {
    id: "prove",
    label: "Prove",
    description: "Publish receipts, outcomes, remaining balance, and review."
  }
];

export const controlPoints = [
  ["Identity & safeguarding", "Required before public case details"],
  ["Conflict review", "Required before approval"],
  ["Restricted-fund match", "Required before allocation"],
  ["Receipt or delivery evidence", "Required before closeout"],
  ["Audit event", "Written for every material change"]
];

export const allocationFields = [
  ["Designation", "Restricted need or flexible response"],
  ["Payment record", "Processor reference and receipt"],
  ["Use of funds", "Allocation, disbursement, and remaining balance"],
  ["Evidence", "Receipt, delivery record, review, and correction history"]
];

export const launchGates = [
  ["Legal identity", "Entity, jurisdiction, public contact, and tax status"],
  ["Financial controls", "Banking, processor, authorization, refunds, and reconciliation"],
  ["Program controls", "Need verification, partner review, restricted funds, and closeout"],
  ["Public accountability", "Privacy, safeguarding, complaints, corrections, and reporting"]
];

export const publicLedger = [];

export const ledgerColumns = [
  "Need",
  "Responsible organization",
  "Verified",
  "Committed",
  "Disbursed",
  "Delivery evidence",
  "Last reviewed"
];

