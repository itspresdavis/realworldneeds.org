// One local matcher for the finder and text directory. Match word starts, never
// arbitrary interiors. Completed WIC is a known program intent, so only its
// exact token matches; shorter Wi and explicit Wick keep normal prefix behavior.
export const normalizeSearch = (value) =>
  String(value || "")
    .normalize("NFKD")
    // Keep accent-insensitive Latin searches without erasing meaningful marks
    // in other scripts (for example Ukrainian ї or Indic vowel signs).
    .replace(/(\p{Script=Latin})[\u0300-\u036f]+/gu, "$1")
    .toLowerCase()
    .replace(/\b(?:[a-z]\.){2,}/g, (value) => value.replaceAll(".", ""))
    .replace(/['’]/g, "")
    .replace(/wi[\s-]?fi\b/g, "wifi")
    .replace(/\bfood[\s-]+bank(s?)\b/g, "foodbank$1")
    .replace(/[^\p{L}\p{N}\p{M}+]+/gu, " ")
    .trim()
    // Split only a complete, bounded UK postcode-shaped token. Partial codes,
    // ZIPs and ordinary word prefixes retain their existing search behavior.
    .replace(/(^| )([a-z]{1,2}\d[a-z\d]?)(\d[abd-hjlnp-uw-z]{2})(?= |$)/g, "$1$2 $3");

const aliases = new Map();
for (const group of [
  "food meal meals pantry pantries groceries grocery hunger comida comidas alimento alimentos nourriture repas foood",
  "water drink drinking refill hydration agua eau watre",
  "shelter housing homeless homelessness bed refuge albergue refugio alojamiento abrigo abri shleter sheltor",
  "hygiene shower showers laundry toilet toilets toiletries ducha duchas bano banos lavanderia banho douche douches hygene",
  "clothing clothes coat coats shoes blanket blankets ropa roupas vetement vetements clohtes",
  "health doctor doctors clinic clinics dental dentist medical mental healthcare salud saude sante medico medica clinica clinique",
  "referral directory directories locator navigation benefits advice casework",
  "diaper diapers",
  "charging chargers charger",
]) {
  const [need, ...words] = group.split(" ");
  for (const word of words) aliases.set(word, need);
}
aliases.set("nyc", "new york city");
// These are explicit user-supplied country qualifiers, never an inferred
// visitor location. Keep them separate from service synonym expansion.
const countryQualifier = (term) => /^(uk|gb|gbr|united kingdom)$/.test(term) ? "united kingdom"
  : /^(us|usa|united states(?: of america)?)$/.test(term) ? "united states" : "";
const stateNames = /* @__PURE__ */ (() => new Map(`AL:Alabama|AK:Alaska|AZ:Arizona|AR:Arkansas|CA:California|CO:Colorado|CT:Connecticut|DE:Delaware|DC:District of Columbia|FL:Florida|GA:Georgia|HI:Hawaii|ID:Idaho|IL:Illinois|IN:Indiana|IA:Iowa|KS:Kansas|KY:Kentucky|LA:Louisiana|ME:Maine|MD:Maryland|MA:Massachusetts|MI:Michigan|MN:Minnesota|MS:Mississippi|MO:Missouri|MT:Montana|NE:Nebraska|NV:Nevada|NH:New Hampshire|NJ:New Jersey|NM:New Mexico|NY:New York|NC:North Carolina|ND:North Dakota|OH:Ohio|OK:Oklahoma|OR:Oregon|PA:Pennsylvania|RI:Rhode Island|SC:South Carolina|SD:South Dakota|TN:Tennessee|TX:Texas|UT:Utah|VT:Vermont|VA:Virginia|WA:Washington|WV:West Virginia|WI:Wisconsin|WY:Wyoming`
  .toLowerCase().split("|").map((state) => state.split(":"))))();
// Do not turn ordinary words, unfinished Wi/WIC, or a single ambiguous token
// into a location constraint. Full single-word state names remain available.
const stateCodes = /^(?:a[klrz]|c[aot]|dc|fl|ga|i[al]|k[sy]|m[adinost]|n[cdehjmvy]|oh|pa|ri|s[cd]|t[nx]|ut|v[at]|w[avy])$/;
function searchRegions(value, country) {
  if (normalizeSearch(country) !== "united states") return [];
  const address = normalizeSearch(value);
  const postalState = address.match(/(?:^| )([a-z]{2}) +\d{5}(?: |$)/)?.[1];
  if (postalState && stateNames.has(postalState)) return [postalState];
  // Full states must be components/endings, not a prefix like Massachusetts
  // Avenue. This is derived address evidence, never a new coverage claim.
  const components = String(value || "").split(/[,;]|\band\b/i).map(normalizeSearch);
  return [...stateNames].filter(([, name]) => components.some((part) =>
    part === name || part.endsWith(` ${name}`))).map(([code]) => code);
}
const multiwordAliases = /* @__PURE__ */ (() => [...new Set(aliases.values())].filter((alias) =>
  alias.includes(" "),
))();
const noise = new Set(
  "a an the for to of please find finding need needs help free near nearby me my local around ayuda gratis cerca mi aide gratuit gratuite pres ajuda gratuito gratuita perto".split(
    " ",
  ),
);
const queries = new Map();
const words = (value) => normalizeSearch(value).split(" ").filter(Boolean);
const prefix = (text, token) => ` ${text}`.includes(` ${token}`);
const whole = (text, token) => ` ${text} `.includes(` ${token} `);
// A completed specific need must not expand to every health/hygiene listing.
// Keep broad aliases above for category exploration and unfinished prefixes.
const specificNeeds = new Map();
for (const group of [
  "dental dentist dentists dentistry",
  "pantry pantries foodbank foodbanks",
  "mental",
  "shower showers ducha duchas douche douches",
  "laundry lavanderia",
]) {
  const terms = group.split(" ");
  for (const term of terms) specificNeeds.set(term, terms);
}

export function querySearchTokens(query) {
  const key = String(query || "");
  if (!queries.has(key)) {
    if (queries.size >= 64) queries.delete(queries.keys().next().value);
    // Keep the literal term too: “Bed Road” must remain a valid address query.
    queries.set(
      key,
      // Keep complete postcodes together so NR2 1RF cannot match NR23 1RF.
      // Every other term retains ordinary word-prefix behavior.
      (normalizeSearch(key).match(/united states of america\b|united states\b|united kingdom\b|[a-z]{1,2}\d[a-z\d]? \d[abd-hjlnp-uw-z]{2}(?= |$)|\S+/g) || [])
        .filter((token) => !noise.has(token))
        .map((token) => [token, aliases.get(token) || token]),
    );
  }
  return queries.get(key);
}

export function resourceSearchText(resource) {
  const types = [resource.category, ...(resource.secondaryCategories || [])];
  const values = [
    resource.name,
    resource.city,
    resource.country,
    resource.region,
    resource.address,
    resource.sourceName,
    resource.summary,
    ...(resource.services || []),
    resource.accessType,
    resource.costNote,
    resource.coverageNote,
    ...(resource.locationPrecision === "contact-only" ? [resource.eligibility, resource.phoneAccess, "phone online contact"] : []),
    resource.kind,
    ...types,
  ];
  const text = normalizeSearch(values.join(" "));
  const tokens = text.split(" ");
  // Preserve true multiword aliases before deduplication. “New York” in the
  // source and “City” in a different town must not combine into NYC.
  const phrases = multiwordAliases
    .filter(
      (alias) =>
        whole(text, alias) &&
        values.some((value) => whole(normalizeSearch(value), alias)),
    )
    .join(" | ");
  // Retain the address as an ordered phrase; deduplicate the remaining corpus.
  // The newline is a compact field boundary, compatible with older clients.
  const address = normalizeSearch(resource.address),
    used = new Set(words(address));
  // A compact, derived ranking hint, never a provider claim. Keep contextual
  // mentions searchable; no/not/without contexts do not receive a service boost.
  // This is lexical evidence, not availability or general negation inference.
  const evidence = words([resource.summary, ...(resource.services || [])]
    .filter((text) => !/\b(no(?![- ]cost\b)|not|without)\b/i.test(text))
    .join(" "));
  const needs = [...new Set(evidence.flatMap((term) => specificNeeds.get(term)?.[0] || []))].join(" ");
  return `${address}\n${[...new Set(tokens.flatMap((token) => [token, aliases.get(token) || token]))].filter((token) => !used.has(token)).join(" ")}\n${phrases}\n${needs}\n${searchRegions(resource.address, resource.country).flatMap((code) => [code, ...(stateNames.get(code).includes(" ") ? [] : [stateNames.get(code)])]).join(" ")}`;
}

function createSearchMatcher(compileSearch, legacyRegions) {
const fields = new WeakMap();
function prepareResourceSearch(resource) {
  let entry = fields.get(resource);
  if (!entry) {
    const search = resource.search ?? compileSearch(resource);
    const parts = search.split("\n");
    const country = String(resource.country || "").trim();
    const address = parts.length > 1 ? parts[0] : normalizeSearch(resource.address);
    const regions = parts[4] !== undefined ? parts[4].split(" ").filter(Boolean)
      : legacyRegions(resource.address || address, country);
    const place = String(resource.place || "").trim();
    // Sparse older indexes may provide only a display place. Infer its city
    // only when the final comma-separated country is actually known.
    const legacyCity = country && place.toLowerCase().endsWith(`, ${country.toLowerCase()}`)
      ? place.slice(0, -country.length - 2)
      : "";
    // Internal slots keep the compact matcher small. The public preparation
    // helper below still exposes named fields to its existing callers.
    entry = [address, regions, parts[2] ?? null, parts[3] || "",
      normalizeSearch(resource.name), normalizeSearch(resource.city ?? legacyCity),
      normalizeSearch(country), resource.category,
      resource.categories || [resource.category, ...(resource.secondaryCategories || [])],
      parts.slice(0, 3).join(" ")];
    fields.set(resource, entry);
  }
  return entry;
}

function resourceSearchScore(resource, query) {
  const tokens = Array.isArray(query) ? query : querySearchTokens(query);
  if (!tokens.length) return 0;
  const entry = prepareResourceSearch(resource);
  if (entry[10] === tokens) return entry[11];
  entry[10] = tokens;
  const [address, regions, phrases, needs, name, city, resourceCountry, primary, types, searchText] = entry;
  let score = 0;
  for (const [literal, alias] of tokens) {
    const specific = specificNeeds.get(literal);
    const country = countryQualifier(literal);
    const region = tokens.length > 1 && stateCodes.test(literal);
    const regionMatch = tokens.length > 1 && regions.includes(literal);
    const match = /^(wic|health|hygiene)$/.test(alias) ? whole : prefix;
    if (
      country
        ? resourceCountry !== country
        : region
        ? !regionMatch
        : regionMatch ? false
        : literal.includes(" ")
        ? !whole(address || searchText, literal)
        : specific
        ? !specific.some((term) => whole(searchText, term))
        : !match(searchText, literal) &&
          !(alias.includes(" ")
            ? whole(phrases ?? searchText, alias)
            : match(searchText, alias))
    ) {
      return entry[11] = -1;
    }
    score +=
      country || regionMatch ? 24
        : specific
        ? whole(needs, specific[0]) ? 40 : whole(name, literal) ? 16 : 10
        : primary === alias
        ? 40
        : types.includes(alias)
          ? 30
          : city === literal || resourceCountry === literal
            ? 24
            : whole(name, literal)
              ? 16
              : whole(searchText, literal)
                ? 10
                : prefix(name, literal)
                  ? 8
                  : 2;
  }
  const phrase = tokens.map(([literal]) => literal).join(" ");
  // Whole multiword names and places beat coincidental combinations of words.
  score += name === phrase ? 88 : whole(name, phrase) ? 8 : 0;
  if (
    [city, resourceCountry].some(
      (place) =>
        place &&
        tokens.every(
          ([literal, alias]) =>
            prefix(place, literal) ||
            whole(place, alias) ||
            countryQualifier(literal) === resourceCountry ||
            (tokens.length > 1 && regions.includes(literal)) ||
            specificNeeds.has(literal) ||
            types.includes(alias),
        ) &&
        place.split(" ").every((token) =>
          tokens.some(
            ([literal, alias]) =>
              literal === token || whole(alias, token),
          ),
        ),
    )
  )
    score += 40;
  if ((tokens.length > 1 || /\d/.test(phrase)) && prefix(address, phrase))
    score += 32;
  return entry[11] = score;
}

return { prepare: prepareResourceSearch, score: resourceSearchScore };
}

// The directory receives compact, generated records. Its self-contained bundle
// can omit raw catalog preparation and still read older compact index releases.
export function createIndexedSearchMatcher() {
  return createSearchMatcher(() => "", (address, country) =>
    normalizeSearch(country) === "united states"
      ? [address.match(/(?:^| )([a-z]{2}) +\d{5}(?: |$)/)?.[1]].filter(Boolean) : []);
}
const sourceMatcher = /* @__PURE__ */ createSearchMatcher(resourceSearchText, searchRegions);
export const prepareResourceSearch = (resource) => {
  const [address, regions, phrases, needs, name, city, country, primary, types, text, query, score] = sourceMatcher.prepare(resource);
  return { address, regions, phrases, needs, name, city, country, primary, types, text, query, score };
};
export const resourceSearchScore = (resource, query) => sourceMatcher.score(resource, query);
export const searchGeographyChoices = (resourceList, query) => geographyChoicesForSource(resourceList, query);

// UI guidance uses only explicit city evidence among the already filtered
// results. It never picks a default country or overrides a manual location.
function geographyChoicesForSource(resourceList, query) {
  const tokens = querySearchTokens(query);
  const city = tokens.filter(([literal, alias]) => !specificNeeds.has(literal)
    && !["food", "water", "shelter", "hygiene", "clothing", "health", "referral"].includes(alias))
    .map(([literal]) => literal).join(" ");
  if (!city) return [];
  const places = new Map();
  for (const resource of resourceList) {
    const entry = sourceMatcher.prepare(resource);
    if (entry[5] !== city || !entry[6] || sourceMatcher.score(resource, tokens) < 0) continue;
    places.set(entry[6], { city: resource.city || resource.place?.slice(0, -(String(resource.country).length + 2)), country: resource.country });
  }
  return places.size < 2 ? [] : [...places.values()].sort((a, b) => a.country.localeCompare(b.country));
}
