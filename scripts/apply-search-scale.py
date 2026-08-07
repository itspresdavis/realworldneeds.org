from pathlib import Path

path = Path("src/utils/geo.js")
text = path.read_text()


def replace_once(old, new, label):
    global text
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected one source block, found {count}")
    text = text.replace(old, new, 1)

replace_once(
    '''function resourceSearchFields(resource) {
  const types = [resource.category, ...(resource.secondaryCategories || [])];
  const services = Array.isArray(resource.services) ? resource.services : [];
  const fields = {
    name: normalizedText(resource.name),
    place: normalizedText([resource.city, resource.country, resource.region, resource.address].join(" ")),
    source: normalizedText(resource.sourceName),
    detail: normalizedText([
      resource.summary,
      services.join(" "),
      resource.accessType,
      resource.costNote,
      resource.coverageNote,
      resource.kind,
      ...types,
      ...types.map((type) => resourceTypes.includes(type) ? type : "")
    ].join(" "))
  };
  fields.all = `${fields.name} ${fields.place} ${fields.source} ${fields.detail}`;
  fields.tokens = new Set(searchTokens(fields.all));
  return fields;
}

export function resourceSearchScore(resource, query) {
  const tokens = searchTokens(query);''',
    '''const resourceSearchFieldCache = new WeakMap();
const queryTokenCache = new Map();
const QUERY_TOKEN_CACHE_LIMIT = 64;

function resourceSearchFields(resource) {
  const cached = resourceSearchFieldCache.get(resource);
  if (cached) return cached;
  const types = [resource.category, ...(resource.secondaryCategories || [])];
  const services = Array.isArray(resource.services) ? resource.services : [];
  const fields = {
    name: normalizedText(resource.name),
    place: normalizedText([resource.city, resource.country, resource.region, resource.address].join(" ")),
    source: normalizedText(resource.sourceName),
    detail: normalizedText([
      resource.summary,
      services.join(" "),
      resource.accessType,
      resource.costNote,
      resource.coverageNote,
      resource.kind,
      ...types,
      ...types.map((type) => resourceTypes.includes(type) ? type : "")
    ].join(" "))
  };
  fields.all = `${fields.name} ${fields.place} ${fields.source} ${fields.detail}`;
  fields.tokens = new Set(searchTokens(fields.all));
  resourceSearchFieldCache.set(resource, fields);
  return fields;
}

function cachedQueryTokens(query) {
  const key = normalizedText(query);
  const cached = queryTokenCache.get(key);
  if (cached) return cached;
  const tokens = searchTokens(key);
  if (queryTokenCache.size >= QUERY_TOKEN_CACHE_LIMIT) {
    queryTokenCache.delete(queryTokenCache.keys().next().value);
  }
  queryTokenCache.set(key, tokens);
  return tokens;
}

export function resourceSearchScore(resource, query) {
  const tokens = cachedQueryTokens(query);''',
    "search field and query cache",
)

replace_once(
    '''export function rankResourcesForLocation(resourceList, userLocation, userCountry = "", query = "") {
  const country = normalizedText(userCountry);
  const rank = (resource) => {
    const exact = isExactServiceSite(resource);
    const distance = resourceDistanceKm(userLocation, resource);
    const sameCountry = Boolean(country && normalizedText(resource.country) === country);
    const globalCoverage = !exact && ["global", "worldwide"].includes(normalizedText(resource.country));
    let tier = 5;
    if (exact && distance <= 250) tier = 0;
    else if (!exact && sameCountry) tier = 1;
    else if (exact && sameCountry) tier = 2;
    else if (globalCoverage) tier = 3;
    else if (exact) tier = 4;
    return { tier, distance: distance ?? Number.POSITIVE_INFINITY, score: resourceSearchScore(resource, query) };
  };

  return [...resourceList].sort((left, right) => {
    const a = rank(left);
    const b = rank(right);
    return a.tier - b.tier
      || b.score - a.score
      || a.distance - b.distance
      || left.name.localeCompare(right.name);
  });
}''',
    '''export function rankResourcesForLocation(resourceList, userLocation, userCountry = "", query = "") {
  const country = normalizedText(userCountry);
  const ranked = resourceList.map((resource) => {
    const exact = isExactServiceSite(resource);
    const distance = resourceDistanceKm(userLocation, resource);
    const sameCountry = Boolean(country && normalizedText(resource.country) === country);
    const globalCoverage = !exact && ["global", "worldwide"].includes(normalizedText(resource.country));
    let tier = 5;
    if (exact && distance <= 250) tier = 0;
    else if (!exact && sameCountry) tier = 1;
    else if (exact && sameCountry) tier = 2;
    else if (globalCoverage) tier = 3;
    else if (exact) tier = 4;
    return {
      resource,
      tier,
      distance: distance ?? Number.POSITIVE_INFINITY,
      score: resourceSearchScore(resource, query)
    };
  });

  ranked.sort((left, right) => left.tier - right.tier
    || right.score - left.score
    || left.distance - right.distance
    || left.resource.name.localeCompare(right.resource.name));
  return ranked.map((entry) => entry.resource);
}''',
    "precomputed location ranking",
)

path.write_text(text)
print("Applied cached search and one-pass ranking optimization.")
