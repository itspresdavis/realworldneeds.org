import assert from 'node:assert/strict';
import test from 'node:test';
import { resources } from '../src/data/resources.js';
import { resourceSearchScore as score, resourceSearchText, searchGeographyChoices, createIndexedSearchMatcher } from '../src/utils/search.js';
const fixture = (values = {}) => ({ name: 'Community support', city: 'Boston', country: 'United States', category: 'food', kind: 'direct', address: '1 Main Street, Boston, MA 02111', ...values });
const compact = (resource) => ({ id: resource.id, name: resource.name, place: `${resource.city}, ${resource.country}`, country: resource.country, category: resource.category, categories: [resource.category, ...(resource.secondaryCategories || [])], search: resourceSearchText(resource) });
const both = [r => r, compact];
const ranked = (items, query) => items.filter(r => score(r, query) >= 0).sort((a, b) => score(b, query) - score(a, query) || a.name.localeCompare(b.name));

test('explicit country names and abbreviations retain city priority without guessing a country', () => {
  const us = fixture();
  const uk = fixture({ country: 'United Kingdom', address: '1 Main Street, Boston, Lincolnshire, PE21 6NP' });
  const incidental = fixture({ city: 'Runcorn', country: 'United Kingdom', address: 'Boston Avenue, Runcorn, WA7 2DE' });
  for (const convert of both) {
    assert.equal(score(convert(us), 'Boston'), score(convert(uk), 'Boston'));
    for (const country of ['UK', 'U.K.', 'GB', 'United Kingdom']) {
      assert.ok(score(convert(uk), `Boston ${country}`) >= 0);
      assert.equal(score(convert(us), `Boston ${country}`), -1);
      assert.ok(score(convert(uk), `Boston ${country}`) > score(convert(incidental), `Boston ${country}`));
    }
    for (const country of ['US', 'U.S.', 'USA', 'United States', 'United States of America']) {
      assert.ok(score(convert(us), `Boston ${country}`) >= 0);
      assert.equal(score(convert(uk), `Boston ${country}`), -1);
    }
    assert.equal(score(convert(us), 'Boston UK USA'), -1, 'contradictory qualifiers cannot silently drop one constraint');
  }
});

test('US state qualifiers use bounded address evidence, never arbitrary prefixes or country inference', () => {
  const ma = fixture();
  const uk = fixture({ country: 'United Kingdom', address: 'Market Place, Boston, PE21 6NP' });
  const ny = fixture({ city: 'Albany', address: '1 Massachusetts Avenue, Albany, NY 12201' });
  for (const convert of both) {
    for (const query of ['Boston MA', 'Boston Massachusetts', 'Boston ma food']) {
      assert.ok(score(convert(ma), query) >= 0, query);
      assert.equal(score(convert(uk), query), -1, query);
    }
    assert.equal(score(convert(ny), 'Albany MA'), -1, 'a street named Massachusetts does not change its postal state');
    assert.ok(score(convert(ny), 'Albany NY') >= 0);
    assert.ok(score(convert(fixture({ country: 'Georgia', city: 'Tbilisi', address: 'Tbilisi, Georgia' })), 'Georgia food') >= 0, 'full state names do not erase a same-named country');
    assert.ok(score(convert(fixture({ country: 'United Kingdom', city: 'Washington', address: 'Washington' })), 'Washington food') >= 0, 'full state names do not erase a same-named city');
    assert.ok(score(convert(fixture({ name: 'Wick support', city: 'Wick', country: 'United Kingdom', address: 'Wick' })), 'wi food') >= 0, 'unfinished WIC stays a prefix');
  }
});

test('coverage addresses support multiple named states without inventing exact sites', () => {
  const resource = fixture({ kind: 'network', address: 'Massachusetts, New Hampshire, and Rhode Island' });
  for (const convert of both) {
    for (const state of ['MA', 'NH', 'RI', 'Massachusetts']) assert.ok(score(convert(resource), `Boston ${state}`) >= 0, state);
    assert.equal(score(convert(resource), 'Boston NY'), -1);
  }
});

test('pantry and foodbank searches require specific evidence while broad food and prefixes remain broad', () => {
  for (const convert of both) {
    const clinic = convert(fixture({ name: 'Community WIC clinic', services: ['Food benefits and nutrition advice'] }));
    const pantry = convert(fixture({ name: 'Community Pantry', services: ['Weekly food pantry'] }));
    const bank = convert(fixture({ name: 'Community Food Bank', services: ['Foodbank collection'] }));
    for (const query of ['pantry', 'pantries', 'food bank', 'foodbanks', 'Boston food pantry']) {
      assert.equal(score(clinic, query), -1, query);
      assert.ok(score(pantry, query) >= 0, query);
      assert.ok(score(bank, query) >= 0, query);
    }
    assert.ok(score(clinic, 'food') >= 0);
    assert.ok(score(pantry, 'pan') >= 0);
  }
});

test('ambiguity guidance uses exact source cities and respects already-filtered results', () => {
  const us = fixture(), uk = fixture({ country: 'United Kingdom', address: 'Boston, PE21 6NP' });
  const unrelated = fixture({ city: 'Runcorn', country: 'United Kingdom', address: 'Boston Avenue, Runcorn' });
  for (const convert of both) {
    const items = [us, uk, unrelated].map(convert);
    assert.deepEqual(searchGeographyChoices(items, 'Boston food'), [
      { city: 'Boston', country: 'United Kingdom' }, { city: 'Boston', country: 'United States' },
    ]);
    for (const query of ['', 'food', 'Bost', 'Boston MA', 'Boston UK']) assert.deepEqual(searchGeographyChoices(items, query), [], query);
    assert.deepEqual(searchGeographyChoices([convert(us), convert(unrelated)], 'Boston'), [], 'incidental streets cannot manufacture ambiguity');
    assert.deepEqual(searchGeographyChoices([convert(us)], 'Boston'), [], 'a manually filtered country is respected');
  }
});

test('published geography regressions and realistic queries agree across homepage and compact directory', () => {
  const indexed = resources.map(compact);
  for (const query of ['Boston', 'Boston food pantry', 'Boston MA', 'Boston Massachusetts', 'Boston United Kingdom', 'Boston UK', 'Taunton MA', 'Taunton UK', 'Free water', 'WIC', 'Diapers', 'Baby formula', 'Wheelchair', 'Emergency shelter', 'Shower', 'Clothing', 'Food near me', 'Tijuana', 'Rosarito', 'shleter', 'Bogotá', '02111', 'PE216NP']) {
    assert.deepEqual(ranked(indexed, query).map(r => r.id), ranked(resources, query).map(r => r.id), query);
  }
  assert.deepEqual(ranked(resources, 'Boston MA').map(r => r.id).sort(), ranked(resources, 'Boston Massachusetts').map(r => r.id).sort());
  assert.ok(ranked(resources, 'Boston MA').slice(0, 17).every(r => r.city === 'Boston' && r.country === 'United States'));
  assert.equal(ranked(resources, 'Boston UK')[0].city, 'Boston');
  assert.equal(ranked(resources, 'Taunton MA')[0].id, 'ma-wic-tauntonattleboro-wic-program-main-clinic');
  for (const query of ['Tijuana', 'Rosarito', 'Baby formula', 'Wheelchair']) assert.equal(ranked(resources, query).length, 0, 'absent catalog coverage remains honestly absent');
  assert.ok(ranked(resources, 'Boston food pantry').every(r => !r.id.startsWith('ma-wic')));
});

test('specialized directory matcher has complete score parity and safe legacy fallbacks', () => {
  const index = createIndexedSearchMatcher();
  const queries = ['Boston', 'Boston food pantry', 'Boston MA', 'Boston Massachusetts', 'Boston UK', 'Taunton MA', 'Taunton UK', 'London', 'WIC', 'wi', 'Food near me', 'New York food', 'NYC', 'dental Dublin', 'showers London', 'E16LT', '02111', '東京'];
  for (const resource of resources) {
    const record = compact(resource);
    for (const query of queries) assert.equal(index.score(record, query), score(resource, query), `${resource.id}: ${query}`);
  }
  const legacy = compact(fixture());
  legacy.search = legacy.search.split('\n').slice(0, 4).join('\n');
  assert.ok(index.score(legacy, 'Boston MA') >= 0);
  assert.equal(index.score(legacy, 'Boston UK'), -1);
  assert.equal(index.score({ name: 'Sparse survivor', country: 'United States', category: 'food', search: 'sparse survivor food' }, 'sparse'), 24);
  assert.equal(index.score({ name: 'Missing corpus', category: 'food' }, 'invented'), -1);
});

test('compact state-code guard exactly preserves the documented unambiguous code set', () => {
  const constrained = new Set('al ak az ar ca co ct dc fl ga il ia ks ky md ma mi mn ms mo mt ne nv nh nj nm ny nc nd oh pa ri sc sd tn tx ut vt va wa wv wy'.split(' '));
  for (const a of 'abcdefghijklmnopqrstuvwxyz') for (const b of 'abcdefghijklmnopqrstuvwxyz') {
    const code = a + b;
    if (code === 'us') continue; // Explicit country qualifier has its own regression.
    const uk = fixture({ country: 'United Kingdom', city: 'Gnome', address: `1 ${code} Lane, Gnome` });
    // Feed literal tokens to isolate the guard from multilingual noise words.
    assert.equal(score(uk, [["gnome", "gnome"], [code, code]]) < 0, constrained.has(code), code);
  }
});
