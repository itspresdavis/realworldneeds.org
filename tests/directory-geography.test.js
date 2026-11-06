import assert from 'node:assert/strict';
import test from 'node:test';
import { resources } from '../src/data/resources.js';
import { normalizeSearch, querySearchTokens, resourceSearchScore, searchGeographyChoices } from '../src/utils/search.js';
import { geographyChoices, renderGeographyHint } from '../public/directory-geography.js';

test('optional country guidance agrees with full matcher using only already filtered records', () => {
  for (const query of ['Boston', 'Boston food', 'Boston food pantry', 'Taunton', 'Taunton food', 'Boston MA', 'Boston UK', 'Tijuana', 'Food near me', 'Bost', 'London shower']) {
    const tokens = querySearchTokens(query);
    const matches = resources.filter(record => resourceSearchScore(record, tokens) >= 0);
    assert.deepEqual(geographyChoices(matches, tokens, normalizeSearch), searchGeographyChoices(resources, query), query);
    const compact = matches.map(({ city, country, ...record }) => ({ ...record, country, place: `${city}, ${country}` }));
    assert.deepEqual(geographyChoices(compact, tokens, normalizeSearch), searchGeographyChoices(resources, query), `legacy display place: ${query}`);
    assert.deepEqual(geographyChoices(matches.filter(record => record.country === 'United States'), tokens, normalizeSearch), [], 'manual country filters do not reappear as suggestions');
  }
});

test('optional hint updates safely and disappears when search is unambiguous', () => {
  const hint = { hidden: true, textContent: '' };
  const root = { querySelector: () => hint };
  const matches = resources.filter(record => resourceSearchScore(record, 'Boston') >= 0);
  renderGeographyHint(root, matches, querySearchTokens('Boston'), normalizeSearch);
  assert.equal(hint.hidden, false);
  assert.match(hint.textContent, /Boston.*United Kingdom.*United States/);
  renderGeographyHint(root, matches.filter(record => record.country === 'United States'), querySearchTokens('Boston'), normalizeSearch);
  assert.equal(hint.hidden, true);
});
