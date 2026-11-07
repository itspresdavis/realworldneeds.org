// Public vocabulary only. Operational settings and credentials stay server-side.
export const CORRECTION_CATEGORIES = Object.freeze(
  [
    { value: "accessibility", label: "Website accessibility problem" },
    { value: "wrong-address", label: "Wrong address" },
    { value: "wrong-hours", label: "Wrong hours" },
    { value: "closed-service", label: "Closed service" },
    { value: "disconnected-phone", label: "Disconnected phone" },
    { value: "eligibility-change", label: "Eligibility change" },
    { value: "no-longer-free", label: "No longer free" },
    { value: "duplicate", label: "Duplicate listing" },
    { value: "broken-source", label: "Broken source" },
  ].map(Object.freeze),
);
export const MAX_CORRECTION_NOTE = 1000;
export const MAX_CORRECTION_REASON = 1000;
export const CORRECTION_STATUSES = Object.freeze([
  "open",
  "in-review",
  "ready",
  "applied",
  "resolved",
  "rejected",
  "duplicate",
]);
