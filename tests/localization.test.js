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

test('interface translation only recognizes reviewed labels and keeps arbitrary provider claims intact', async () => {
  const { translateInterfaceText } = await import('../src/utils/interface-copy.js');
  assert.equal(translateInterfaceText('Search this directory', 'es'), 'Buscar en este directorio');
  assert.equal(translateInterfaceText('Call 617-555-0199', 'es'), 'Llamar a 617-555-0199');
  assert.equal(translateInterfaceText('1 match', 'es'), '1 coincidencia');
  assert.equal(translateInterfaceText('2 matches', 'es'), '2 coincidencias');
  assert.equal(translateInterfaceText('Services for women ages 14–24', 'es'), 'Services for women ages 14–24');
  assert.equal(translateInterfaceText('227 Bowery, New York, NY', 'es'), '227 Bowery, New York, NY');
  assert.equal(translateInterfaceText('<img src=x onerror=alert(1)>', 'es'), '<img src=x onerror=alert(1)>');
});

test('clearing browser language resets memory without retaining a preference or touching Saved', async () => {
  const { clearLanguagePreference, LANGUAGE_KEY } = await import('../src/utils/localization.js');
  const old = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const records = new Map([['rwn-saved-resources', '["bowery-mission"]']]);
  Object.defineProperty(globalThis, 'localStorage', {configurable:true, value:{setItem:(k,v)=>records.set(k,v), removeItem:k=>records.delete(k)}});
  try {
    setLocale('es'); assert.equal(records.get(LANGUAGE_KEY), 'es');
    assert.equal(clearLanguagePreference(), true);
    assert.equal(getLocale(), 'en'); assert.equal(records.has(LANGUAGE_KEY), false);
    assert.equal(records.get('rwn-saved-resources'), '["bowery-mission"]');
  } finally { if (old) Object.defineProperty(globalThis, 'localStorage', old); else delete globalThis.localStorage; }
});
