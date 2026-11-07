import test from 'node:test';
import assert from 'node:assert/strict';
import { messages, t, setLocale, getLocale, formatDate } from '../src/utils/localization.js';

test('reviewed interface keys have matching English and Spanish parameters', () => {
  for (const [key, pair] of Object.entries(messages)) {
    assert.equal(pair.length, 2, key);
    assert.ok(pair.every(value => typeof value === 'string' && value.length > 0), key);
    assert.deepEqual(pair[0].match(/\{\w+\}/g), pair[1].match(/\{\w+\}/g), key);
  }
});
test('language selection rejects unsupported values and preserves provider names', () => {
  assert.equal(setLocale('es'), true);
  assert.equal(getLocale(), 'es');
  assert.equal(setLocale('javascript:bad'), false);
  assert.equal(getLocale(), 'es');
  assert.equal(t('removeNamed', { name: 'The Bowery Mission' }), 'Quitar The Bowery Mission de los servicios guardados');
  assert.equal(t('directionsTo', { service: '<input>' }), 'Cómo llegar a <input>'); // text API, never trusted HTML
  setLocale('en');
});
test('date-only evidence remains the same local calendar date and invalid values remain unknown', () => {
  assert.equal(formatDate('2026-11-07', 'en'), 'Nov 7, 2026');
  assert.equal(formatDate('2026-11-07', 'es'), '7 nov 2026');
  assert.equal(formatDate('2026-02-30', 'es'), '2026-02-30');
  assert.equal(formatDate('unknown', 'es'), 'unknown');
});
