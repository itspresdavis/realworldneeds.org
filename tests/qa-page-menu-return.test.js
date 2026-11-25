import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import {
  PAGE_MENU_LOCAL, PAGE_MENU_SERVICE, PAGE_MENU_HREFS, pageMenuLinksUsable, PAGE_MENU_VIEWPORTS, PAGE_MENU_SHORT_HEIGHT_LIMITATION, pageMenuFixtureCacheControl, observePageMenuReturn, pageMenuReturnSnapshot,
  pageMenuRetainedState, pageMenuReturnedFromBFCache, pageMenuFreshDocument, waitForPageMenuSettled, cleanupPageMenuQA, pageMenuWorkerReady, pageMenuNativeEntryWasAdded, pageMenuHistoryTraversalClassification, verifyPageMenuReturn, pageMenuReloadSourceReady, pageMenuReloadRestored
} from '../scripts/qa-page-menu-return.mjs';

const event = (persisted, timeOrigin = 100, extra = {}) => ({ persisted, trusted: true, href: `http://127.0.0.1:9999${PAGE_MENU_LOCAL}`, timeOrigin, ...extra });
const source = () => ({ documentPresent: true, ready: true, href: `http://127.0.0.1:9999${PAGE_MENU_LOCAL}`, path: PAGE_MENU_LOCAL,
  timeOrigin: 100, query: 'library', country: undefined, category: '', count: '1 matching listing', summary: '1 of 1 matches · 15 listings',
  filtered: true, resultsHidden: false, more: false, empty: undefined,
  rows: [{ href: PAGE_MENU_SERVICE, text: 'New York Public Library access · source checked' }], staticRows: [{ href: PAGE_MENU_SERVICE, text: 'New York Public Library access' }],
  history: { path: PAGE_MENU_LOCAL, query: 'library', country: '', category: '', shown: 1, scroll: 240 },
  menuOpen: true, scroll: 240, overflow: 0, overlay: false, saved: false,
  focus: { visible: true, inMenu: true, href: '/directory#saved', box: { x: 12, y: 120, width: 300, height: 50 } },
  probe: { shows: [event(false)], hides: [], inputs: [{ value: 'library', trusted: true }] } });
const returned = () => ({ ...source(), menuOpen: false, focus: { visible: true, inMenu: false, summary: true, href: '', box: { x: 300, y: 12, width: 68, height: 44 } },
  probe: { shows: [event(false), event(true)], hides: [event(true, 100, { menuOpen: true })] } });
const menuLinks = () => PAGE_MENU_HREFS.map(href => ({ href, visible: true, box: { height: 50 } }));

test('usable menu requires the exact reviewed destinations in order and preserves visible touch targets', () => {
  assert.deepEqual(PAGE_MENU_HREFS, ['/', '/directory', '/directory#saved', '/about', '/editorial-policy', '/sources', '/transparency']);
  assert.equal(pageMenuLinksUsable(menuLinks()), true);
  for (const mutate of [
    links => links.splice(3, 1), // The old six-link menu loses About RWN.
    links => { links[3].href = '/sources'; }, // Seven links alone can conceal a duplicate and missing destination.
    links => { links[3].href = 'https://example.org/about'; },
    links => links.reverse(),
    links => { links[3].visible = false; },
    links => { links[3].box.height = 43; },
    links => { links[3].box = null; }
  ]) {
    const links = menuLinks(); mutate(links); assert.equal(pageMenuLinksUsable(links), false, JSON.stringify(links));
  }
  assert.equal(pageMenuLinksUsable(undefined), false);
});

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
    { count: '15 listings on this page' }, { summary: '1 of 1 matches · 437 listings' }, { filtered: false }, { resultsHidden: true },
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


const historySnapshot = (entries, index = entries.length - 1) => ({ entries, index, entry: entries[index] });
const historyEntry = (id, path = `/previous-${id}`) => ({ id, url: `http://127.0.0.1:9999${path}` });

test('native menu navigation accepts capped Chrome history with unchanged currentIndex and exact adjacent entry IDs', () => {
  const before = historySnapshot([...Array.from({ length: 49 }, (_, index) => historyEntry(index + 1)), historyEntry(424, PAGE_MENU_LOCAL)]);
  const after = historySnapshot([...before.entries.slice(1), historyEntry(426, '/directory#saved')]);
  assert.equal(before.index, 49); assert.equal(after.index, 49);
  assert.equal(after.entries[48].id, before.entry.id);
  assert.equal(pageMenuNativeEntryWasAdded(before, after, after.entry.url), true);
});

test('native menu navigation accepts uncapped entry growth and discarded forward history', () => {
  const before = historySnapshot([historyEntry(1), historyEntry(424, PAGE_MENU_LOCAL)]);
  const after = historySnapshot([...before.entries, historyEntry(426, '/directory#saved')]);
  assert.equal(pageMenuNativeEntryWasAdded(before, after, after.entry.url), true);
  const withForward = historySnapshot([...before.entries, historyEntry(425, '/sources')], 1);
  assert.equal(pageMenuNativeEntryWasAdded(withForward, after, after.entry.url), true);
});


test('native menu history oracle rejects intervening, extra, replaced, reused and wrong-target entries', () => {
  const before = historySnapshot([historyEntry(1), historyEntry(424, PAGE_MENU_LOCAL)]);
  const destination = historyEntry(426, '/directory#saved');
  const after = historySnapshot([...before.entries, destination]);
  for (const [name, previous, current] of [
    ['intervening navigation', before, historySnapshot([...before.entries, historyEntry(425, '/sources'), destination])],
    ['extra navigation after destination', before, historySnapshot([...after.entries, historyEntry(427, '/transparency')])],
    ['replaced source', before, historySnapshot([before.entries[0], destination])],
    ['reused source ID', before, historySnapshot([...before.entries, { ...destination, id: 424 }])],
    ['reused earlier entry ID', before, historySnapshot([...before.entries, { ...destination, id: 1 }])],
    ['reused forward entry ID', historySnapshot([...before.entries, destination], 1), after],
    ['wrong preceding ID with same source URL', before, historySnapshot([before.entries[0], { ...before.entry, id: 425 }, destination])],
    ['mutated preceding source URL', before, historySnapshot([before.entries[0], { ...before.entry, url: 'http://127.0.0.1:9999/directory' }, destination])],
    ['wrong destination URL', before, historySnapshot([...before.entries, historyEntry(426, '/sources')])],
    ['old forward history remains after selected destination', before, historySnapshot([...after.entries, historyEntry(427)], 2)],
    ['selected source does not match source snapshot', { ...before, entry: before.entries[0] }, after],
    ['selected destination does not match destination snapshot', before, { ...after, entry: before.entry }],
    ['invalid destination index', before, { ...after, index: -1 }],
    ['missing source history', null, after],
    ['missing destination history', before, { ...after, entries: null }],
    ['malformed history entry', before, historySnapshot([null, before.entry, destination])]
  ]) assert.equal(pageMenuNativeEntryWasAdded(previous, current, destination.url), false, name);
});

test('browser orchestration uses the tested adjacency oracle and retains full native history evidence', async () => {
  const helper = await readFile(new URL('../scripts/qa-page-menu-return.mjs', import.meta.url), 'utf8');
  assert.match(helper, /entries: history\.entries/);
  assert.match(helper, /assert\(pageMenuNativeEntryWasAdded\(sourceEntry, destinationEntry, destinationUrl\)/);
  assert.doesNotMatch(helper, /destinationEntry\.index === sourceEntry\.index \+ 1/);
});


const forwardFixture = ({ fresh = false } = {}) => {
  const href = 'http://127.0.0.1:9999/directory#saved';
  const destinationEvent = (persisted, timeOrigin) => event(persisted, timeOrigin, { href });
  const expectedEntry = historyEntry(426, '/directory#saved');
  const nativeHistory = historySnapshot([historyEntry(424, PAGE_MENU_LOCAL), expectedEntry]);
  const previous = { ...returned(), href, path: '/directory', timeOrigin: 100, saved: true, panelVisible: true,
    focus: { visible: true, inMenu: false, id: 'saved-services-heading' }, probe: { shows: [destinationEvent(false, 100)], hides: [] } };
  const actual = fresh
    ? { ...previous, timeOrigin: 101, navigationType: 'back_forward', nativeHistory, probe: { shows: [destinationEvent(false, 101)], hides: [] } }
    : { ...previous, navigationType: 'navigate', nativeHistory, probe: { shows: [destinationEvent(false, 100), destinationEvent(true, 100)], hides: [destinationEvent(true, 100)] } };
  return { actual, previous, expectedEntry };
};

test('Forward explicitly classifies a rebuilt history destination without calling it a BFCache restoration', () => {
  const { actual, previous, expectedEntry } = forwardFixture({ fresh: true });
  assert.equal(pageMenuReturnedFromBFCache(actual, previous), false);
  assert.equal(pageMenuHistoryTraversalClassification(actual, previous, expectedEntry), 'fresh-history');
});


test('secondary Forward still recognizes genuine persisted pageshow without requiring a new-document timing type', () => {
  const { actual, previous, expectedEntry } = forwardFixture();
  assert.equal(pageMenuHistoryTraversalClassification(actual, previous, expectedEntry), 'persisted');
});

test('secondary traversal rejects unknown, contradictory, ordinary navigate/reload and wrong native-entry evidence', () => {
  for (const mutate of [
    s => { s.navigationType = 'navigate'; }, s => { s.navigationType = 'reload'; }, s => { s.navigationType = ''; },
    s => { s.timeOrigin = 100; }, s => { s.probe.shows[0].persisted = true; }, s => { s.probe.shows[0].trusted = false; },
    s => { s.probe.shows[0].timeOrigin = 100; }, s => { s.probe.shows[0].href = 'http://127.0.0.1:9999/other'; },
    s => { s.probe.shows.push(structuredClone(s.probe.shows[0])); }, s => { s.probe.hides.push(event(true)); }, s => { s.probe = null; },
    s => { s.nativeHistory.entry = { ...s.nativeHistory.entry, id: 999 }; },
    s => { s.nativeHistory = historySnapshot([historyEntry(424, PAGE_MENU_LOCAL)]); }, s => { s.nativeHistory = null; },
    s => { s.href = 'http://127.0.0.1:9999/directory'; }, s => { s.path = PAGE_MENU_LOCAL; }, s => { s.menuOpen = true; },
    s => { s.saved = false; }, s => { s.panelVisible = false; }, s => { s.focus.id = 'different-heading'; },
    s => { s.focus.visible = false; }, s => { s.focus.inMenu = true; }, s => { s.ready = false; }
  ]) {
    const { actual, previous, expectedEntry } = forwardFixture({ fresh: true });
    mutate(actual);
    assert.equal(pageMenuHistoryTraversalClassification(actual, previous, expectedEntry), null, JSON.stringify(actual));
  }
  const f = forwardFixture(); f.actual.timeOrigin = 101;
  assert.equal(pageMenuHistoryTraversalClassification(f.actual, f.previous, f.expectedEntry), null, 'Persisted=true cannot accompany a replacement time origin');
  assert.equal(pageMenuHistoryTraversalClassification(null, f.previous, f.expectedEntry), null);
});

test('fresh secondary source Back requires exact native identity while source state and primary BFCache gates remain separate', () => {
  const previous = returned(), expectedEntry = historyEntry(424, PAGE_MENU_LOCAL);
  const actual = { ...returned(), timeOrigin: 101, navigationType: 'back_forward',
    nativeHistory: historySnapshot([expectedEntry, historyEntry(426, '/directory#saved')], 0),
    probe: { shows: [event(false, 101)], hides: [] } };
  assert.equal(pageMenuHistoryTraversalClassification(actual, previous, expectedEntry), 'fresh-history');
  assert.equal(pageMenuRetainedState(actual, source()), true);
  assert.equal(pageMenuReturnedFromBFCache(actual, source()), false, 'This can never pass a primary persisted Back');
  assert.equal(pageMenuRetainedState({ ...actual, query: '' }, source()), false);
  assert.equal(pageMenuRetainedState({ ...actual, rows: [] }, source()), false);
  assert.equal(pageMenuRetainedState({ ...actual, history: undefined }, source()), false);
});

test('Saved fresh-history destination does not require unrelated directory query history', () => {
  const { actual, previous, expectedEntry } = forwardFixture({ fresh: true });
  actual.query = ''; actual.history = undefined;
  previous.query = ''; previous.history = undefined;
  assert.equal(pageMenuHistoryTraversalClassification(actual, previous, expectedEntry), 'fresh-history');
});

test('actual round-trip orchestration preserves passed primary Back evidence when secondary Forward fails', async () => {
  const code = verifyPageMenuReturn.toString();
  const closure = code.slice(code.indexOf('  const roundTrip = async'), code.indexOf('  client.ws.addEventListener'));
  const src = { ...source(), menuOpen: false, summaryVisible: true };
  const opened = { ...src, menuOpen: true, menuLinks: menuLinks() };
  const dest = { ...forwardFixture({ fresh: true }).actual, timeOrigin: 102,
    probe: { shows: [event(false, 102, { href: 'http://127.0.0.1:9999/directory#saved' })], hides: [] } };
  const back = returned();
  const sourceEntry = historySnapshot([historyEntry(424, PAGE_MENU_LOCAL)]);
  const destinationEntry = historySnapshot([...sourceEntry.entries, historyEntry(426, '/directory#saved')]);
  let samples = 0, entries = 0;
  const evidence = [], navigation = [];
  const globals = { URL, PAGE_MENU_LOCAL, PAGE_MENU_SERVICE, source: src, worker: {}, currentCase: '', origin: 'http://127.0.0.1:9999',
    evidence, pageMenuLinksUsable, pageMenuRetainedState, pageMenuFreshDocument, pageMenuReturnedFromBFCache, pageMenuNativeEntryWasAdded,
    pageMenuHistoryTraversalClassification, historySnapshot: async () => {},
    open: async () => src, type: async () => {}, evaluate: async () => {}, nativeClick: async () => ({ trusted: true }), capture: async () => {},
    client: { call: async (method, params) => navigation.push({ method, params }) },
    entry: async () => (++entries === 2 ? destinationEntry : sourceEntry),
    assert: (ok, label) => assert.ok(ok, label),
    settled: async predicate => {
      const states = [src, src, opened, dest, back];
      if (samples >= states.length) throw new Error('Intentional secondary Forward failure');
      const state = states[samples++]; assert.equal(Boolean(predicate(state)), true); return state;
    }
  };
  const roundTrip = vm.runInNewContext(`${closure}; roundTrip`, globals);
  await assert.rejects(roundTrip({ path: PAGE_MENU_LOCAL, target: '/directory#saved', query: 'library', name: 'partial-proof', repeat: true }), /Intentional secondary Forward failure/);
  assert.equal(evidence.length, 1); assert.equal(evidence[0].primaryBackClassification, 'persisted');
  assert.equal(evidence[0].back.probe.shows.at(-1).persisted, true); assert.equal(evidence[0].primaryBackEntry.entry.id, 424);
  assert.equal(evidence[0].phase, 'secondary-forward-1'); assert.equal(evidence[0].repeated.length, 1);
  assert.equal(navigation.filter(call => call.method === 'Page.navigateToHistoryEntry').length, 2, 'One primary Back and one Forward; no retry until cached');
});

test('lifecycle viewport coverage is explicit and does not claim the excluded short-height geometry', () => {
  assert.deepEqual(PAGE_MENU_VIEWPORTS.map(({ width, height }) => [width, height]), [[390, 844], [320, 780], [390, 500]]);
  const zoom = PAGE_MENU_VIEWPORTS[2];
  assert.equal(zoom.name, 'zoom-equivalent-200'); assert.equal(zoom.deviceScaleFactor, 2); assert.equal(zoom.mobile, false);
  assert.deepEqual([zoom.width * 2, zoom.height * 2], [780, 1000]);
  assert.equal(PAGE_MENU_SHORT_HEIGHT_LIMITATION.excludedViewport.height, 422);
  assert.ok(PAGE_MENU_SHORT_HEIGHT_LIMITATION.measuredMenuBottom > 422);
  assert.match(PAGE_MENU_SHORT_HEIGHT_LIMITATION.note, /does not verify 422px-height coverage/);
});

test('reload is exercised before deliberate native Tab changes the live viewport', () => {
  const flow = verifyPageMenuReturn.toString();
  const reload = flow.indexOf("client.call('Page.reload'");
  const tab = flow.indexOf("key: 'Tab'");
  assert.ok(reload >= 0 && tab >= 0 && reload < tab, 'Reload must use the retained browsing baseline before Tab scrolls focus into view');
});


test('reload baseline rejects post-Tab live/history disagreement, missing history, stale documents and changed retained state', () => {
  const baseline = returned();
  assert.equal(pageMenuReloadSourceReady(baseline, baseline), true);
  for (const change of [{ scroll: 219 }, { history: { ...baseline.history, scroll: 219 } }, { history: undefined },
    { scroll: NaN }, { history: { ...baseline.history, scroll: Infinity } }, { timeOrigin: 101 }, { timeOrigin: null },
    { query: '' }, { rows: [] }, { menuOpen: true }, { saved: true }, { panelVisible: true },
    { focus: { visible: false, inMenu: false } }, { documentPresent: false }]) {
    assert.equal(pageMenuReloadSourceReady({ ...baseline, ...change }, baseline), false, JSON.stringify(change));
  }
  const uncommitted = { ...baseline, scroll: 219 };
  assert.equal(pageMenuReloadSourceReady(uncommitted, uncommitted), false, 'A quiet mismatch cannot become its own accepted baseline');
});

test('fresh reload must retain both exact committed scroll and state, with true reload lifecycle and useful focus', () => {
  const baseline = returned();
  const fresh = { ...baseline, timeOrigin: 101, navigationType: 'reload', probe: { shows: [event(false, 101)], hides: [] } };
  assert.equal(pageMenuReloadRestored(fresh, baseline), true);
  for (const change of [{ scroll: 219 }, { history: { ...fresh.history, scroll: 219 } }, { history: undefined },
    { navigationType: 'navigate' }, { navigationType: 'back_forward' }, { timeOrigin: 100 },
    { query: '' }, { rows: [] }, { focus: { visible: false } }, { menuOpen: true }]) {
    assert.equal(pageMenuReloadRestored({ ...fresh, ...change }, baseline), false, JSON.stringify(change));
  }
  assert.equal(pageMenuReloadRestored(fresh, { ...baseline, scroll: 219 }), false);
});

function completeRoundTripFixture(repeat, openedLinks = menuLinks()) {
  const code = verifyPageMenuReturn.toString();
  const closure = code.slice(code.indexOf('  const roundTrip = async'), code.indexOf('  client.ws.addEventListener'));
  const src = { ...source(), menuOpen: false, summaryVisible: true };
  const opened = { ...src, menuOpen: true, menuLinks: openedLinks };
  const destinationHref = 'http://127.0.0.1:9999/directory#saved';
  const sourceEntry = historySnapshot([historyEntry(424, PAGE_MENU_LOCAL)]);
  const destinationEntry = historySnapshot([...sourceEntry.entries, historyEntry(426, '/directory#saved')]);
  const freshDestination = timeOrigin => ({ ...forwardFixture({ fresh: true }).actual, timeOrigin,
    probe: { shows: [event(false, timeOrigin, { href: destinationHref })], hides: [] } });
  const destination = freshDestination(200), primary = returned();
  const back = count => ({ ...returned(), nativeHistory: sourceEntry, probe: {
    shows: [event(false), ...Array.from({ length: count }, () => event(true))],
    hides: Array.from({ length: count }, () => event(true, 100, { menuOpen: true }))
  } });
  const finalBack = repeat ? back(3) : primary;
  const reload = { ...finalBack, timeOrigin: 300, navigationType: 'reload', probe: { shows: [event(false, 300)], hides: [] } };
  const keyboard = { ...(repeat ? reload : primary), scroll: 219,
    focus: { visible: true, inMenu: false, keyboardRing: true, href: '/' } };
  const states = [src, src, opened, destination, primary,
    ...(repeat ? [freshDestination(201), back(2), freshDestination(202), finalBack, finalBack, reload] : []), keyboard];
  let samples = 0, entries = 0;
  const evidence = [], calls = [];
  const globals = { URL, PAGE_MENU_LOCAL, PAGE_MENU_SERVICE, worker: {}, currentCase: '', origin: 'http://127.0.0.1:9999', evidence,
    pageMenuLinksUsable, pageMenuRetainedState, pageMenuFreshDocument, pageMenuReturnedFromBFCache, pageMenuNativeEntryWasAdded,
    pageMenuHistoryTraversalClassification, pageMenuReloadSourceReady, pageMenuReloadRestored, historySnapshot: async () => {},
    open: async () => src, type: async () => {}, evaluate: async () => {}, nativeClick: async () => ({ trusted: true }), capture: async () => {},
    client: { call: async (method, params) => calls.push({ method, params }) },
    entry: async () => (++entries === 2 ? destinationEntry : sourceEntry), assert: (ok, label) => assert.ok(ok, label),
    settled: async (predicate, label) => {
      const state = states[samples++]; assert.ok(state, `Unexpected state request: ${label}`);
      assert.equal(Boolean(predicate(state)), true, label); return state;
    }
  };
  return { run: vm.runInNewContext(`${closure}; roundTrip`, globals), evidence, calls };
}

test('actual round-trip rejects seven visible links when About RWN is replaced by a duplicate', async () => {
  const links = menuLinks(); links[3].href = '/sources';
  const fixture = completeRoundTripFixture(false, links);
  await assert.rejects(fixture.run({ path: PAGE_MENU_LOCAL, target: '/directory#saved', query: 'library', name: 'wrong-menu' }), /Menu remains usable before real navigation/);
  assert.equal(fixture.evidence.length, 0, 'A wrong menu must not produce a primary Back receipt');
  assert.equal(fixture.calls.length, 0, 'A wrong menu must fail before native history traversal');
});

for (const repeat of [true, false]) test(`actual orchestration separates committed reload from native Tab (repeat=${repeat})`, async () => {
  const fixture = completeRoundTripFixture(repeat);
  await fixture.run({ path: PAGE_MENU_LOCAL, target: '/directory#saved', query: 'library', name: 'reload-order', repeat });
  const record = fixture.evidence[0];
  assert.equal(record.phase, 'complete'); assert.equal(record.keyboard.scroll, 219); assert.equal(record.keyboard.history.scroll, 240);
  assert.equal(record.keyboardAfter, repeat ? 'fresh-reload' : 'persisted-back');
  const reloadIndex = fixture.calls.findIndex(call => call.method === 'Page.reload');
  const tabIndex = fixture.calls.findIndex(call => call.method === 'Input.dispatchKeyEvent' && call.params.key === 'Tab');
  assert.ok(tabIndex >= 0);
  if (repeat) {
    assert.ok(reloadIndex >= 0 && reloadIndex < tabIndex);
    assert.equal(record.reloadSource.scroll, 240); assert.equal(record.reloadSource.history.scroll, 240);
    assert.equal(record.reload.scroll, 240); assert.equal(record.reload.history.scroll, 240);
    assert.notEqual(record.reload.timeOrigin, record.reloadSource.timeOrigin);
    assert.equal(record.reload.probe.shows[0].persisted, false); assert.equal(record.keyboard.timeOrigin, record.reload.timeOrigin);
  } else {
    assert.equal(reloadIndex, -1); assert.equal(record.reloadSource, undefined);
    assert.equal(record.keyboard.timeOrigin, record.back.timeOrigin); assert.equal(record.back.probe.shows.at(-1).persisted, true);
  }
});
