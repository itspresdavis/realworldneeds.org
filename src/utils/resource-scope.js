// Coverage is a service fact, not the location of a map marker or headquarters.
// Keep this interpretation shared by search, local pages and related help.
const text = value => String(value || '').trim().replace(/\s+/g, ' ');
const key = value => text(value).toLowerCase();
const placeholders = new Set(['online', 'national', 'nationwide', 'countrywide', 'global', 'worldwide']);

export function canonicalMunicipality(city, country) {
  const value = text(city);
  // Both forms are used for the same municipality by the reviewed NYC sources.
  if (key(country) === 'united states' && ['new york', 'new york city'].includes(key(value))) return 'New York City';
  return value;
}

export function resourceAdministrativeArea(resource) {
  if (text(resource.administrativeArea)) return text(resource.administrativeArea);
  const address = text(resource.address);
  if (resource.country === 'United States') return address.match(/,\s*([A-Z]{2})\s*,?\s*\d{5}(?:-\d{4})?\b/)?.[1] || '';
  if (resource.country === 'Canada') return address.match(/,\s*([A-Z]{2})\s+[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/i)?.[1]?.toUpperCase() || '';
  return '';
}

export function resourceScope(resource) {
  const country = text(resource.country);
  const city = canonicalMunicipality(resource.city, country);
  const administrativeArea = resourceAdministrativeArea(resource);
  const publicCoverage = text(resource.coverageNote || resource.address);
  let type = 'unknown';
  if (key(country) === 'global') type = 'global';
  else if (city && country && /\b(?:County|Region|Province)\b/i.test(city)) type = 'regional';
  else if (country && resource.kind !== 'direct' && (key(city) === key(country)
    || /^(?:Coverage area:\s*)?(?:Nationwide|Countrywide)\b/i.test(publicCoverage)
    || ['national', 'nationwide', 'countrywide'].includes(key(city)))) type = 'national';
  else if (city && country && !placeholders.has(key(city)) && key(city) !== key(country)) {
    type = /\b(?:County|Region|Province)\b/i.test(city) ? 'regional' : 'municipal';
  }
  const label = type === 'global' ? 'Global resources — check coverage'
    : type === 'national' ? `${country} — nationwide information or referral`
      : type === 'unknown' ? (country ? `${country} — check coverage` : 'Coverage not specified')
        : [city, administrativeArea, country].filter(Boolean).join(', ');
  return { type, city, country, administrativeArea, label };
}

export function sameMunicipality(left, right) {
  return sameScopedMunicipality(resourceScope(left), resourceScope(right));
}

export function sameScopedMunicipality(a, b) {
  return a.type === 'municipal' && b.type === 'municipal' && key(a.country) === key(b.country)
    && key(a.city) === key(b.city)
    && !(a.administrativeArea && b.administrativeArea && key(a.administrativeArea) !== key(b.administrativeArea));
}
