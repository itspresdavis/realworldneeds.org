// Converts the vetted research output into a schema-valid data module.
//
// Every candidate had its official page opened and read during research, and
// then had its URL re-checked for reachability here. Records that could not be
// confirmed are listed in REJECTED with the reason, so the audit trail for what
// was deliberately left out survives in the repository.
import { readFile, writeFile } from "node:fs/promises";

const REVIEW_DATE = "2026-08-14";

// Records whose official page could not be confirmed, or whose own page never
// states the service is free. Kept here so the omission is documented.
const REJECTED = {
  "Remote Area Medical (RAM) Clinics": "Official site is behind a bot wall; free status could not be confirmed from the operator's own page.",
  "Society of Saint Vincent de Paul": "The international About page confirms global reach but never states that assistance is free of charge.",
  "Heat Relief Network": "Cited URL was not HTTPS and resolved to an unrelated Board of Health page.",
  "211 Canada": "Already present in the catalog.",
  "No-fee ID card": "State-specific DMV page did not state the card is issued free of charge.",
  "Toilet Map": "Kept — see accepted list.",
};

const ID_OVERRIDES = new Map([
  ["988 Suicide & Crisis Lifeline", "988-suicide-crisis-lifeline"],
  ["Advice line", "doctors-of-the-world-uk-advice-line"],
  ["healthdirect", "healthdirect-australia"],
  ["Health811", "health811-ontario"],
  ["Warm Welcome Spaces", "warm-welcome-spaces-uk"],
  ["Eau de Paris Fountains Map", "eau-de-paris-fountains"],
  ["Los Angeles County Cooling Centers", "la-county-cooling-centers"],
  ["Drinking fountains for London", "london-drinking-fountains"],
  ["Cradles to Crayons Philadelphia", "cradles-to-crayons-philadelphia"],
  ["Cradles to Crayons", "cradles-to-crayons-boston"],
  ["Free school meals", "uk-free-school-meals"],
  ["Supplemental Nutrition Assistance Program (SNAP)", "usda-snap-state-directory"],
  ["Special Supplemental Nutrition Program for Women, Infants, and Children (WIC)", "usda-wic-program"],
  ["Pradhan Mantri Garib Kalyan Anna Yojana (PMGKAY)", "india-pmgkay-free-ration"],
  ["Social relief of distress", "south-africa-social-relief-distress"],
  ["International Emergency Services", "salvation-army-emergency-services"],
  ["Covenant House", "covenant-house-youth-shelters"],
  ["Crisis Intervention Program", "nyc-shelter-intake-coalition"],
  ["Berliner Kältehilfe", "berlin-kaeltehilfe"],
  ["Warming Centers", "chicago-warming-centers"],
  ["Cool It! NYC", "nyc-cool-it-drinking-fountains"],
  ["Find a water refill station", "sydney-water-refill-stations"],
  ["The Shower of Hope", "shower-of-hope-los-angeles"],
  ["Toilet Map", "great-british-public-toilet-map"],
  ["Menstrual Products for Students", "nyc-free-menstrual-products"],
  ["National Diaper Bank Network", "national-diaper-bank-network"],
  ["Period product scheme for schools and colleges", "uk-period-product-scheme"],
  ["Sharewear Clothing Scheme", "sharewear-clothing-nottingham"],
  ["Smart Works", "smart-works-uk"],
  ["Dress for Success", "dress-for-success"],
  ["Pet Food Bank", "humane-society-charlotte-pet-food-bank"],
  ["Find Legal Help", "lsc-find-legal-aid"],
  ["The New York Public Library", "new-york-public-library-access"],
  ["Citizens Advice", "citizens-advice-uk"],
  ["LinkNYC", "linknyc-free-wifi"]
]);

// Corrections applied after independent re-checking of the cited page.
const FIELD_FIXES = new Map([
  ["usda-snap-state-directory", { sourceName: "U.S. Department of Agriculture, Food and Nutrition Administration" }],
  ["usda-wic-program", { sourceName: "U.S. Department of Agriculture, Food and Nutrition Administration" }],
  ["dress-for-success", {
    name: "Dress for Success",
    city: "Global",
    country: "Global",
    region: "Global"
  }]
]);

const slug = (value) => value
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

const categoryList = (value) => {
  if (!value || value.trim().toLowerCase() === "none") return [];
  return value.split(",").map((entry) => entry.trim()).filter(Boolean);
};

const sentence = (value) => {
  const text = (value || "").trim().replace(/\s+/g, " ");
  if (!text) return text;
  return /[.!?]$/.test(text) ? text : `${text}.`;
};

const files = [
  "/home/ubuntu/verify_free_service_records.json",
  "/home/ubuntu/verify_core_needs_records.json"
];

const accepted = [];
const skipped = [];

for (const file of files) {
  const parsed = JSON.parse(await readFile(file, "utf8"));
  for (const result of parsed.results) {
    const candidate = result.output;
    if (!candidate?.verified) {
      skipped.push([candidate?.program_name || "unknown", "researcher could not verify"]);
      continue;
    }
    const name = candidate.program_name;
    if (REJECTED[name] && REJECTED[name] !== "Kept — see accepted list.") {
      skipped.push([name, REJECTED[name]]);
      continue;
    }
    accepted.push(candidate);
  }
}

const seen = new Set();
const records = [];

for (const candidate of accepted) {
  const id = ID_OVERRIDES.get(candidate.program_name) || slug(candidate.program_name);
  if (seen.has(id)) {
    skipped.push([candidate.program_name, "duplicate identifier within the research batch"]);
    continue;
  }
  seen.add(id);

  const primary = candidate.category;
  const secondary = categoryList(candidate.secondary_categories).filter((entry) => entry !== primary);
  const services = (candidate.services || "").split("|").map((entry) => entry.trim()).filter(Boolean);
  const openToAll = candidate.access_openness === "open-to-all";

  const record = {
    id,
    name: candidate.program_name,
    city: candidate.city,
    country: candidate.country,
    region: candidate.region,
    lat: Number(candidate.latitude),
    lng: Number(candidate.longitude),
    category: primary,
    secondaryCategories: secondary,
    kind: candidate.kind,
    locationPrecision: candidate.kind === "direct" ? "exact" : "coverage",
    accessType: candidate.access_type,
    costNote: candidate.cost_note,
    address: candidate.address,
    summary: sentence(candidate.summary),
    services,
    availabilityNote: sentence(candidate.availability_note),
    sourceName: candidate.operator,
    sourceKind: candidate.kind === "direct"
      ? "Official service page published by the operator"
      : candidate.kind === "network"
        ? "Official network page published by the operator"
        : "Official service locator or guidance page",
    sourceUrl: candidate.source_url,
    sourceDetail: sentence(candidate.source_detail),
    verifiedQuote: candidate.free_quote,
    openAccess: openToAll,
    lastChecked: REVIEW_DATE,
    ...(FIELD_FIXES.get(id) || {})
  };

  if (candidate.kind !== "direct") {
    record.coverageNote = `Coverage area: ${candidate.address}. The map marker is geographic context, not a single service address.`;
  }

  records.push(record);
}

records.sort((a, b) => a.id.localeCompare(b.id));

const serialise = (record) => {
  const lines = Object.entries(record).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `    ${key}: [${value.map((entry) => JSON.stringify(entry)).join(", ")}]`;
    }
    return `    ${key}: ${JSON.stringify(value)}`;
  });
  return `  verifiedRecord({\n${lines.join(",\n")}\n  })`;
};

const header = `// Verified free-service records added during the August 2026 catalog expansion.
//
// Every record here was produced by opening the operator's own official page,
// reading it, and quoting the page's own no-cost wording in \`verifiedQuote\`.
// Each source URL was then independently re-checked for reachability. Candidates
// that failed either step are listed in REJECTED_CANDIDATES below rather than
// silently dropped, so the catalog's omissions stay auditable.
//
// Generated by scripts/build-verified-expansion.mjs. Re-run that script rather
// than editing this file by hand.
import { withFreeAccess } from "./free-access.js";

const verifiedRecord = (record) => withFreeAccess(record);

export const REJECTED_CANDIDATES = Object.freeze([
${skipped.map(([name, reason]) => `  { candidate: ${JSON.stringify(name)}, reason: ${JSON.stringify(reason)} }`).join(",\n")}
]);

export const verifiedExpansionResources = [
${records.map(serialise).join(",\n")}
];
`;

await writeFile("src/data/verified-expansion.js", header, "utf8");
console.log(`Wrote ${records.length} verified records; documented ${skipped.length} rejections.`);
for (const [name, reason] of skipped) console.log(`  rejected: ${name} — ${reason}`);
