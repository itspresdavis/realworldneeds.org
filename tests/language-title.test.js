import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { translateInterfaceText } from '../src/utils/interface-copy.js';

const source = (await readFile('public/language.js', 'utf8')).replace(/^import .*;\n/gm, '');
const directory = 'Essential services directory | Real World Needs';
const saved = 'Saved services | Real World Needs';

function fixture(title = directory, initialLocale = 'en') {
  let locale = initialLocale, observer;
  const queued = [], events = {};
  const document = { title, body: { isConnected: false }, querySelector: () => null, addEventListener() {} };
  const window = { addEventListener: (name, callback) => { events[name] = callback; } };
  vm.runInNewContext(source, {
    document, window, translateInterfaceText, LANGUAGE_KEY: 'rwn-language',
    getLocale: () => locale, setLocale: value => { locale = value; }, readLanguagePreference: () => locale,
    t: key => key, clearLanguagePreference: () => true,
    queueMicrotask: callback => queued.push(callback),
    MutationObserver: class {
      constructor(callback) { observer = callback; }
      takeRecords() { return []; }
      disconnect() {} observe() {}
    },
  });
  const flush = () => { while (queued.length) queued.shift()(); };
  return { document, api: window.RWNLanguage, flush,
    mutate() { observer([{ type: 'characterData', target: document.body }]); flush(); },
    language(value) { locale = value; events['rwn:languagechange'](); flush(); },
  };
}

test('a queued body translation never resets the active Saved title', () => {
  const f = fixture();
  f.api.setTitle(saved); // Navigation wins over an already queued initial update.
  f.flush(); f.mutate();
  assert.equal(f.document.title, saved);
  assert.equal(f.api.originalTitle(), saved);
  f.api.setTitle(directory); f.mutate();
  assert.equal(f.document.title, directory);
});

test('Saved and return titles retain their English source across both language directions', () => {
  const f = fixture(directory, 'es'); f.flush();
  assert.equal(f.document.title, 'Directorio de servicios esenciales | Real World Needs');
  const original = f.api.originalTitle();
  assert.equal(original, directory);
  f.api.setTitle(saved); f.mutate();
  assert.equal(f.document.title, 'Servicios guardados | Real World Needs');
  f.language('en'); assert.equal(f.document.title, saved);
  f.language('es'); f.api.setTitle(original); f.mutate();
  assert.equal(f.document.title, 'Directorio de servicios esenciales | Real World Needs');
  f.language('en'); assert.equal(f.document.title, directory);
});

test('late language startup preserves a title already chosen by Saved', () => {
  const f = fixture(saved, 'es'); f.flush();
  assert.equal(f.document.title, 'Servicios guardados | Real World Needs');
  f.api.setTitle(directory); f.mutate();
  assert.equal(f.document.title, 'Directorio de servicios esenciales | Real World Needs');
  f.language('en'); assert.equal(f.document.title, directory);
});
