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
const multiwordAliases = [...new Set(aliases.values())].filter((alias) =>
  alias.includes(" "),
);
const noise = new Set(
  "a an the for to of please find finding need needs help free near nearby me my local around ayuda gratis cerca mi aide gratuit gratuite pres ajuda gratuito gratuita perto".split(
    " ",
  ),
);
const queries = new Map(),
  fields = new WeakMap();
const words = (value) => normalizeSearch(value).split(" ").filter(Boolean);
const prefix = (text, token) => ` ${text}`.includes(` ${token}`);
const whole = (text, token) => ` ${text} `.includes(` ${token} `);
// A completed specific need must not expand to every health/hygiene listing.
// Keep broad aliases above for category exploration and unfinished prefixes.
const specificNeeds = new Map();
for (const group of [
  "dental dentist dentists dentistry",
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
      (normalizeSearch(key).match(/[a-z]{1,2}\d[a-z\d]? \d[abd-hjlnp-uw-z]{2}(?= |$)|\S+/g) || [])
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
  return `${address}\n${[...new Set(tokens.flatMap((token) => [token, aliases.get(token) || token]))].filter((token) => !used.has(token)).join(" ")}\n${phrases}\n${needs}`;
}

export function prepareResourceSearch(resource) {
  let entry = fields.get(resource);
  if (!entry) {
    const search = resource.search ?? resourceSearchText(resource);
    const parts = search.split("\n");
    const country = String(resource.country || "").trim();
    const place = String(resource.place || "").trim();
    const countrySuffix = country ? `, ${country}` : "";
    // Sparse older indexes may provide only a display place. Infer its city
    // only when the final comma-separated country is actually known.
    const legacyCity = countrySuffix && place.toLowerCase().endsWith(countrySuffix.toLowerCase())
      ? place.slice(0, -countrySuffix.length)
      : "";
    entry = {
      address: parts.length > 1 ? parts[0] : "",
      phrases: parts[2] ?? null,
      needs: parts[3] || "",
      name: normalizeSearch(resource.name),
      city: normalizeSearch(resource.city ?? legacyCity),
      country: normalizeSearch(country),
      primary: resource.category,
      types: resource.categories || [
        resource.category,
        ...(resource.secondaryCategories || []),
      ],
      text: parts.slice(0, 3).join(" "),
    };
    fields.set(resource, entry);
  }
  return entry;
}

export function resourceSearchScore(resource, query) {
  const tokens = Array.isArray(query) ? query : querySearchTokens(query);
  if (!tokens.length) return 0;
  const entry = prepareResourceSearch(resource);
  if (entry.query === tokens) return entry.score;
  entry.query = tokens;
  let score = 0;
  for (const [literal, alias] of tokens) {
    const specific = specificNeeds.get(literal);
    const match = /^(wic|health|hygiene)$/.test(alias) ? whole : prefix;
    if (
      literal.includes(" ")
        ? !whole(entry.address || entry.text, literal)
        : specific
        ? !specific.some((term) => whole(entry.text, term))
        : !match(entry.text, literal) &&
          !(alias.includes(" ")
            ? whole(entry.phrases ?? entry.text, alias)
            : match(entry.text, alias))
    ) {
      entry.score = -1;
      return -1;
    }
    score +=
      specific
        ? whole(entry.needs, specific[0]) ? 40 : whole(entry.name, literal) ? 16 : 10
        : entry.primary === alias
        ? 40
        : entry.types.includes(alias)
          ? 30
          : entry.city === literal || entry.country === literal
            ? 24
            : whole(entry.name, literal)
              ? 16
              : whole(entry.text, literal)
                ? 10
                : prefix(entry.name, literal)
                  ? 8
                  : 2;
  }
  const phrase = tokens.map(([literal]) => literal).join(" ");
  // Whole multiword names and places beat coincidental combinations of words.
  score += entry.name === phrase ? 88 : whole(entry.name, phrase) ? 8 : 0;
  if (
    [entry.city, entry.country].some(
      (place) =>
        place &&
        tokens.every(
          ([literal, alias]) =>
            prefix(place, literal) ||
            whole(place, alias) ||
            specificNeeds.has(literal) ||
            entry.types.includes(alias),
        ) &&
        words(place).every((token) =>
          tokens.some(
            ([literal, alias]) =>
              literal === token || whole(alias, token),
          ),
        ),
    )
  )
    score += 40;
  if ((tokens.length > 1 || /\d/.test(phrase)) && prefix(entry.address, phrase))
    score += 32;
  entry.score = score;
  return score;
}
