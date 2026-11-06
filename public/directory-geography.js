// Optional guidance only. The entry already filtered and ranked these records;
// this module never changes results, assumes a country, or makes a request.
export function geographyChoices(records, tokens, normalize) {
  const city = tokens.filter(([, alias]) => !['food', 'water', 'shelter', 'hygiene', 'clothing', 'health', 'referral', 'mental', 'pantry', 'pantries', 'foodbank', 'foodbanks'].includes(alias)).map(([literal]) => literal).join(' ');
  if (!city) return [];
  const choices = new Map();
  for (const record of records) {
    const country = String(record.country || '').trim(), suffix = `, ${country}`;
    const place = String(record.city ?? (country && String(record.place || '').toLowerCase().endsWith(suffix.toLowerCase()) ? record.place.slice(0, -suffix.length) : ''));
    if (country && normalize(place) === city) choices.set(country, { city: place, country });
  }
  return choices.size < 2 ? [] : [...choices.values()].sort((a, b) => a.country.localeCompare(b.country));
}

export function renderGeographyHint(root, records, tokens, normalize) {
  const choices = geographyChoices(records, tokens, normalize);
  let hint = root.querySelector('[data-geography-hint]');
  if (!choices.length) { if (hint) hint.hidden = true; return; }
  if (!hint) {
    hint = document.createElement('p');
    hint.setAttribute('data-geography-hint', '');
    hint.setAttribute('role', 'status');
    root.prepend(hint);
  }
  hint.hidden = false;
  hint.textContent = `${choices[0].city} has listings in ${choices.map(choice => choice.country).join(' and ')}. Add a country or region to narrow the results.`;
}
