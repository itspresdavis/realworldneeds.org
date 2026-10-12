import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { observeStartup, directoryStartupSavedSnapshot, directoryStartupSavedHeaderPoint, directoryStartupSavedReturnReady,
  waitForDirectoryStartupSavedReturn, directoryStartupClickWasDelivered, directorySavedBrowseHeaderPoint,
  directoryStartupSavedBaselineReady, waitForDirectoryStartupSavedBaseline, directoryStartupSavedBaselinePreserved,
  directoryStartupReloadSourceReady, directoryStartupReloadDestinationReady, waitForDirectoryStartupReloadGeometry } from '../scripts/qa-directory-startup.mjs';

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

const baseline = () => ({ documentPresent: true, ready: false, pathname: '/directory', href: 'https://rwn.test/directory#directory-results', timeOrigin: 100,
  query, country: '', countryDisabled: true, focusedInput: true, meaningfulFocus: true, saved: false, panelVisible: false, menuOpen: false,
  moduleHeld: 1, catalogHeld: 0, rows: [], selection: [query.length, query.length], viewport: { width: 390, height: 844 },
  scroll: 14, inputBox: { x: 20, y: 350, width: 300, height: 44 },
  probe: { catalogReads: 0, catalogSettled: 0, inputs: [{ value: query, trusted: true, runtime: false }] } });
const expectedBaseline = { query, inputCount: 1, timeOrigin: 100 };
const baselineFixture = (change = () => ({})) => {
  let time = 0, calls = 0;
  return { sample: async () => ({ ...baseline(), ...change(time, calls++) }), now: () => time, wait: async ms => { time += ms; }, calls: () => calls };
};

test('pre-Saved baseline requires exact input, phase, focus, empty runtime results and no catalog activity', () => {
  assert.equal(directoryStartupSavedBaselineReady(baseline(), expectedBaseline), true);
  for (const changed of [{ query: '' }, { country: 'United States' }, { countryDisabled: false }, { timeOrigin: 99 }, { ready: true },
    { moduleHeld: 0 }, { catalogHeld: 1 }, { focusedInput: false }, { meaningfulFocus: false }, { menuOpen: true }, { saved: true },
    { panelVisible: true }, { rows: ['stale'] }, { probe: { ...baseline().probe, catalogReads: 1 } },
    { probe: { ...baseline().probe, inputs: [{ value: query, trusted: false, runtime: false }] } },
    { probe: { ...baseline().probe, inputs: [{ value: query, trusted: true, runtime: true }] } },
    { probe: { ...baseline().probe, inputs: [...baseline().probe.inputs, ...baseline().probe.inputs] } }]) {
    assert.equal(directoryStartupSavedBaselineReady({ ...baseline(), ...changed }, expectedBaseline), false, JSON.stringify(changed));
  }
});

test('pre-Saved baseline waits out more than 60 frames of scroll before capturing 500 ms of unchanged query geometry', async () => {
  const f = baselineFixture(time => ({ scroll: time < 1800 ? 14 + time / 50 : 0, inputBox: { x: 20, y: time < 1800 ? 350 - time / 50 : 364, width: 300, height: 44 } }));
  const settled = await waitForDirectoryStartupSavedBaseline({ ...f, ...expectedBaseline });
  assert.ok(settled.durationMs >= 2300); assert.ok(settled.samples >= 6);
  assert.equal(settled.state.scroll, 0); assert.equal(settled.state.inputBox.y, 364);
  assert.ok(settled.trace.length <= 40);
});

test('pre-Saved baseline rejects transient initial stability followed by the failing 14-to-0 delayed scroll', async () => {
  const f = baselineFixture(time => time < 400 ? {} : { scroll: 0 });
  const settled = await waitForDirectoryStartupSavedBaseline({ ...f, ...expectedBaseline });
  assert.ok(settled.durationMs >= 900); assert.equal(settled.state.scroll, 0);
});

test('pre-Saved baseline rejects continuous subpixel movement, lost focus and hangs without changing the page', async () => {
  for (const change of [(_time, index) => ({ scroll: 14 + index * .01 }), () => ({ focusedInput: false }), () => ({ query: 'WIC' }), () => ({ moduleHeld: 0 })]) {
    const f = baselineFixture(change);
    await assert.rejects(waitForDirectoryStartupSavedBaseline({ ...f, ...expectedBaseline, timeoutMs: 800 }), /baseline did not settle/);
  }
  await assert.rejects(waitForDirectoryStartupSavedBaseline({ sample: () => new Promise(() => {}), ...expectedBaseline, timeoutMs: 20 }), /within 20ms/);
});

test('pre-Saved baseline retries only navigation-context errors and discards earlier quiet time', async () => {
  const f = baselineFixture(); let attempts = 0;
  const settled = await waitForDirectoryStartupSavedBaseline({ ...f, ...expectedBaseline, sample: async () => {
    if (attempts++ === 4) throw new Error('Runtime.evaluate: Execution context was destroyed.');
    return f.sample();
  } });
  assert.ok(settled.durationMs >= 750);
  await assert.rejects(waitForDirectoryStartupSavedBaseline({ ...f, ...expectedBaseline, sample: async () => { throw new Error('Application failure'); } }), /Application failure/);
});

test('Menu/Saved can move focus to its real control but cannot change the captured directory baseline', () => {
  const before = baseline(), current = { ...baseline(), focusedInput: false, meaningfulFocus: false, menuOpen: true };
  assert.equal(directoryStartupSavedBaselinePreserved(current, before), true);
  for (const change of [{ scroll: 14.01 }, { query: '' }, { country: 'United States' }, { ready: true }, { moduleHeld: 0 }, { catalogHeld: 1 },
    { inputBox: { ...current.inputBox, y: 350.01 } }, { viewport: { width: 390, height: 843 } },
    { probe: { ...current.probe, inputs: [] } }, { probe: { ...current.probe, catalogReads: 1 } }]) {
    assert.equal(directoryStartupSavedBaselinePreserved({ ...current, ...change }, before), false, JSON.stringify(change));
  }
});

function timedHeaderFixture({ stableAt = 0, paused = false, timeoutMs = 8000 } = {}) {
  let time = 0, frames = 0, cancelled = 0;
  const node = { contains: () => false, getBoundingClientRect: () => ({ x: 200, y: 20, left: 200, right: 260, top: 20, bottom: 64, width: 60, height: 44 }) };
  const globals = { innerWidth: 1440, innerHeight: 900, scrollX: 0, scrollY: 0,
    performance: paused ? performance : { now: () => time }, setTimeout, clearTimeout,
    requestAnimationFrame: callback => { frames++; if (paused) return frames; time += 16; globals.scrollY = time < stableAt ? time : stableAt; queueMicrotask(callback); return frames; },
    cancelAnimationFrame: () => { cancelled++; },
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    document: { querySelector: () => node, elementFromPoint: () => node } };
  const run = () => vm.runInNewContext(`(${directorySavedBrowseHeaderPoint.toString()})('a[href="/directory#saved"]', { timeoutMs: ${timeoutMs} })`, globals);
  return { globals, run, frames: () => frames, cancelled: () => cancelled };
}

test('header preparation accepts genuine slow stability beyond the former 60-frame limit without replaying input', async () => {
  const f = timedHeaderFixture({ stableAt: 1800 });
  const point = await f.run();
  assert.equal(point.y, 42); assert.ok(f.frames() > 60);
  assert.equal(f.globals.__rwnSavedHeaderGeometryQA.settled, true);
  assert.ok(f.globals.__rwnSavedHeaderGeometryQA.trace.length <= 40);
  assert.equal(f.cancelled(), f.frames());
});

test('header preparation has an 8-second wall-clock bound with capped geometry diagnostics', async () => {
  const f = timedHeaderFixture({ stableAt: 10000 });
  await assert.rejects(f.run(), error => {
    assert.match(error.message, /did not settle within 8000ms/);
    assert.match(error.message, /"scroll"/); assert.match(error.message, /"elapsedMs"/);
    return true;
  });
  assert.equal(f.frames(), 500); assert.equal(f.globals.__rwnSavedHeaderGeometryQA.trace.length, 40);
});

test('paused animation frames cannot bypass the header deadline', async () => {
  const f = timedHeaderFixture({ paused: true, timeoutMs: 20 });
  await assert.rejects(f.run(), /did not settle within 20ms/);
  assert.equal(f.frames(), 1); assert.equal(f.cancelled(), 1);
});

test('early Saved captures the quiet baseline before Menu, checks preservation, and writes bounded failure evidence', async () => {
  const source = await readFile(new URL('../scripts/qa-directory-startup.mjs', import.meta.url), 'utf8');
  assert.match(source, /baselineEvidence = await waitForDirectoryStartupSavedBaseline\([\s\S]*?const preSaved = baselineEvidence\.state;[\s\S]*?clickEarlySavedHeader\('\.rwn-page-menu > summary', preSaved\)/);
  assert.match(source, /directoryStartupSavedBaselinePreserved\(current, baseline\)/);
  assert.match(source, /activation\.events\.every\(event => event\.scroll === baseline\.scroll\)/);
  assert.match(source, /directory-startup-failure\.json/);
  assert.match(source, /Diagnostic timed out[\s\S]*?1500/);
  assert.match(source, /Math\.abs\(returned\.scroll - preSaved\.scroll\) < 5/);
  assert.doesNotMatch(directorySavedBrowseHeaderPoint.toString(), /scrollIntoView|scrollTo\(|dispatchMouseEvent/);
});

for (const movement of ['none', 'during-preparation', 'between-native-events']) test(`actual early Saved click orchestration preserves the captured baseline without replay (${movement})`, async () => {
  const source = await readFile(new URL('../scripts/qa-directory-startup.mjs', import.meta.url), 'utf8');
  const closure = source.match(/  const clickEarlySavedHeader = async \(selector, baseline = null\) => \{[\s\S]*?\n  \};/)[0];
  const before = baseline(), events = [], calls = [];
  let nativeStarted = false, scroll = before.scroll;
  const context = { directoryStartupSavedHeaderPoint, directorySavedBrowseHeaderPoint,
    directoryStartupSavedBaselinePreserved, directoryStartupClickWasDelivered,
    savedState: async () => ({ ...before, scroll: movement === 'during-preparation' ? before.scroll + 1 : scroll }),
    evaluate: async () => nativeStarted ? { events } : { x: 250, y: 42 },
    client: { call: async (_method, { type }) => {
      nativeStarted = true; calls.push(type);
      if (type === 'mousePressed') {
        events.push({ type: 'mousedown', trusted: true, expected: true, scroll });
        if (movement === 'between-native-events') scroll++;
      } else for (const eventType of ['mouseup', 'click']) events.push({ type: eventType, trusted: true, expected: true, scroll });
    } },
    assert: (ok, label, detail) => assert.ok(ok, `${label}: ${JSON.stringify(detail)}`)
  };
  const click = vm.runInNewContext(`${closure}; clickEarlySavedHeader`, context);
  if (movement === 'none') await click('.rwn-page-nav a[href="/directory#saved"]', before);
  else await assert.rejects(click('.rwn-page-nav a[href="/directory#saved"]', before), /settled directory baseline/);
  assert.deepEqual(calls, movement === 'during-preparation' ? [] : ['mousePressed', 'mouseReleased']);
});

const reloadSource = () => ({ ...baseline(), ready: true, bodyPresent: true, documentReadyState: 'complete', country: 'United States', countryDisabled: false,
  query: 'WIC', category: 'Food', rows: Array.from({ length: 120 }, (_, i) => ({ href: `/service/wic-${i}` })), resultsHidden: false,
  history: { path: '/directory', query: 'WIC', country: 'United States', category: 'food', shown: 120, scroll: 5505 }, scroll: 5505,
  documentHeight: 12000, staticCount: 60, inputBox: { x: 190, y: -5155, width: 632, height: 44 }, headerBox: { x: 0, y: 0, width: 1440, height: 74 },
  viewport: { width: 1440, height: 900 }, moduleHeld: 0, focusedInput: false, meaningfulFocus: true });
const reloadDestination = () => ({ ...reloadSource(), ready: false, timeOrigin: 200, documentReadyState: 'interactive', query: '', country: '', countryDisabled: true,
  category: undefined, rows: [], resultsHidden: undefined, moduleHeld: 1, meaningfulFocus: false,
  probe: { inputs: [], catalogReads: 0, catalogSettled: 0 } });
const reloadFixture = (change = () => ({}), destination = true) => {
  let time = 0, calls = 0;
  return { sample: async () => ({ ...(destination ? reloadDestination() : reloadSource()), ...change(time, calls++) }), now: () => time,
    wait: async ms => { time += ms; }, calls: () => calls };
};

test('reload source requires the genuine stable WIC/US/Food/120 entry and agreement between actual scroll and history', () => {
  assert.equal(directoryStartupReloadSourceReady(reloadSource()), true);
  for (const change of [{ ready: false }, { bodyPresent: false }, { query: '' }, { rows: [] }, { country: '' }, { category: 'All help' },
    { scroll: 5504 }, { history: { ...reloadSource().history, scroll: 0 } }, { saved: true }, { menuOpen: true }]) {
    assert.equal(directoryStartupReloadSourceReady({ ...reloadSource(), ...change }), false, JSON.stringify(change));
  }
});

test('reload destination accepts a parsed, offscreen-input static page at its true native restored position', () => {
  const state = reloadDestination();
  assert.equal(state.meaningfulFocus, false);
  assert.equal(directoryStartupReloadDestinationReady(state, reloadSource(), 200), true);
  for (const change of [{ documentReadyState: 'loading' }, { timeOrigin: 100 }, { ready: true }, { moduleHeld: 0 }, { scroll: 0 },
    { scroll: 5504 }, { documentHeight: 5505 }, { staticCount: 0 }, { countryDisabled: false },
    { probe: { ...state.probe, inputs: [{ trusted: true, value: 'WIC' }] } }, { probe: { ...state.probe, catalogReads: 1 } }, { catalogHeld: 1 }]) {
    assert.equal(directoryStartupReloadDestinationReady({ ...state, ...change }, reloadSource(), 200), false, JSON.stringify(change));
  }
  assert.equal(directoryStartupReloadDestinationReady({ ...state, scroll: 0 }, { ...reloadSource(), scroll: 0 }, 200), false, 'zero cannot be an invented clamp target');
});

test('neutral initial geometry never accepts a quiet zero plateau before delayed native restoration', async () => {
  const f = reloadFixture(time => time < 1200 ? { scroll: 0, inputBox: { ...reloadDestination().inputBox, y: 350 } } : {});
  const found = await waitForDirectoryStartupReloadGeometry({ ...f, source: reloadSource(), timeOrigin: 200 });
  assert.ok(found.durationMs >= 1700); assert.equal(found.state.scroll, 5505); assert.equal(found.state.inputBox.y, -5155);
  assert.equal(found.state.probe.inputs.length, 0); assert.equal(found.state.probe.catalogReads, 0); assert.equal(found.state.moduleHeld, 1);
});

test('reload waiting requires parsing and sufficient static extent before timing a full exact quiet interval', async () => {
  const f = reloadFixture(time => time < 300 ? { documentReadyState: 'loading' } : time < 800 ? { documentHeight: 5000 } : {});
  const found = await waitForDirectoryStartupReloadGeometry({ ...f, source: reloadSource(), timeOrigin: 200 });
  assert.ok(found.durationMs >= 1300); assert.equal(found.state.documentHeight, 12000);
});

test('source quiet sampling does not trust the first seedStaleHistory scroll while it is still moving', async () => {
  const f = reloadFixture(time => { const scroll = time < 1000 ? 4000 + time : 5505; return { scroll, history: { ...reloadSource().history, scroll } }; }, false);
  const found = await waitForDirectoryStartupReloadGeometry(f);
  assert.ok(found.durationMs >= 1500); assert.equal(found.state.scroll, 5505); assert.equal(found.state.history.scroll, 5505);
});

test('reload geometry rejects perpetual movement, premature edits and a hung browser', async () => {
  for (const change of [(_time, index) => ({ inputBox: { ...reloadDestination().inputBox, y: -5155 + index * .01 } }),
    () => ({ probe: { ...reloadDestination().probe, inputs: [{ trusted: true, value: 'WIC' }] } }), () => ({ scroll: 0 })]) {
    const f = reloadFixture(change);
    await assert.rejects(waitForDirectoryStartupReloadGeometry({ ...f, source: reloadSource(), timeOrigin: 200, timeoutMs: 800 }), /did not settle/);
  }
  await assert.rejects(waitForDirectoryStartupReloadGeometry({ sample: () => new Promise(() => {}), source: reloadSource(), timeOrigin: 200, timeoutMs: 20 }), /within 20ms/);
});

test('reload geometry retries only navigation-context loss and resets the complete quiet window', async () => {
  const f = reloadFixture(); let calls = 0;
  const found = await waitForDirectoryStartupReloadGeometry({ ...f, source: reloadSource(), timeOrigin: 200, sample: async () => {
    if (calls++ === 4) throw new Error('Runtime.evaluate: Execution context was destroyed.');
    return f.sample();
  } });
  assert.ok(found.durationMs >= 750);
  await assert.rejects(waitForDirectoryStartupReloadGeometry({ ...f, sample: async () => { throw new Error('Application failure'); } }), /Application failure/);
});

test('actual start helper captures source state immediately before Page.reload without changing entry state', async () => {
  const source = await readFile(new URL('../scripts/qa-directory-startup.mjs', import.meta.url), 'utf8');
  const closure = source.match(/  const start = async \(\{ reload = false, catalog = true, beforeReload \} = \{\}\) => \{[\s\S]*?\n  \};/)[0];
  const order = [], before = reloadSource(), held = { module: [], catalog: [] }, hold = {};
  const context = { hold, held, host: 'https://rwn.test', directoryStartupStaticReady: () => true,
    navigate: async () => { throw new Error('Reload must not manufacture another entry'); },
    state: async () => { order.push('read-source'); return before; },
    client: { call: async method => { order.push(method); } },
    wait: async () => { order.push('read-destination'); return { ...reloadDestination(), rows: [], disabled: false }; },
    assert: (ok, label) => assert.ok(ok, label) };
  const start = vm.runInNewContext(`${closure}; start`, context);
  await start({ reload: true, beforeReload: current => { order.push('capture-source'); assert.equal(current, before); assert.equal(current.scroll, 5505); } });
  assert.deepEqual(order, ['read-source', 'capture-source', 'Page.reload', 'read-destination']);
  assert.equal(before.history.scroll, 5505); assert.equal(before.href, 'https://rwn.test/directory#directory-results');
});

test('reload fixture completes native restoration before its first focus/type and keeps the later visible baseline unchanged', async () => {
  const source = await readFile(new URL('../scripts/qa-directory-startup.mjs', import.meta.url), 'utf8');
  assert.match(source, /await seedStaleHistory\(\);[\s\S]*?source: await waitForDirectoryStartupReloadGeometry\(\{ sample: savedState \}\)/);
  assert.match(source, /initialReloadEvidence\.destination = await waitForDirectoryStartupReloadGeometry\([\s\S]*?await type\(clear \? 'WIC' : QUERY\);/);
  assert.match(source, /captured\.scroll === stable\.scroll/);
  assert.match(source, /baselineEvidence = await waitForDirectoryStartupSavedBaseline/);
  assert.match(source, /Math\.abs\(returned\.scroll - preSaved\.scroll\) < 5/);
  assert.doesNotMatch(waitForDirectoryStartupReloadGeometry.toString(), /focus\(|scrollIntoView|scrollTo\(|replaceState|pushState|dispatchMouseEvent|\.hash\s*=/);
});


function observationFixture() {
  const listeners = { window: new Map(), document: new Map() }, frames = [], calls = [];
  const outcome = { value: {}, error: null };
  let time = 0, geometryReads = 0;
  class Element {
    constructor(id = '') { this.id = id; this.tagName = 'INPUT'; }
    getAttribute() { return null; }
    matches(selector) { return selector === '[data-directory-query]' && this.id === 'query'; }
    getBoundingClientRect() { geometryReads++; return { x: 190, y: (this.id === 'directory-results' ? 1000 : 349) - globals.scrollY, width: 632, height: 44 }; }
    scrollIntoView(...args) { calls.push({ method: 'scrollIntoView', receiver: this, args }); if (outcome.error) throw outcome.error; return outcome.value; }
  }
  class HTMLElement extends Element {
    focus(...args) { calls.push({ method: 'focus', receiver: this, args }); if (outcome.error) throw outcome.error; return outcome.value; }
  }
  const input = new HTMLElement('query'), root = new HTMLElement('root'), anchor = new HTMLElement('directory-results');
  root.rwnDirectoryStartup = { edited: true, browse: true, scroll: 0 };
  const document = { readyState: 'interactive', documentElement: { scrollHeight: 19317 }, activeElement: input,
    querySelector: selector => ({ '[data-directory-search]': root, '[data-directory-query]': input, '[data-directory-categories]': root })[selector] || null,
    getElementById: id => id === 'directory-results' ? anchor : null,
    addEventListener: (type, listener, options) => { assert.equal(Boolean(options?.passive) || options === true, true); listeners.document.set(type, listener); } };
  const globals = { Element, HTMLElement, document, location: { origin: 'https://rwn.test', href: 'https://rwn.test/directory#directory-results', hash: '#directory-results' },
    history: { state: { rwnDirectory: { scroll: 0 } } }, performance: { now: () => ++time }, scrollY: 0,
    scrollTo(...args) { calls.push({ method: 'scrollTo', receiver: this, args }); if (outcome.error) throw outcome.error; return outcome.value; },
    addEventListener: (type, listener, options) => { assert.equal(options.passive, true); listeners.window.set(type, listener); },
    requestAnimationFrame: callback => { frames.push(callback); }, fetch: async () => ({ json: async () => ({ records: [] }) }), URL, Request };
  globals.window = globals;
  vm.runInNewContext(`(${observeStartup.toString()})('https://rwn.test')`, globals);
  return { globals, document, input, root, calls, outcome, frames, geometryReads: () => geometryReads, probe: globals.__rwnDirectoryStartupQA,
    emit: (owner, type, detail = {}) => listeners[owner].get(type)({ type, isTrusted: true, target: input, ...detail }),
    drain: () => { let count = 0; while (frames.length) { frames.shift()(); assert.ok(++count < 100); } return count; } };
}

test('startup scroll diagnostics call through once with original receiver, arguments, result and thrown exception', () => {
  const f = observationFixture(), options = { top: 0, behavior: 'instant', preventScroll: true };
  for (const [receiver, method] of [[f.globals, 'scrollTo'], [f.input, 'scrollIntoView'], [f.input, 'focus']]) {
    assert.equal(receiver[method](options), f.outcome.value);
    const call = f.calls.at(-1);
    assert.equal(call.receiver, receiver); assert.equal(call.args[0], options);
    const error = f.outcome.error = new Error('Original failure');
    assert.throws(() => receiver[method](options), thrown => thrown === error);
    f.outcome.error = null;
  }
  assert.equal(f.calls.length, 6);
  assert.equal(f.probe.timeline.filter(entry => entry.type.endsWith(':call')).length, 6);
  assert.equal(f.probe.timeline.filter(entry => entry.type.endsWith(':return')).length, 6);
  let reads = 0;
  f.globals.scrollTo({ get top() { reads++; return 0; } });
  assert.equal(reads, 0, 'observation must not invoke an options getter');
  assert.equal(f.probe.timeline.at(-2).args[0].top, '[accessor]');
  f.document.querySelector = () => { throw new Error('Diagnostic geometry unavailable'); };
  assert.equal(f.input.focus(options), f.outcome.value, 'diagnostic failure cannot block the real focus call');
  assert.ok(f.probe.timelineErrors > 0);
});

test('startup diagnostics witness runtime restore before later native scroll and load without initiating controls', () => {
  const f = observationFixture();
  f.emit('document', 'rwn-directory-ready', { isTrusted: false });
  f.globals.scrollTo({ top: 0, behavior: 'instant' });
  f.globals.scrollY = 121;
  f.emit('window', 'scroll');
  f.document.readyState = 'complete';
  f.document.documentElement.scrollHeight += 44;
  f.emit('window', 'load');
  f.emit('window', 'popstate', { state: null });
  f.emit('window', 'hashchange');
  f.emit('window', 'rwn-directory-restore', { isTrusted: false, detail: 'browse' });
  f.drain();
  const trace = f.probe.timeline, ready = trace.find(entry => entry.type === 'rwn-directory-ready');
  const restored = trace.find(entry => entry.type === 'scrollTo:return'), shifted = trace.find(entry => entry.type === 'scroll');
  assert.equal(ready.startup.browse, true); assert.equal(ready.startup.scroll, 0);
  assert.ok(ready.sequence < restored.sequence && restored.sequence < shifted.sequence);
  assert.equal(restored.scroll, 0); assert.equal(shifted.scroll, 121); assert.equal(shifted.trusted, true);
  const measured = trace.find(entry => entry.type === 'load:checkpoint:raf1');
  assert.equal(measured.inputBox.documentY, 349); assert.equal(measured.inputBox.y, 228);
  assert.equal(measured.documentHeight, 19361);
  assert.equal(trace.find(entry => entry.type === 'popstate').eventStateNull, true);
  assert.equal(trace.find(entry => entry.type === 'rwn-directory-restore').detail, 'browse');
  assert.equal(trace.filter(entry => /^rwn-directory-ready:checkpoint:raf/.test(entry.type)).length, 10);
  assert.equal(f.calls.length, 1, 'the observer must not initiate any focus or scroll call');
  assert.equal(f.probe.timelineErrors, 0);
});

test('startup observation trace is capped and retains ordered recent evidence without writing history or storage', () => {
  const f = observationFixture(), original = JSON.stringify(f.globals.history);
  for (let i = 0; i < 400; i++) { f.globals.scrollY = i; f.emit('window', 'scroll'); }
  assert.equal(f.probe.timeline.length, 256); assert.equal(f.probe.timelineDropped, 145);
  assert.equal(f.probe.timeline.at(-1).scroll, 399);
  assert.ok(f.probe.timeline.every((entry, index, entries) => !index || entry.sequence > entries[index - 1].sequence));
  assert.equal(f.calls.length, 0); assert.equal(f.frames.length, 0);
  assert.equal(JSON.stringify(f.globals.history), original);
  assert.doesNotMatch(observeStartup.toString(), /preventDefault|dispatchEvent|replaceState|pushState|setItem|\.hash\s*=/);
});


test('startup call and event markers never force layout before the original action', () => {
  const f = observationFixture(); let heightReads = 0;
  Object.defineProperty(f.document.documentElement, 'scrollHeight', { get() { heightReads++; return 19317; } });
  for (const [receiver, method] of [[f.globals, 'scrollTo'], [f.input, 'scrollIntoView'], [f.input, 'focus']]) receiver[method]({ preventScroll: true });
  for (const type of ['scroll', 'hashchange', 'popstate', 'load']) f.emit('window', type);
  f.emit('document', 'rwn-directory-ready', { isTrusted: false });
  assert.equal(f.geometryReads(), 0); assert.equal(heightReads, 0);
  assert.ok(f.probe.timeline.every(entry => !('documentHeight' in entry) && !('inputBox' in entry)));
  assert.equal(f.calls.length, 3);
  f.drain();
  assert.ok(f.geometryReads() > 0); assert.ok(heightReads > 0);
  assert.ok(f.probe.timeline.filter(entry => 'inputBox' in entry).every(entry => /:raf\d+$/.test(entry.type)));
  assert.equal(f.calls.length, 3);
});
