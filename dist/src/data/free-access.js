export const freeAccessModels = Object.freeze({
  free: {
    label: "Free",
    shortLabel: "Free",
    description: "The services listed here are provided at no cost."
  },
  "free-eligible": {
    label: "Free with eligibility",
    shortLabel: "Eligibility applies",
    description: "There is no fee for people who qualify. Check the eligibility or referral requirements before you go."
  },
  "free-navigation": {
    label: "Free resource finder",
    shortLabel: "Resource finder",
    description: "This official search or referral service is free to use. Programs it lists may have their own eligibility or cost rules."
  },
  "free-option": {
    label: "Free option",
    shortLabel: "Free option",
    description: "The listed help is available without payment, although voluntary contributions may be welcome."
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
  return model ? (compact ? model.shortLabel : model.label) : "Cost not confirmed";
}
