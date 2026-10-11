// One local matcher for the finder and text directory. Match word starts, never
// arbitrary interiors: WIC can match “WIC clinic”, but not “Norwich”.
export const normalizeSearch = (value) =>
  String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(?:[a-z]\.){2,}/g, (value) => value.replaceAll(".", ""))
    .replace(/['’]/g, "")
    .replace(/wi[\s-]?fi\b/g, "wifi")
    .replace(/[^a-z0-9+]+/g, " ")
    .trim();

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

export function querySearchTokens(query) {
  const key = String(query || "");
  if (!queries.has(key)) {
    if (queries.size >= 64) queries.delete(queries.keys().next().value);
    // Keep the literal term too: “Bed Road” must remain a valid address query.
    queries.set(
      key,
      words(key)
        .filter((token) => !noise.has(token))
        .map((token) => [token, aliases.get(token) || token]),
    );
  }
  return queries.get(key);
}

export function resourceSearchText(resource) {
  const types = [resource.category, ...(resource.secondaryCategories || [])];
  const tokens = words(
    [
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
      resource.kind,
      ...types,
    ].join(" "),
  );
  // Retain the address as an ordered phrase; deduplicate the remaining corpus.
  // The newline is a compact field boundary, compatible with older clients.
  const address = normalizeSearch(resource.address),
    used = new Set(words(address));
  return `${address}\n${[...new Set(tokens.flatMap((token) => [token, aliases.get(token) || token]))].filter((token) => !used.has(token)).join(" ")}`;
}

export function prepareResourceSearch(resource) {
  let entry = fields.get(resource);
  if (!entry) {
    const search = resource.search ?? resourceSearchText(resource);
    entry = {
      address: search.includes("\n")
        ? search.slice(0, search.indexOf("\n"))
        : "",
      name: normalizeSearch(resource.name),
      city: normalizeSearch(
        resource.city ??
          (resource.place === resource.country
            ? ""
            : resource.place?.slice(0, -(resource.country.length + 2))),
      ),
      country: normalizeSearch(resource.country),
      primary: resource.category,
      types: resource.categories || [
        resource.category,
        ...(resource.secondaryCategories || []),
      ],
      text: search.replace("\n", " "),
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
  let score = 0;
  for (const [literal, alias] of tokens) {
    if (
      !prefix(entry.text, literal) &&
      !alias.split(" ").every((token) => prefix(entry.text, token))
    ) {
      score = -1;
      break;
    }
    score +=
      entry.primary === alias
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
  if (score < 0) {
    entry.query = tokens;
    entry.score = score;
    return score;
  }
  const phrase = tokens.map(([literal]) => literal).join(" ");
  // Whole multiword names and places beat coincidental combinations of words.
  if (entry.name === phrase) score += 80;
  if (
    [entry.city, entry.country].some(
      (place) =>
        place &&
        tokens.every(
          ([literal, alias]) =>
            prefix(place, literal) ||
            whole(place, alias) ||
            entry.types.includes(alias),
        ) &&
        words(place).every((token) =>
          tokens.some(
            ([literal, alias]) =>
              literal === token || alias.split(" ").includes(token),
          ),
        ),
    )
  )
    score += 40;
  if (whole(entry.name, phrase)) score += 8;
  if ((tokens.length > 1 || /\d/.test(phrase)) && prefix(entry.address, phrase))
    score += 32;
  entry.query = tokens;
  entry.score = score;
  return score;
}
