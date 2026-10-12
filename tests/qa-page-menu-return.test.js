import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {
  PAGE_MENU_LOCAL, PAGE_MENU_SERVICE, pageMenuFixtureCacheControl, observePageMenuReturn, pageMenuReturnSnapshot,
  pageMenuRetainedState, pageMenuReturnedFromBFCache, pageMenuFreshDocument, waitForPageMenuSettled, cleanupPageMenuQA, pageMenuWorkerReady
} from '../scripts/qa-page-menu-return.mjs';

const event = (persisted, timeOrigin = 100, extra = {}) => ({ persisted, trusted: true, href: `http://127.0.0.1:9999${PAGE_MENU_LOCAL}`, timeOrigin, ...extra });
const source = () => ({ documentPresent: true, ready: true, href: `http://127.0.0.1:9999${PAGE_MENU_LOCAL}`, path: PAGE_MENU_LOCAL,
  timeOrigin: 100, query: 'library', country: undefined, category: '', count: '1 matching listing', summary: 'Showing 1 of 1 matches across 15 listings',
  filtered: true, resultsHidden: false, more: false, empty: undefined,
  rows: [{ href: PAGE_MENU_SERVICE, text: 'New York Public Library access · source checked' }], staticRows: [{ href: PAGE_MENU_SERVICE, text: 'New York Public Library access' }],
  history: { path: PAGE_MENU_LOCAL, query: 'library', country: '', category: '', shown: 1, scroll: 240 },
  menuOpen: true, scroll: 240, overflow: 0, overlay: false, saved: false,
  focus: { visible: true, inMenu: true, href: '/directory#saved', box: { x: 12, y: 120, width: 300, height: 50 } },
  probe: { shows: [event(false)], hides: [], inputs: [{ value: 'library', trusted: true }] } });
const returned = () => ({ ...source(), menuOpen: false, focus: { visible: true, inMenu: false, summary: true, href: '', box: { x: 300, y: 12, width: 68, height: 44 } },
  probe: { shows: [event(false), event(true)], hides: [event(true, 100, { menuOpen: true })] } });

test('BFCache classifier requires trusted persisted lifecycle evidence from the same exact document and entry', () => {
  assert.equal(pageMenuReturnedFromBFCache(returned(), source()), true);
  for (const mutate of [
    s => { s.timeOrigin = 101; }, s => { s.timeOrigin = null; }, s => { s.documentPresent = false; }, s => { s.probe = null; },
    s => { s.probe.shows.at(-1).persisted = false; }, s => { s.probe.shows.at(-1).trusted = false; },
    s => { s.probe.shows.at(-1).timeOrigin = 101; }, s => { s.probe.shows.at(-1).href = 'http://127.0.0.1:9999/directory'; },
    s => { s.probe.shows.pop(); }, s => { s.probe.shows.push(event(true)); },
    s => { s.probe.hides = []; }, s => { s.probe.hides.at(-1).persisted = false; }, s => { s.probe.hides.at(-1).trusted = false; },
    s => { s.probe.hides.at(-1).timeOrigin = 101; }
  ]) {
    const state = returned(); mutate(state);
    assert.equal(pageMenuReturnedFromBFCache(state, source()), false, JSON.stringify(state));
  }
});

test('fresh navigation/reload cannot masquerade as BFCache even when its DOM and private history match', () => {
  const fresh = { ...returned(), timeOrigin: 101, probe: { shows: [event(false, 101)], hides: [] } };
  assert.equal(pageMenuFreshDocument(fresh, 100), true);
  assert.equal(pageMenuRetainedState(fresh, source()), true);
  assert.equal(pageMenuReturnedFromBFCache(fresh, source()), false);
  assert.equal(pageMenuFreshDocument(returned(), 100), false);
  for (const mutate of [s => { s.timeOrigin = 100; }, s => { s.timeOrigin = Infinity; }, s => { s.probe = null; },
    s => { s.probe.shows[0].persisted = true; }, s => { s.probe.shows[0].trusted = false; },
    s => { s.probe.hides.push(event(true)); }, s => { s.ready = false; }]) {
    const state = structuredClone(fresh); mutate(state);
    assert.equal(pageMenuFreshDocument(state, 100), false, JSON.stringify(state));
  }
});

test('exact retained-state oracle catches local/global widening, reordered or stale rows and dropped history', () => {
  assert.equal(pageMenuRetainedState(returned(), source()), true);
  for (const change of [{ href: 'http://127.0.0.1:9999/directory' }, { path: '/directory' }, { query: '' }, { country: '' }, { category: 'Food' },
    { count: '15 listings on this page' }, { summary: 'Showing 1 of 1 matches across 439 listings' }, { filtered: false }, { resultsHidden: true },
    { more: true }, { empty: 'No matching listings' }, { rows: [] }, { rows: [{ href: PAGE_MENU_SERVICE, text: 'Wrong metadata' }] },
    { staticRows: [] }, { history: null }, { history: { ...source().history, query: '' } }, { history: { ...source().history, shown: 60 } }]) {
    assert.equal(pageMenuRetainedState({ ...returned(), ...change }, source()), false, JSON.stringify(change));
  }
  const ordered = source(); ordered.rows.push({ href: '/service/second', text: 'Second' });
  assert.equal(pageMenuRetainedState({ ...ordered, rows: [...ordered.rows].reverse() }, ordered), false);
});

test('default local browsing may not have a history state until actual departure remembers it', () => {
  const before = { ...source(), query: '', count: '15 listings on this page', rows: [], filtered: false, resultsHidden: true, history: undefined };
  const after = { ...before, history: { path: PAGE_MENU_LOCAL, query: '', category: '', country: '', shown: 0 } };
  assert.equal(pageMenuRetainedState(after, before), true);
  assert.equal(pageMenuRetainedState({ ...after, history: { ...after.history, shown: 60 } }, before), true, 'Default Back normalizes batch capacity, not visible row count');
  assert.equal(pageMenuRetainedState({ ...after, history: { ...after.history, shown: 120 } }, before), false);
  assert.equal(pageMenuRetainedState({ ...after, history: { ...after.history, shown: 60 } }, { ...before, history: after.history }, { requireHistory: false }), false, 'Before departure retains the raw batch capacity');
  assert.equal(pageMenuRetainedState({ ...after, rows: [{ href: PAGE_MENU_SERVICE, text: 'Unexpected result' }], history: { ...after.history, shown: 60 } }, before), false);
  assert.equal(pageMenuRetainedState(before, before), false, 'Departure/return must have committed real history');
  assert.equal(pageMenuRetainedState(before, before, { requireHistory: false }), true, 'Opening the menu does not synthesize history');
  assert.equal(pageMenuRetainedState({ ...after, history: { ...after.history, query: 'library' } }, before), false);
  const service = { ...source(), path: PAGE_MENU_SERVICE, query: undefined, history: undefined };
  assert.equal(pageMenuRetainedState(service, service), true);
});

function sampler(transform = () => ({})) {
  let at = 0, calls = 0;
  return { sample: async () => ({ ...returned(), ...transform(at, calls++) }), wait: async ms => { at += ms; }, now: () => at, calls: () => calls };
}
const goodReturn = s => pageMenuReturnedFromBFCache(s, source()) && pageMenuRetainedState(s, source())
  && !s.menuOpen && s.focus.visible && !s.focus.inMenu && Math.abs(s.scroll - source().scroll) <= 1;

test('real baseline defect is rejected: persisted page keeps matching local rows and scroll but leaves its menu open', async () => {
  const f = sampler(() => ({ menuOpen: true, focus: { visible: true, inMenu: true, href: '/directory#saved' } }));
  assert.equal(pageMenuReturnedFromBFCache(await f.sample(), source()), true);
  await assert.rejects(waitForPageMenuSettled({ ...f, predicate: goodReturn, timeoutMs: 700 }), /did not settle/);
});

test('return waits for a full quiet window and rejects late overlay, focus loss or cumulative scroll drift', async () => {
  const f = sampler();
  const result = await waitForPageMenuSettled({ ...f, predicate: goodReturn });
  assert.ok(result.durationMs >= 500); assert.ok(result.samples >= 6);
  for (const change of [{ menuOpen: true }, { focus: { visible: false, inMenu: true } }, { scroll: 800 }, { overflow: 9 },
    { documentPresent: false }, { overlay: true }]) {
    const unstable = sampler(at => at < 400 ? {} : change);
    await assert.rejects(waitForPageMenuSettled({ ...unstable, predicate: goodReturn, timeoutMs: 800 }), /did not settle/);
  }
  const drifting = sampler((_at, index) => ({ scroll: 240 + index * .2 }));
  await assert.rejects(waitForPageMenuSettled({ ...drifting, predicate: goodReturn, timeoutMs: 800 }), /did not settle/);
});

test('settling survives only genuine navigation-context errors and bounds a hung sampler', async () => {
  const f = sampler(); let first = true;
  const sample = async () => { if (first) { first = false; throw new Error('Runtime.evaluate: Execution context was destroyed'); } return f.sample(); };
  assert.ok((await waitForPageMenuSettled({ ...f, sample, predicate: goodReturn })).durationMs >= 500);
  await assert.rejects(waitForPageMenuSettled({ sample: async () => { throw new Error('Broken selector'); }, predicate: goodReturn }), /Broken selector/);
  await assert.rejects(waitForPageMenuSettled({ sample: () => new Promise(() => {}), predicate: goodReturn, timeoutMs: 20 }), /did not settle/);
});

const snapshot = globals => vm.runInNewContext(`(${pageMenuReturnSnapshot.toString()})()`, globals);
function domFixture() {
  const rect = { x: 300, y: 12, left: 300, right: 368, top: 12, bottom: 56, width: 68, height: 44 };
  const summary = { tagName: 'SUMMARY', textContent: 'Menu', getAttribute: () => null, getBoundingClientRect: () => rect,
    contains: () => false, matches: () => true };
  const link = { ...summary, tagName: 'A', textContent: 'New York Public Library access', getAttribute: name => name === 'href' ? PAGE_MENU_SERVICE : null };
  const header = { contains: node => node === summary, getBoundingClientRect: () => ({ bottom: 66 }) };
  const input = { value: 'library' }, results = { hidden: false };
  const nodes = new Map([['.rwn-page-menu > summary', summary], ['.legal-header', header], ['h1', { textContent: 'Referral help in New York' }],
    ['[data-directory-query]', input], ['.directory-global-results', results], ['[data-directory-count]', { textContent: '1 matching listing' }],
    ['[data-directory-category][aria-pressed="true"]', { dataset: { directoryCategory: '' } }]]);
  const document = { documentElement: { scrollWidth: 390, scrollHeight: 1700 }, body: {}, activeElement: summary, title: 'Referral help in New York',
    querySelector: selector => nodes.get(selector) || null, querySelectorAll: selector => selector === '.directory-global-result' ? [link] : [],
    elementFromPoint: () => summary };
  const globals = { document, location: { href: source().href, pathname: PAGE_MENU_LOCAL }, history: { state: { rwnDirectory: source().history } },
    innerWidth: 390, innerHeight: 844, scrollY: 240, performance: { timeOrigin: 100, getEntriesByType: () => [{ type: 'navigate' }] },
    __rwnPageMenuQA: returned().probe, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1', outlineStyle: 'solid', outlineWidth: '3px' }) };
  return { globals, nodes, summary, rect };
}

test('serialized snapshot retains actual identity, rows, history, native lifecycle and visible keyboard-ring geometry', () => {
  const f = domFixture(), state = snapshot(f.globals);
  assert.equal(state.ready, true); assert.equal(state.documentPresent, true); assert.equal(state.path, PAGE_MENU_LOCAL);
  assert.equal(state.query, 'library'); assert.equal(state.rows[0].href, PAGE_MENU_SERVICE); assert.equal(state.history.query, 'library');
  assert.equal(state.scroll, 240); assert.equal(state.overflow, 0); assert.equal(state.probe.shows.at(-1).persisted, true);
  assert.equal(state.focus.summary, true); assert.equal(state.focus.visible, true); assert.equal(state.focus.keyboardRing, true);
  assert.equal(state.focus.box.width, 68); assert.equal(state.menuOpen, false); assert.equal(state.summaryVisible, true);
});

test('snapshot rejects provisional documents and cannot turn body, clipped or occluded focus into useful focus', () => {
  const empty = snapshot({});
  assert.equal(empty.ready, false); assert.equal(empty.documentPresent, false); assert.equal(empty.timeOrigin, null);
  assert.equal(empty.overflow, null); assert.equal(empty.focus.visible, false); assert.equal(empty.focus.summary, false);
  for (const mutate of [f => { f.globals.document.documentElement = null; }, f => { f.globals.document.body = null; }, f => { f.nodes.delete('h1'); }]) {
    const f = domFixture(); mutate(f); assert.equal(snapshot(f.globals).ready, false);
  }
  for (const mutate of [f => { f.rect.height = 0; }, f => { f.rect.top = -1; }, f => { f.rect.right = 400; },
    f => { f.globals.document.elementFromPoint = () => ({}); }, f => { f.globals.document.body = f.summary; },
    f => { f.globals.getComputedStyle = () => ({ display: 'none' }); }]) {
    const f = domFixture(); mutate(f); assert.equal(snapshot(f.globals).focus.visible, false);
  }
  const f = domFixture(); f.summary.matches = selector => selector !== ':focus-visible';
  assert.equal(snapshot(f.globals).focus.visible, true); assert.equal(snapshot(f.globals).focus.keyboardRing, false);
});

test('probe records real lifecycle flags and trusted input without changing menu, history or page state', () => {
  const listeners = new Map(), reports = [], root = { open: true };
  const globals = { location: { origin: 'http://rwn.test', href: 'http://rwn.test/directory' }, performance: { timeOrigin: 100 }, scrollY: 240,
    __report: value => reports.push(JSON.parse(value)), window: { addEventListener: (type, callback) => listeners.set(type, callback) },
    document: { addEventListener: (type, callback) => listeners.set(type, callback), querySelector: () => root } };
  vm.runInNewContext(`(${observePageMenuReturn.toString()})('http://rwn.test', '__report')`, globals);
  listeners.get('pageshow')({ persisted: false, isTrusted: true });
  listeners.get('pagehide')({ persisted: true, isTrusted: true });
  listeners.get('pageshow')({ persisted: true, isTrusted: true });
  listeners.get('input')({ isTrusted: true, target: { value: 'library', matches: () => true } });
  assert.equal(globals.__rwnPageMenuQA.shows.length, 2); assert.equal(globals.__rwnPageMenuQA.shows[1].persisted, true);
  assert.equal(globals.__rwnPageMenuQA.hides[0].menuOpen, true); assert.equal(globals.__rwnPageMenuQA.inputs[0].trusted, true);
  assert.equal(reports.length, 3); assert.equal(root.open, true);
  assert.equal(globals.history, undefined);
});

test('BFCache eligibility override is limited to successful allowlisted HTML; ordinary no-store assets and routes are unchanged', () => {
  for (const path of [PAGE_MENU_LOCAL, PAGE_MENU_SERVICE, '/directory', '/editorial-policy', '/sources', '/transparency']) {
    assert.equal(pageMenuFixtureCacheControl(path, 200, 'text/html; charset=utf-8', 'no-store'), 'private, max-age=0, must-revalidate');
  }
  for (const [path, status, contentType] of [[PAGE_MENU_LOCAL, 404, 'text/html'], [PAGE_MENU_LOCAL, 200, 'application/json'],
    ['/api/account', 200, 'text/html'], ['/unrelated', 200, 'text/html'], ['/page-menu.js', 200, 'text/javascript'],
    ['/data/search-index.json', 200, 'application/json']]) assert.equal(pageMenuFixtureCacheControl(path, status, contentType, 'no-store'), 'no-store');
});

test('main browser suite includes native regression while the ordinary server retains no-store semantics', async () => {
  const main = await readFile(new URL('../scripts/browser-service-qa.mjs', import.meta.url), 'utf8');
  const server = await readFile(new URL('../scripts/serve.mjs', import.meta.url), 'utf8');
  const helper = await readFile(new URL('../scripts/qa-page-menu-return.mjs', import.meta.url), 'utf8');
  assert.match(main, /import \{ verifyPageMenuReturn \} from "\.\/qa-page-menu-return\.mjs"/);
  assert.match(main, /await verifyPageMenuReturn\(\{ client, host: HOST, navigate, evaluate, capture \}\)/);
  assert.match(server, /"Cache-Control": "no-store"/);
  assert.match(helper, /Page\.navigateToHistoryEntry/); assert.match(helper, /Input\.dispatchMouseEvent/); assert.match(helper, /Input\.insertText/);
  assert.doesNotMatch(helper, /dispatchEvent\(new (?:PageTransitionEvent|PopStateEvent)|history\.(?:back|forward|go)|menu\.open\s*=/);
});


test('cleanup attempts socket closure after rejected and hung CDP calls without masking the primary failure', async () => {
  const calls = [];
  const errors = await cleanupPageMenuQA([
    ['remove observer', async () => { calls.push('observer'); throw new Error('Disconnected browser'); }],
    ['restore network', () => { calls.push('network'); return new Promise(() => {}); }],
    ['close fixture', async () => { calls.push('closed'); }]
  ], { timeoutMs: 10 });
  assert.deepEqual(calls, ['observer', 'network', 'closed']);
  assert.equal(errors.length, 2); assert.match(errors[0].error, /Disconnected/); assert.match(errors[1].error, /Timed out/);
});

test('worker readiness observes actual activation and control without unregistering or faking lifecycle events', async () => {
  const registration = { installing: {}, waiting: null, active: { state: 'activating', scriptURL: 'http://rwn.test/sw.js' } };
  let at = 0;
  const serviceWorker = { ready: Promise.resolve(registration), controller: null };
  const state = await vm.runInNewContext(`(${pageMenuWorkerReady.toString()})()`, {
    navigator: { serviceWorker }, performance: { now: () => at },
    setTimeout: (callback, ms) => { if (ms !== 8000) { at += ms; registration.installing = null; registration.active.state = 'activated'; serviceWorker.controller = registration.active; queueMicrotask(callback); } return 1; },
    clearTimeout() {}
  });
  assert.equal(state.state, 'activated'); assert.equal(state.controller, 'http://rwn.test/sw.js'); assert.equal(state.durationMs, 50);
});
