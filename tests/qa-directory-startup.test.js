import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { directoryStartupSnapshot, directoryStartupStaticReady, isDirectoryStartupNavigationError } from '../scripts/qa-directory-startup.mjs';

// Run the same serialized expression as the CDP harness, without a browser,
// network, or a substitute snapshot implementation.
const expression = `(${directoryStartupSnapshot.toString()})()`;
const read = globals => vm.runInNewContext(expression, Object.defineProperties({ URL }, Object.getOwnPropertyDescriptors(globals)));
const storage = data => Object.assign(Object.create({ getItem(key) { return this[key] ?? null; } }), data);
function fixture({ form = false, runtime = false, probe = true, href = 'http://127.0.0.1:4175/directory', root = true } = {}) {
  const query = 'Drinking fountains for London';
  const input = { getAttribute: () => null, value: query, disabled: false, selectionStart: 9, selectionEnd: 9, getBoundingClientRect: () => ({ width: 240, height: 44 }) };
  const row = { getAttribute: () => '/service/london-drinking-fountains', textContent: 'London finder' };
  const nodes = new Map(form ? [
    ['[data-directory-query]', input],
    ['[data-directory-country]', { value: '', disabled: !runtime }],
    ['[data-directory-clear]', { hidden: !runtime }],
    ['[data-directory-count]', { textContent: runtime ? '1 matching listing' : '' }]
  ] : []);
  if (runtime) {
    nodes.set('.directory-global-results', { hidden: false });
    nodes.set('[data-directory-category][aria-pressed="true"]', { textContent: 'All help' });
  }
  return {
    document: {
      documentElement: root ? { scrollWidth: 390 } : null,
      activeElement: form ? input : null,
      title: root ? 'Directory | Real World Needs' : '',
      querySelector: selector => nodes.get(selector) || null,
      querySelectorAll: selector => selector === '.directory-global-result' && runtime ? [row] : []
    },
    location: { href }, performance: { timeOrigin: 200 },
    history: { state: runtime ? { rwnDirectory: { query } } : null }, scrollY: 0, innerWidth: 390,
    localStorage: storage({ theme: 'light' }), sessionStorage: storage({}),
    ...(probe ? { __rwnDirectoryStartupQA: { inputs: [], catalogReads: runtime ? 1 : 0, catalogSettled: runtime ? 1 : 0 } } : {})
  };
}

test('startup snapshot tolerates the provisional document from delayed Page.navigate', () => {
  const globals = fixture({ root: false, probe: false });
  Object.defineProperty(globals, 'localStorage', { get() { throw new Error('Provisional origin storage must not be read'); } });
  const snapshot = read(globals);
  assert.equal(snapshot.documentPresent, false);
  assert.equal(snapshot.ready, false);
  assert.equal(snapshot.inputVisible, false);
  assert.equal(snapshot.focusedInput, false, 'two absent nodes do not establish focus');
  assert.equal(snapshot.overflow, null);
  assert.equal(snapshot.probe, null);
  assert.equal(snapshot.storage, null);
  assert.equal(snapshot.rows.length, 0);
  assert.equal(directoryStartupStaticReady(snapshot, 100, 1), false);
});

test('startup snapshot tolerates absent document, location, performance and probe', () => {
  const snapshot = read({});
  assert.equal(snapshot.title, '');
  assert.equal(snapshot.href, '');
  assert.equal(snapshot.pathname, '');
  assert.equal(snapshot.timeOrigin, null);
  assert.equal(snapshot.ready, false);
  assert.equal(snapshot.focusedInput, false);
  assert.equal(directoryStartupStaticReady(snapshot, 100, 1), false);
});

test('partially parsed form without its injected probe cannot satisfy static readiness', () => {
  const snapshot = read(fixture({ form: true, probe: false }));
  assert.equal(snapshot.inputVisible, true);
  assert.equal(snapshot.ready, false);
  assert.equal(directoryStartupStaticReady(snapshot, 100, 1), false);
});

test('malformed or unrelated provisional URLs stay unready without throwing', () => {
  for (const href of ['', 'not a URL', 'about:blank', 'http://127.0.0.1:4175/service/example']) {
    const snapshot = read(fixture({ form: true, href }));
    assert.equal(directoryStartupStaticReady(snapshot, 100, 1), false, href);
  }
});

test('static readiness still requires a new document, editable form, probe and held module', () => {
  const snapshot = read(fixture({ form: true }));
  assert.equal(snapshot.ready, false, 'static form is not a runtime readiness witness');
  assert.equal(directoryStartupStaticReady(snapshot, 100, 1), true);
  assert.equal(directoryStartupStaticReady(snapshot, 200, 1), false);
  assert.equal(directoryStartupStaticReady(snapshot, 100, 0), false);
  assert.equal(directoryStartupStaticReady({ ...snapshot, inputVisible: false }, 100, 1), false);
  assert.equal(directoryStartupStaticReady({ ...snapshot, timeOrigin: null }, 100, 1), false);
  assert.equal(directoryStartupStaticReady({ ...snapshot, documentPresent: false }, 100, 1), false);
});

test('ready snapshot retains the real result, caret, focus, layout and privacy evidence', () => {
  const snapshot = read(fixture({ form: true, runtime: true }));
  assert.equal(snapshot.ready, true);
  assert.equal(snapshot.focusedInput, true);
  assert.equal(snapshot.query, 'Drinking fountains for London');
  assert.equal(JSON.stringify(snapshot.selection), '[9,9]');
  assert.equal(snapshot.rows[0].href, '/service/london-drinking-fountains');
  assert.equal(snapshot.count, '1 matching listing');
  assert.equal(snapshot.category, 'All help');
  assert.equal(snapshot.countryDisabled, false);
  assert.equal(snapshot.overflow, 0);
  assert.equal(snapshot.storage.local.theme, 'light');
  assert.equal(snapshot.probe.catalogSettled, 1);
});

test('genuine selector and storage failures are not converted into pre-ready absence', () => {
  const broken = fixture();
  broken.document.querySelector = () => { throw new Error('Broken selector implementation'); };
  assert.throws(() => read(broken), /Broken selector implementation/);
  const denied = fixture({ form: true });
  denied.localStorage = Object.assign(Object.create({ getItem() { throw new Error('Storage denied'); } }), { existing: 'value' });
  assert.throws(() => read(denied), /Storage denied/);
});

test('only known CDP navigation-context replacement errors are retryable', () => {
  for (const message of [
    'Runtime.evaluate: Execution context was destroyed.',
    'Runtime.evaluate: Cannot find context with specified id',
    'Cannot find default execution context',
    'No execution context with given id found',
    'Inspected target navigated or closed'
  ]) assert.equal(isDirectoryStartupNavigationError(new Error(message)), true, message);
  for (const message of [
    "TypeError: Cannot read properties of null (reading 'scrollWidth')",
    'Error: Cannot find context in application state',
    'Storage denied',
    'Runtime.evaluate: Invalid expression'
  ]) assert.equal(isDirectoryStartupNavigationError(new Error(message)), false, message);
});
