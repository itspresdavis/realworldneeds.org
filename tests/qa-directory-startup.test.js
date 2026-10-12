import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { directoryStartupSnapshot, directoryStartupStaticReady, isDirectoryStartupNavigationError, focusDirectoryStartupBlurTarget, directoryStartupClickPoint, directoryStartupRequestLeaksQuery } from '../scripts/qa-directory-startup.mjs';

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

function blurFixture({ width = 390, rendered = true, visibility = 'visible', focusWorks = true, offscreen = false } = {}) {
  const document = { activeElement: { tagName: 'INPUT' } };
  const selectors = [], focusOptions = [];
  const brand = {
    getAttribute: () => '/',
    getBoundingClientRect: () => ({ x: 12, y: 8, left: 12, top: 8, width: rendered ? 150 : 0, height: rendered ? 44 : 0, right: offscreen ? width + 1 : 162, bottom: 52 }),
    focus(options) { focusOptions.push(options); if (focusWorks) document.activeElement = brand; }
  };
  document.querySelector = selector => {
    selectors.push(selector);
    // The first desktop nav match exists but cannot receive focus on mobile.
    if (selector === '.legal-header a[href="/directory"]') return { focus() {}, getAttribute: () => '/directory' };
    return selector === '.legal-header .legal-brand[href="/"]' ? brand : null;
  };
  return { globals: { document, innerWidth: width, innerHeight: 844, getComputedStyle: () => ({ display: rendered ? 'inline-flex' : 'none', visibility }) }, selectors, focusOptions, brand };
}
const blur = globals => vm.runInNewContext(`(${focusDirectoryStartupBlurTarget.toString()})()`, globals);

test('pre-start blur selects the visible brand outside desktop and mobile navigation', () => {
  for (const width of [1440, 390]) {
    const f = blurFixture({ width });
    const result = blur(f.globals);
    assert.equal(result.href, '/');
    assert.equal(result.visible, true);
    assert.equal(result.focused, true);
    assert.equal(f.globals.document.activeElement, f.brand);
    assert.deepEqual(f.selectors, ['.legal-header .legal-brand[href="/"]']);
    assert.equal(f.focusOptions[0].preventScroll, true);
  }
});

test('pre-start blur refuses hidden, offscreen or unfocusable targets before runtime release', () => {
  for (const options of [{ rendered: false }, { visibility: 'hidden' }, { visibility: 'collapse' }, { offscreen: true }]) {
    const f = blurFixture(options);
    assert.throws(() => blur(f.globals), /not visible/);
    assert.equal(f.focusOptions.length, 0);
  }
  const f = blurFixture({ focusWorks: false });
  assert.throws(() => blur(f.globals), /did not receive focus/);
});

test('snapshot distinguishes retained brand focus from a duplicate home navigation link', () => {
  const globals = fixture({ form: true, runtime: true });
  const originalPick = globals.document.querySelector;
  const brand = { getAttribute: () => '/' };
  globals.document.querySelector = selector => selector === '.legal-header .legal-brand[href="/"]' ? brand : originalPick(selector);
  globals.document.activeElement = brand;
  assert.equal(read(globals).focusedBrand, true);
  assert.equal(read(globals).focusedInput, false);
  globals.document.activeElement = { getAttribute: () => '/' };
  assert.equal(read(globals).focusedHref, '/');
  assert.equal(read(globals).focusedBrand, false);
});

function clickFixture({ rect = { x: 12, y: 100, width: 200, height: 44 }, visibility = 'visible', opacity = '1', covered = false, child = false } = {}) {
  const childNode = {};
  const node = { hidden: false, disabled: false, scrollIntoView() {}, getBoundingClientRect: () => rect, contains: target => target === childNode };
  return { innerWidth: 390, innerHeight: 844, scrollX: 0, scrollY: 0, requestAnimationFrame: callback => queueMicrotask(() => callback(0)), getComputedStyle: () => ({ display: 'block', visibility, opacity }),
    document: { querySelector: () => node, addEventListener() {}, removeEventListener() {}, elementFromPoint: () => covered ? {} : child ? childNode : node } };
}
const clickPoint = globals => vm.runInNewContext(`(${directoryStartupClickPoint.toString()})('[data-directory-clear]')`, globals);

test('native click setup requires a visible in-viewport center and the actual hit target', async () => {
  for (const child of [false, true]) {
    const point = await clickPoint(clickFixture({ child }));
    assert.equal(point.x, 112); assert.equal(point.y, 122);
  }
  for (const options of [{ visibility: 'hidden' }, { opacity: '0' }, { rect: { x: 12, y: 100, width: 0, height: 0 } }, { rect: { x: 500, y: 100, width: 40, height: 44 } }]) {
    await assert.rejects(() => clickPoint(clickFixture(options)), /not visibly clickable/);
  }
  await assert.rejects(() => clickPoint(clickFixture({ covered: true })), /covered or clipped/);
});

test('privacy checks include candidate text and form/URLSearchParams decoding', () => {
  for (const request of [
    { url: 'http://127.0.0.1/rum?term=Drinking+fountains+for+London' },
    { url: 'http://127.0.0.1/rum?term=Drinking%20fountains%20for%20Lon' },
    { url: 'http://127.0.0.1/rum', postData: 'term=Drinking+fountains+for+Lon' },
    { url: 'http://127.0.0.1/rum', postData: '{"term":"Drinking fountains for Lon"}' },
    { url: 'http://127.0.0.1/rum', headers: { Referer: 'http://127.0.0.1/directory?term=Drinking+fountains+for+Lon' } },
    { url: 'http://127.0.0.1/rum?term=wic' },
    { url: 'http://127.0.0.1/rum?query=' }
  ]) assert.equal(directoryStartupRequestLeaksQuery(request), true, JSON.stringify(request));
  assert.equal(directoryStartupRequestLeaksQuery({ url: 'http://127.0.0.1/data/search-index.json?v=abcdef123456' }), false);
  assert.equal(directoryStartupRequestLeaksQuery({ url: 'http://127.0.0.1/rum', postData: 'CPU 50% complete' }), false);
});
