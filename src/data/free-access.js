export const freeAccessModels = Object.freeze({
  free: {
    label: "Free service",
    shortLabel: "Free",
    description: "The listed core help is provided without a fee."
  },
  "free-eligible": {
    label: "Free if eligible",
    shortLabel: "Free if eligible",
    description: "There is no fee for approved participants, but eligibility, referral, or program rules apply."
  },
  "free-navigation": {
    label: "Free official navigation",
    shortLabel: "Free locator",
    description: "The official search, guidance, or referral is free. A linked provider may have separate eligibility or cost rules."
  },
  "free-option": {
    label: "Free option available",
    shortLabel: "Free option",
    description: "A person can receive the listed help without paying, even when voluntary contributions are welcomed."
  }
});

const ELIGIBILITY_LANGUAGE = /\b(approved|eligib\w*|qualif\w*|participant\w*|beneficiar\w*|referral|voucher|program(?: engagement| partners?)?|families who|age 18|18 and younger|18 and under)\b/i;
const FREE_LANGUAGE = /\bfree\b|\bno[- ]cost\b|\bwithout (?:a )?fee\b|\bwithout paying\b|including nothing/i;

export function inferFreeAccessModel(resource) {
  if (resource.costModel) {
    if (!freeAccessModels[resource.costModel]) throw new Error(`Unknown free-access model: ${resource.id}`);
    return resource.costModel;
  }
  if (resource.kind === "locator") return "free-navigation";
  if (/pay what you can, including nothing/i.test(resource.costNote)) return "free-option";
  if (FREE_LANGUAGE.test(resource.costNote) && ELIGIBILITY_LANGUAGE.test(`${resource.costNote} ${resource.accessType}`)) {
    return "free-eligible";
  }
  if (FREE_LANGUAGE.test(resource.costNote)) return "free";
  throw new Error(`${resource.id} does not have source-backed no-cost language.`);
}

export function withFreeAccess(resource) {
  return { ...resource, costModel: inferFreeAccessModel(resource) };
}

export function freeAccessLabel(resource, compact = false) {
  const model = freeAccessModels[resource.costModel];
  return model ? (compact ? model.shortLabel : model.label) : "Free access not verified";
}
