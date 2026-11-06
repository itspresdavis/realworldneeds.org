import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { directoryWicFixture } from '../scripts/qa-catalog-expectations.mjs';
import { readFile } from 'node:fs/promises';
import {
  directorySavedBrowseSnapshot, directorySavedBrowseStateMatches, waitForDirectorySavedBrowseSettled,
  directorySavedBrowseRequestLeaks, directorySavedBrowseHeaderPoint, directorySavedBrowseNavigationWasNative, verifyDirectorySavedBrowse
} from '../scripts/qa-directory-discovery.mjs';

const base = () => ({ documentPresent: true, ready: true, timeOrigin: 100, path: '/directory', query: 'WIC', country: 'United States', category: 'Food',
  count: '395 matching listings', summary: '60 of 395 matches · 437 listings', more: true,
  rows: Array.from({ length: 60 }, (_, i) => ({ href: `/service/wic-${i}`, text: `WIC ${i} — United States · Food · Source checked 2026-10-01` })),
  staticHrefs: ['/service/static'], scroll: 900, focus: '/service/wic-12', focusedId: '', focusKind: 'service', focusName: 'WIC 12',
  focusBox: { x: 20, y: 150, width: 300, height: 60 }, meaningfulFocus: true, menuOpen: false, saved: false, panelVisible: false, overflow: false });
const fixture = (transform = () => ({})) => {
  let time = 0, calls = 0;
  return { sample: async () => ({ ...base(), ...transform(calls++, time) }), wait: async ms => { time += ms; }, now: () => time, calls: () => calls };
};

test('Saved Browse compares complete exact result identity, order, metadata, count, scope and batch state', () => {
  const expected = base();
  assert.equal(directorySavedBrowseStateMatches(structuredClone(expected), expected), true);
  for (const change of [{ ready: false }, { path: '/directory/united-states' }, { query: '' }, { country: '' }, { category: 'All help' },
    { count: '396 matching listings' }, { summary: '60 of 395 matches · 438 listings' }, { more: false },
    { rows: expected.rows.slice(1) }, { rows: [...expected.rows].reverse() },
    { rows: expected.rows.map((row, i) => i === 0 ? { ...row, text: 'Stale text' } : row) }, { staticHrefs: [] }]) {
    assert.equal(directorySavedBrowseStateMatches({ ...expected, ...change }, expected), false, JSON.stringify(change));
  }
});

test('Saved Browse requires a complete quiet interval with multiple samples, not an early animation frame', async () => {
  const f = fixture();
  const result = await waitForDirectorySavedBrowseSettled({ ...f, predicate: s => directorySavedBrowseStateMatches(s, base()) });
  assert.ok(result.durationMs >= 500); assert.ok(result.samples >= 6); assert.ok(f.calls() >= 6);
  assert.equal(result.state.scroll, 900);
});

test('Saved Browse rejects transient correct scroll before the delayed native fragment jumps toward the footer', async () => {
  const f = fixture((_index, time) => time < 400 ? {} : { scroll: 8000, focus: null, focusedId: 'directory-results', focusKind: 'other', meaningfulFocus: false });
  await assert.rejects(waitForDirectorySavedBrowseSettled({ ...f, timeoutMs: 1200, predicate: s => Math.abs(s.scroll - 900) < 5 }), /did not settle/);
  assert.ok(f.calls() > 10);
});

test('Saved Browse restarts the quiet interval when final focus or geometry changes', async () => {
  const f = fixture((_index, time) => time < 300 ? {} : { focus: '/service/wic-13', focusName: 'WIC 13', focusBox: { x: 20, y: 170, width: 300, height: 60 } });
  const result = await waitForDirectorySavedBrowseSettled({ ...f, predicate: () => true });
  assert.ok(result.durationMs >= 800); assert.equal(result.state.focus, '/service/wic-13');
});

for (const [name, change] of Object.entries({
  'Saved still visible': { saved: true }, 'Saved panel not hidden': { panelVisible: true }, 'menu overlay': { menuOpen: true },
  'static anchor focus': { meaningfulFocus: false, focusedId: 'directory-results', focusKind: 'other' },
  'missing scroll': { scroll: null }, 'invalid geometry': { focusBox: { x: NaN, y: 10, width: 200, height: 44 } },
  'provisional document': { documentPresent: false }, 'invalid time origin': { timeOrigin: null }, 'horizontal overflow': { overflow: true }
})) test(`Saved Browse cannot settle with ${name}`, async () => {
  const f = fixture(() => change);
  await assert.rejects(waitForDirectorySavedBrowseSettled({ ...f, timeoutMs: 650, predicate: () => true }), /did not settle/);
});

test('Saved Browse detects cumulative subpixel drift and a hung sampler has a real deadline', async () => {
  const f = fixture(index => ({ scroll: 900 + index * .2 }));
  await assert.rejects(waitForDirectorySavedBrowseSettled({ ...f, timeoutMs: 800, predicate: () => true }), /did not settle/);
  await assert.rejects(waitForDirectorySavedBrowseSettled({ sample: () => new Promise(() => {}), predicate: () => true, timeoutMs: 20 }), /did not settle/);
});

function snapshotFixture({ kind = 'service', hidden = false, covered = false, top = 120 } = {}) {
  const rect = { x: 20, y: top, left: 20, right: 320, top, bottom: top + 60, width: 300, height: hidden ? 0 : 60 };
  const active = { textContent: 'Readable service title', getAttribute: () => null, getBoundingClientRect: () => rect, contains: () => false,
    matches: selector => kind === 'service' ? selector.includes('.directory-global-result') : kind === 'control' && selector.includes('[data-directory-query]') };
  const input = {};
  const nodes = new Map([['.legal-header', { getBoundingClientRect: () => ({ bottom: 74 }) }], ['[data-directory-query]', input],
    ['[data-saved-services]', { getBoundingClientRect: () => ({ height: 0 }) }]]);
  return { globals: { innerWidth: 390, innerHeight: 844, localStorage: {}, sessionStorage: {},
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    document: { activeElement: active, querySelector: selector => nodes.get(selector),
      querySelectorAll: () => [], elementFromPoint: () => covered ? {} : active } }, active };
}
const snapshot = globals => vm.runInNewContext(`(${directorySavedBrowseSnapshot.toString()})({})`, globals);

test('actual Saved Browse snapshot accepts only a fully visible, unobscured real control or service title', () => {
  for (const kind of ['service', 'control']) {
    const state = snapshot(snapshotFixture({ kind }).globals);
    assert.equal(state.meaningfulFocus, true); assert.equal(state.focusKind, kind);
  }
  for (const options of [{ kind: 'static-container' }, { kind: 'Saved heading' }, { hidden: true }, { covered: true }, { top: 50 }, { top: 810 }]) {
    assert.equal(snapshot(snapshotFixture(options).globals).meaningfulFocus, false, JSON.stringify(options));
  }
});

test('Saved Browse snapshot does not invent provisional readiness or useful body focus', () => {
  assert.equal(snapshot({}).meaningfulFocus, false);
  const f = snapshotFixture({ kind: 'body' });
  assert.equal(snapshot(f.globals).focusKind, 'other');
  assert.equal(snapshot(f.globals).meaningfulFocus, false);
});

for (const request of [
  { url: 'https://rwn.test/directory?q=WIC' }, { url: 'https://rwn.test/data.json?x=United%20States' },
  { url: 'https://rwn.test/data.json', postData: 'q=zzzz-saved-browse-private' },
  { url: 'https://rwn.test/data.json', postData: 'location=United+States' },
  { url: 'https://rwn.test/data.json', headers: { Referer: 'https://rwn.test/directory#WIC' } },
  { url: 'https://rwn.test/data.json?category=' }, { url: 'https://rwn.test/data.json?q=unrelated' },
  { url: 'https://rwn.test/data.json?value=library' }, { url: 'https://rwn.test/data.json', postData: '{"need":"Food"}' }
]) test(`Saved Browse privacy catches request transmission: ${JSON.stringify(request)}`, () => assert.equal(directorySavedBrowseRequestLeaks(request), true));

test('ordinary private-history navigation and versioned local assets are allowed', () => {
  for (const url of ['https://rwn.test/directory#saved', 'https://rwn.test/directory#directory-results',
    'https://rwn.test/directory/united-states', 'https://rwn.test/directory/local/united-states/new-york/help/referral',
    'https://rwn.test/data/search-index.json?v=abc123']) assert.equal(directorySavedBrowseRequestLeaks({ url }), false, url);
});

function headerFixture(positions = [20, 20]) {
  let frame = 0, time = 0, top = 20, scrollCalls = 0;
  const node = { hidden: false, disabled: false, contains: () => false, scrollIntoView: () => { scrollCalls++; },
    getBoundingClientRect: () => ({ x: 250, y: top, left: 250, right: 310, top, bottom: top + 44, width: 60, height: 44 }) };
  const globals = { innerWidth: 390, innerHeight: 844, scrollX: 0, scrollY: 4200,
    performance: { now: () => time }, setTimeout, clearTimeout,
    requestAnimationFrame: callback => { time += 16; top = typeof positions === 'function' ? positions(frame++) : positions[Math.min(frame++, positions.length - 1)]; queueMicrotask(callback); },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    document: { querySelector: () => node, elementFromPoint: () => node } };
  return { globals, calls: () => scrollCalls, frames: () => frame };
}

test('Saved sticky header preparation preserves the actual pre-Saved scroll and waits for stable native coordinates', async () => {
  const f = headerFixture([20, 24, 24]);
  const point = await vm.runInNewContext(`(${directorySavedBrowseHeaderPoint.toString()})('.rwn-page-menu > summary')`, f.globals);
  assert.equal(point.y, 46); assert.equal(f.frames(), 3); assert.equal(f.calls(), 0); assert.equal(f.globals.scrollY, 4200);
});

test('covered and continuously moving Saved header targets fail before dispatch', async () => {
  const moving = headerFixture(index => 20 + index);
  await assert.rejects(vm.runInNewContext(`(${directorySavedBrowseHeaderPoint.toString()})('a')`, moving.globals), /did not settle/);
  const covered = headerFixture(); covered.globals.document.elementFromPoint = () => ({});
  await assert.rejects(vm.runInNewContext(`(${directorySavedBrowseHeaderPoint.toString()})('a')`, covered.globals), /covered/);
});

test('scoped commitment keeps an absent country control distinct from a blank global selector', () => {
  const source = verifyDirectorySavedBrowse.toString();
  const closure = source.match(/  const committed = \(s, fixture\) => \{[\s\S]*?\n  \};/)[0];
  const committed = vm.runInNewContext(`${closure}; committed`);
  const state = { ...base(), path: '/directory/united-states', country: undefined,
    history: { path: '/directory/united-states', query: 'WIC', country: '', category: 'food' } };
  const expected = { path: state.path, query: 'WIC', country: undefined, category: 'Food', rows: 60, count: state.count };
  assert.equal(committed(state, expected), true);
  assert.equal(committed({ ...state, country: '' }, expected), false);
  assert.equal(committed({ ...state, history: { ...state.history, query: '' } }, expected), false);
  assert.equal(committed({ ...state, count: 'Searching this directory…' }, expected), false);
});

test('rendered Saved Browse coverage stays additive and uses actual native links, not an event substitute', async () => {
  const source = await readFile(new URL('../scripts/qa-directory-discovery.mjs', import.meta.url), 'utf8');
  const runner = await readFile(new URL('../scripts/browser-service-qa.mjs', import.meta.url), 'utf8');
  const suite = verifyDirectorySavedBrowse.toString();
  assert.match(source, /Saved Back did not restore the latest scroll/);
  assert.match(source, /await verifyDirectorySavedBrowse\(\{ client, host, navigate, evaluate, capture \}\)/);
  assert.match(suite, /for \(width of \[1440, 390\]\)/);
  assert.match(suite, /click\('\[data-saved-services\] a\[href="#directory-results"\]'\)/);
  assert.match(suite, /directoryStartupClickWasDelivered\(activation\)/);
  assert.match(suite, /directorySavedBrowseNavigationWasNative\(navigation, after\.href\)/);
  assert.match(suite, /directorySavedBrowseStateMatches\(s, before\) && Math\.abs\(s\.scroll - before\.scroll\) < 5/);
  assert.match(suite, /traverse\(sixty\.fromEntry, sixty\.before, 'back-prefers-60-entry'\)/);
  assert.match(suite, /traverse\(expanded\.browseEntry, expanded\.after, 'forward-prefers-120-entry'\)/);
  assert.doesNotMatch(suite, /dispatchEvent\([^\n]*rwn-directory-restore|history\.(?:replaceState|pushState)/);
  assert.match(runner, /await verifyDirectoryStartup\(/);
  assert.match(runner, /await verifyLocalDirectorySearch\(/);
});

test('Saved Browse retries only expected destroyed navigation contexts and restarts its quiet interval', async () => {
  const f = fixture();
  const sample = f.sample;
  let attempts = 0;
  const result = await waitForDirectorySavedBrowseSettled({ ...f, sample: async () => {
    if (attempts++ === 4) throw new Error('Runtime.evaluate: Execution context was destroyed.');
    return sample();
  }, predicate: () => true });
  assert.ok(result.durationMs >= 750);
  await assert.rejects(waitForDirectorySavedBrowseSettled({ ...f, sample: async () => { throw new Error('Application failure'); }, predicate: () => true }), /Application failure/);
});

for (const delivery of ['immediate', 'delayed-binding', 'unexpected-target', 'untrusted', 'duplicate']) test(`Saved Browse native click orchestration keeps an exact witness across document destruction (${delivery})`, async () => {
  const suite = verifyDirectorySavedBrowse.toString();
  const closure = suite.match(/  const click = async \(selector, header = false\) => \{[\s\S]*?\n  \};/)[0];
  const events = [], calls = [], pending = [];
  let evaluations = 0, dispatched = false;
  const evidence = type => ({ kind: 'click', type, trusted: delivery !== 'untrusted', expected: delivery !== 'unexpected-target' });
  const publish = event => (delivery === 'delayed-binding' ? pending : events).push(event);
  const context = { events, directoryStartupClickPoint: () => {}, directorySavedBrowseHeaderPoint: () => {},
    directoryStartupClickWasDelivered: value => value.events.length === 3 && ['mousedown', 'mouseup', 'click'].every((type, i) =>
      value.events[i].type === type && value.events[i].trusted && value.events[i].expected),
    evaluate: async () => { assert.equal(dispatched, false, 'Do not inspect the destroyed source document after a native click'); evaluations++; return { x: 30, y: 40 }; },
    sleep: async () => { events.push(...pending.splice(0)); },
    client: { call: async (method, params) => {
      assert.equal(method, 'Input.dispatchMouseEvent'); dispatched = true; calls.push(params.type);
      if (params.type === 'mousePressed') publish(evidence('mousedown'));
      else { publish(evidence('mouseup')); publish(evidence('click')); if (delivery === 'duplicate') publish(evidence('click')); }
    } },
    assert: (ok, label, detail) => assert.ok(ok, `${label}: ${JSON.stringify(detail)}`)
  };
  const click = vm.runInNewContext(`${closure}; click`, context);
  if (['immediate', 'delayed-binding'].includes(delivery)) await click('[data-saved-services] a[href="#directory-results"]');
  else await assert.rejects(click('[data-saved-services] a[href="#directory-results"]'), /exactly once/);
  assert.deepEqual(calls, ['mousePressed', 'mouseReleased']); assert.equal(evaluations, 2);
});

test('Browse navigation witness requires one trusted null-state popstate before one trusted same-destination hashchange', () => {
  const href = 'https://rwn.test/directory#directory-results';
  const popstate = { kind: 'navigation', type: 'popstate', trusted: true, nullState: true, href };
  const hashchange = { kind: 'navigation', type: 'hashchange', trusted: true, nullState: false, href };
  assert.equal(directorySavedBrowseNavigationWasNative([popstate, hashchange], href), true);
  for (const events of [undefined, [], [popstate], [hashchange, popstate], [popstate, hashchange, hashchange],
    [{ ...popstate, nullState: false }, hashchange], [{ ...popstate, trusted: false }, hashchange],
    [popstate, { ...hashchange, trusted: false }], [{ ...popstate, href: 'https://rwn.test/directory#saved' }, hashchange],
    [popstate, { ...hashchange, href: 'https://rwn.test/other#directory-results' }]]) {
    assert.equal(directorySavedBrowseNavigationWasNative(events, href), false, JSON.stringify(events));
  }
  assert.equal(directorySavedBrowseNavigationWasNative([popstate, hashchange], 'not a URL'), false);
  assert.equal(directorySavedBrowseNavigationWasNative([popstate, hashchange], 'https://rwn.test/directory#saved'), false);
});


test('WIC commitment uses private entry history and exact current catalog summary, without URL filters', () => {
  const closure = verifyDirectorySavedBrowse.toString().match(/  const committed = \(s, fixture\) => \{[\s\S]*?\n  \};/)[0];
  const committed = vm.runInNewContext(`${closure}; committed`);
  const expected = directoryWicFixture(60, 'All help');
  const state = { ...base(), category: 'All help', href: 'https://rwn.test/directory#directory-results',
    history: { path: '/directory', query: 'WIC', country: 'United States', category: '' } };
  assert.equal(committed(state, expected), true);
  assert.equal(new URL(state.href).search, '');
  for (const change of [
    { summary: 'Showing 60 of 395 matches across 437 listings' },
    { summary: '60 of 394 matches · 437 listings' },
    { count: '394 matching listings' },
    { history: { ...state.history, country: '' } },
    { history: { ...state.history, query: '' } },
    { rows: state.rows.slice(1) },
  ]) assert.equal(committed({ ...state, ...change }, expected), false, JSON.stringify(change));
});
