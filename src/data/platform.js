export const platformStatus = {
  // Requires the operational and hosted acceptance gates in CORRECTION_CHANNEL_HANDOFF.md.
  // Keep source-controlled so reproducible builds never silently activate intake links.
  publicCorrectionLinksEnabled: false,
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
    label: "Receive",
    description: "Record the need without publishing private details."
  },
  {
    id: "verify",
    label: "Review",
    description: "Confirm who is asking, what is needed, how urgent it is, and what evidence exists."
  },
  {
    id: "allocate",
    label: "Approve",
    description: "Document the decision, budget, restrictions, and responsible organization."
  },
  {
    id: "deliver",
    label: "Deliver",
    description: "Record the purchase, transfer, shipment, or service provided."
  },
  {
    id: "prove",
    label: "Report",
    description: "Publish receipts, delivery evidence, remaining balance, outcomes, and corrections."
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
