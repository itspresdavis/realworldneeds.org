import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { directoryStartupSavedSnapshot, directoryStartupSavedHeaderPoint, directoryStartupSavedReturnReady,
  waitForDirectoryStartupSavedReturn, directoryStartupClickWasDelivered } from '../scripts/qa-directory-startup.mjs';

const query = 'Drinking fountains for London';
const ready = (clear = false) => ({ documentPresent: true, ready: true, pathname: '/directory', href: 'https://rwn.test/directory#directory-results',
  query: clear ? '' : query, country: '', category: 'All help', saved: false, panelVisible: false, menuOpen: false, meaningfulFocus: true,
  history: { path: '/directory', query: clear ? '' : query, country: '', category: '', shown: clear ? 0 : 1 },
  rows: clear ? [] : [{ href: '/service/london-drinking-fountains', text: 'Help finder or referral · check coverage' }],
  count: clear ? '60 listings on this page' : '1 matching listing', resultsHidden: clear, clearHidden: clear,
  scroll: 250, focusedInput: true, focusedHref: null, focusedId: '', focusBox: { x: 20, y: 350, width: 300, height: 44 } });

for (const clear of [false, true]) test(`early Saved Browse oracle requires exact ${clear ? 'intentionally cleared' : 'London finder'} state and a real visible focus owner`, () => {
  const valid = ready(clear), expected = clear ? '' : query;
  assert.equal(directoryStartupSavedReturnReady(valid, expected), true);
  for (const change of [{ ready: false }, { documentPresent: false }, { pathname: '/directory/united-states' },
    { href: 'https://rwn.test/directory#saved' }, { saved: true }, { panelVisible: true }, { menuOpen: true }, { meaningfulFocus: false },
    { query: 'WIC' }, { country: 'United States' }, { category: 'Food' }, { history: { ...valid.history, shown: 120 } },
    { history: { ...valid.history, query: 'WIC' } }, { history: { ...valid.history, country: 'United States' } },
    { history: { ...valid.history, category: 'food' } }, { rows: [{ href: '/service/stale-wic', text: 'WIC' }] },
    { count: 'Searching this directory…' }, { resultsHidden: !clear }]) {
    assert.equal(directoryStartupSavedReturnReady({ ...valid, ...change }, expected), false, JSON.stringify(change));
  }
});

const settleFixture = changed => {
  let time = 0, calls = 0;
  return { sample: async () => ({ ...ready(), ...changed(time, calls++) }), now: () => time, wait: async ms => { time += ms; }, calls: () => calls };
};

test('early Saved return waits for stable final focus and scroll rather than a rendered result', async () => {
  const f = settleFixture(time => time < 300 ? { meaningfulFocus: false, focusedId: 'directory-results' } : {});
  await waitForDirectoryStartupSavedReturn({ ...f, query });
  assert.ok(f.now() >= 800); assert.ok(f.calls() >= 6);
  const footer = settleFixture(time => time < 400 ? {} : { meaningfulFocus: false, focusedId: 'directory-results', scroll: 9000 });
  await assert.rejects(waitForDirectoryStartupSavedReturn({ ...footer, query, timeoutMs: 1200 }), /did not settle/);
});

test('early Saved return does not mistake cumulative drift for settled scroll', async () => {
  const f = settleFixture((_time, index) => ({ scroll: 250 + index * .2 }));
  await assert.rejects(waitForDirectoryStartupSavedReturn({ ...f, query, timeoutMs: 900 }), /did not settle/);
});

test('early Saved geometry witness rejects hidden, clipped, obscured, Saved-heading and static-anchor focus', () => {
  for (const invalid of [false, 'hidden', 'clipped', 'covered', 'saved-heading', 'static-anchor']) {
    const node = { id: invalid === 'static-anchor' ? 'directory-results' : '', contains: () => false,
      matches: () => !['saved-heading', 'static-anchor'].includes(invalid),
      getBoundingClientRect: () => ({ x: 20, y: 300, left: 20, right: 320, top: invalid === 'clipped' ? 20 : 300, bottom: 344, width: 300, height: invalid === 'hidden' ? 0 : 44 }) };
    const globals = { innerWidth: 390, innerHeight: 844, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
      document: { activeElement: node, elementFromPoint: () => invalid === 'covered' ? {} : node,
        querySelector: selector => selector === '.legal-header' ? { getBoundingClientRect: () => ({ bottom: 74 }) } : null } };
    const state = vm.runInNewContext(`(${directoryStartupSavedSnapshot.toString()})({})`, globals);
    assert.equal(state.meaningfulFocus, invalid === false, String(invalid));
  }
});

test('early Saved header reuses settled non-scrolling coordinates and the exact ordered trusted click witness', async () => {
  const listeners = new Map(), node = { contains: () => false };
  let preparations = 0;
  const globals = { document: { querySelector: () => node, addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) },
    prepare: async selector => { assert.equal(selector, '.rwn-page-menu > summary'); preparations++; return { x: 40, y: 40 }; } };
  const point = await vm.runInNewContext(`(${directoryStartupSavedHeaderPoint.toString()})('.rwn-page-menu > summary', prepare)`, globals);
  assert.equal(point.x, 40); assert.equal(preparations, 1);
  for (const type of ['mousedown', 'mouseup', 'click']) listeners.get(type)({ type, target: node, isTrusted: true });
  assert.equal(directoryStartupClickWasDelivered(globals.__rwnEarlySavedHeaderQA), true);
  listeners.get('click')({ type: 'click', target: node, isTrusted: true });
  assert.equal(directoryStartupClickWasDelivered(globals.__rwnEarlySavedHeaderQA), false);
  globals.__rwnEarlySavedHeaderQA.stop(); assert.equal(listeners.size, 0);
});

test('rendered early Saved cases keep real module gates, native anchors, private state and every original startup/IME scenario', async () => {
  const source = await readFile(new URL('../scripts/qa-directory-startup.mjs', import.meta.url), 'utf8');
  assert.match(source, /earlySavedBrowse\(width\);/);
  assert.match(source, /earlySavedBrowse\(width, \{ clear: true \}\)/);
  assert.match(source, /earlySavedBrowse\(width, \{ browseBeforeRuntime: true \}\)/);
  assert.match(source, /earlySavedBrowse\(width, \{ clear: true, browseBeforeRuntime: true \}\)/);
  assert.match(source, /new URL\(s\.href\)\.hash === '#saved' && !s\.ready && held\.module\.length > 0/);
  assert.match(source, /new URL\(s\.href\)\.hash === '#directory-results' && !s\.ready && held\.module\.length > 0/);
  assert.match(source, /click\('\[data-saved-services\] a\[href="#directory-results"\]'\)/);
  assert.match(source, /opened\.probe\.catalogReads === 0 && !held\.catalog\.length/);
  assert.match(source, /Math\.abs\(returned\.scroll - preSaved\.scroll\) < 5/);
  assert.match(source, /assertInputs\(returned, \{ count: inputCount \}\)/);
  assert.match(source, /assertPrivate\(before, \{ \.\.\.snapshot, href: url\.href \}\)/);
  assert.doesNotMatch(source, /dispatchEvent\([^\n]*rwn-directory-restore/);
  for (const original of ['fresh early input', 'stale-history reload edited to London', 'early clear after blur',
    'newer input while startup catalog is pending', 'clear while startup catalog is pending', 'native IME composition across startup']) assert.ok(source.includes(original), original);
  assert.match(source, /!url\.search && !url\.hash && JSON\.stringify\(before\.storage\) === JSON\.stringify\(after\.storage\)/);
});

test('early Saved return has a real deadline even when its browser sampler hangs', async () => {
  await assert.rejects(waitForDirectoryStartupSavedReturn({ sample: () => new Promise(() => {}), query, timeoutMs: 20 }), /did not settle within 20ms/);
});

test('early Saved return retries only navigation context loss and restarts the complete quiet interval', async () => {
  const f = settleFixture(() => ({}));
  let attempts = 0;
  await waitForDirectoryStartupSavedReturn({ ...f, query, sample: async () => {
    if (attempts++ === 4) throw new Error('Runtime.evaluate: Execution context was destroyed.');
    return f.sample();
  } });
  assert.ok(f.now() >= 750, 'the first 200 ms of stability must be discarded after context loss');
  await assert.rejects(waitForDirectoryStartupSavedReturn({ ...f, query, sample: async () => { throw new Error('Application failure'); } }), /Application failure/);
});
