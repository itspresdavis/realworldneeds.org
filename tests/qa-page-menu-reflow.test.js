import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import {
  PAGE_MENU_REFLOW_LINKS, PAGE_MENU_REFLOW_VIEWPORTS, PAGE_MENU_BASELINE_RULES,
  pageMenuReflowSnapshot, pageMenuReflowIdentity, pageMenuReflowViolations, pageMenuRingContained,
  pageMenuBaselineStyle, withPageMenuBaseline, verifyPageMenuReflow, waitForPageMenuReflowQuiet, waitForPageMenuFocus
} from '../scripts/qa-page-menu-reflow.mjs';

const expected = () => ({ href: 'http://127.0.0.1:4175/directory', width: 320, height: 250, timeOrigin: 100, title: 'Directory | RWN', heading: 'Free essential services' });
const box = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
const fixture = () => ({
  ready: true, ...expected(), clientWidth: 320, scrollWidth: 320, scrollX: 0, scrollY: 0, overlay: false,
  menuOpen: true, menuDisplay: 'block', summary: { box: box(232, 11, 76, 44), hit: true, focused: false },
  nav: { box: box(12, 62, 296, 160), port: box(13, 63, 294, 158), clientHeight: 158,
    radii: Array.from({ length: 4 }, () => ({ x: 7, y: 7 })), scrollHeight: 380, scrollTop: 0, scrollWidth: 294, clientWidth: 294, overflowY: 'auto', overscrollY: 'contain' },
  links: PAGE_MENU_REFLOW_LINKS.map(([href, text], index) => ({ href, text, box: box(22, 72 + index * 60, 276, 50),
    hit: index < 2, focused: index === 0, focusVisible: index === 0,
    outline: { width: 3, offset: 3, style: 'solid', color: 'rgb(53, 108, 78)' }, ring: box(16, 66 + index * 60, 288, 62) })), inputs: []
});
const issues = state => pageMenuReflowViolations(state, expected(), { focusedIndex: 0 });

test('matrix includes exact short-height widths, landscape, inclusive mobile breakpoint and normal phone', () => {
  for (const width of [320, 390]) for (const height of [422, 250, 189]) {
    assert.ok(PAGE_MENU_REFLOW_VIEWPORTS.some(viewport => viewport[0] === width && viewport[1] === height));
  }
  for (const viewport of [[568, 250], [900, 250], [390, 844]]) assert.ok(PAGE_MENU_REFLOW_VIEWPORTS.some(value => JSON.stringify(value) === JSON.stringify(viewport)));
  assert.equal(PAGE_MENU_REFLOW_VIEWPORTS.length, 9);
  assert.deepEqual(PAGE_MENU_REFLOW_LINKS.map(([href]) => href), ['/', '/directory', '/editorial-policy', '/sources', '/shop', '/join']);
});

test('strict document identity rejects stale contexts, wrong routes, blank/loading/error documents and wrong viewports', () => {
  assert.equal(pageMenuReflowIdentity(fixture(), expected()), true);
  assert.equal(pageMenuReflowIdentity(fixture(), { ...expected(), previousTimeOrigin: 99 }), true);
  assert.equal(pageMenuReflowIdentity(fixture(), { ...expected(), previousTimeOrigin: 100 }), false);
  for (const change of [
    { href: 'http://127.0.0.1:4175/directory#saved' }, { href: 'http://example.org/directory' }, { ready: false },
    { timeOrigin: 101 }, { timeOrigin: NaN }, { timeOrigin: null }, { title: '' }, { title: 'Other' }, { heading: '' }, { heading: 'Other' },
    { overlay: true }, { width: 319 }, { height: 249 }, { clientWidth: undefined }, { scrollWidth: Infinity }, { scrollY: NaN }, { scrollX: NaN }
  ]) assert.equal(pageMenuReflowIdentity({ ...fixture(), ...change }, expected()), false, JSON.stringify(change));
  for (const value of [null, undefined, NaN, Infinity]) {
    assert.equal(pageMenuReflowIdentity(fixture(), { ...expected(), timeOrigin: value }), false);
    assert.equal(pageMenuReflowIdentity(fixture(), { ...expected(), previousTimeOrigin: value }), false);
  }
  assert.equal(pageMenuReflowIdentity(null, expected()), false);
});

test('oracle accepts a fully visible native-focus target and entire outline in a smaller scrollport', () => {
  assert.deepEqual(issues(fixture()), []);
  const shifted = fixture(); shifted.scrollY = 241;
  assert.deepEqual(pageMenuReflowViolations(shifted, expected(), { focusedIndex: 0, scrollY: 241 }), []);
  assert.ok(issues(shifted).includes('page-scroll-leak'));
});

const mutations = [
  ['document-identity', s => { s.timeOrigin++; }],
  ['horizontal-overflow', s => { s.scrollWidth = 322; }],
  ['horizontal-overflow', s => { s.scrollX = 2; }],
  ['page-scroll-leak', s => { s.scrollY = 4; }],
  ['menu-closed', s => { s.menuOpen = false; }],
  ['menu-closed', s => { s.menuDisplay = 'none'; }],
  ['link-order', s => { s.links[2].href = '/directory'; }],
  ['link-order', s => { s.links.reverse(); }],
  ['link-order', s => { s.links.pop(); }],
  ['link-order', s => { s.links[0].text = 'Find'; }],
  ['summary-unreachable', s => { s.summary.box.height = 43; }],
  ['summary-unreachable', s => { s.summary.hit = false; }],
  ['summary-unreachable', s => { s.summary.box.top = -2; }],
  ['panel-outside-viewport', s => { s.nav.box.bottom = 426.671875; }],
  ['panel-outside-viewport', s => { s.nav.box.right = 321; }],
  ['panel-outside-viewport', s => { s.nav.box.top = -1; }],
  ['panel-scrollport', s => { s.nav.overflowY = 'hidden'; }],
  ['panel-scrollport', s => { s.nav.clientHeight = 43; }],
  ['panel-scrollport', s => { s.nav.scrollHeight = NaN; }],
  ['panel-scrollport', s => { s.nav.scrollTop = -1; }],
  ['panel-scrollport', s => { s.nav.scrollWidth += 2; }],
  ['small-target', s => { s.links[4].box.height = 43; }],
  ['small-target', s => { s.links[4].box.height = NaN; }],
  ['small-target', s => { s.links[0].box.width = 43; }],
  ['keyboard-focus', s => { s.links[0].focused = false; }],
  ['keyboard-focus', s => { s.links[0].focusVisible = false; }],
  ['focused-link-clipped', s => { s.links[0].hit = false; }],
  ['focused-link-clipped', s => { s.links[0].box.bottom = 223; }],
  ['focused-link-clipped', s => { s.links[0].box.left = 12; }],
  ['focused-ring-missing', s => { s.links[0].outline.style = 'none'; }],
  ['focused-ring-missing', s => { s.links[0].outline.width = 0; }],
  ['focused-ring-missing', s => { s.links[0].outline.offset = NaN; }],
  ['focused-ring-missing', s => { s.links[0].outline.color = 'rgba(0, 0, 0, 0)'; }],
  ['focused-ring-clipped', s => { s.links[0].ring.top = 62; }],
  ['focused-ring-clipped', s => { s.links[0].ring.bottom = 222; }],
  ['focused-ring-clipped', s => { s.links[0].ring.left = 12; }],
  ['focused-ring-clipped', s => { s.links[0].ring.right = 308; }]
];
for (const [label, mutate] of mutations) test(`mutation rejects ${label}: ${mutate}`, () => {
  const state = fixture(); mutate(state); assert.ok(issues(state).includes(label), JSON.stringify(issues(state)));
});

test('the prior 426.671875px observation is not misrepresented as an actual 422px test', () => {
  const state = fixture(); state.height = 844; state.nav.box.bottom = 430; state.nav.port.bottom = 429;
  state.links.at(-1).box.bottom = 426.671875;
  assert.ok(!pageMenuReflowViolations(state, { ...expected(), height: 844 }).includes('panel-outside-viewport'));
  state.height = 422;
  assert.ok(pageMenuReflowViolations(state, { ...expected(), height: 422 }).includes('panel-outside-viewport'));
  assert.match(verifyPageMenuReflow.toString(), /baseline-320x250/);
});

test('baseline rule fixture fingerprint preserves the exact reviewed main declarations', () => {
  // Source-extraction was verified against the complete frozen baseline file.
  // Retaining this fingerprint prevents later changes from weakening that proof.
  assert.equal(createHash('sha256').update(JSON.stringify(PAGE_MENU_BASELINE_RULES)).digest('hex'),
    '2796d4b77d0e96c3a9a6f55cda0cffe5fa5b0eddd67a171d89392f06ceb61f76');
  assert.equal(PAGE_MENU_BASELINE_RULES.length, 2);
  assert.ok(PAGE_MENU_BASELINE_RULES.every(rule => !/max-height|scroll-padding|overscroll-behavior/.test(rule.declarations)));
});

function styleFixture() {
  const rules = PAGE_MENU_BASELINE_RULES.map((entry, index) => ({ selectorText: entry.selector, style: { cssText: `fixed-rule-${index};max-height:154px;overflow:auto` } }));
  const document = { styleSheets: [{ href: 'http://127.0.0.1:4175/navigation-actions.css?v=abc', cssRules: [rules[0], { conditionText: '(max-width: 900px)', cssRules: [rules[1]] }] }] };
  const context = vm.createContext({ document, URL });
  const run = (mode, fixture = PAGE_MENU_BASELINE_RULES) => vm.runInContext(`(${pageMenuBaselineStyle.toString()})(${JSON.stringify(mode)}, ${JSON.stringify(fixture)})`, context);
  return { rules, document, context, run };
}

test('baseline fixture replaces exact rules, removes added properties, and restores fixed declarations verbatim', () => {
  const { rules, run, context } = styleFixture(), before = rules.map(rule => rule.style.cssText);
  const applied = run('apply');
  assert.equal(applied.length, 2);
  assert.deepEqual(rules.map(rule => rule.style.cssText), PAGE_MENU_BASELINE_RULES.map(rule => rule.declarations));
  assert.throws(() => run('apply'), /Invalid baseline CSS fixture lifecycle/);
  assert.equal(run('restore'), true);
  assert.deepEqual(rules.map(rule => rule.style.cssText), before);
  assert.equal(context.__rwnPageMenuReflowStyles, undefined);
  assert.equal(run('restore'), false);
});

test('baseline mutation rejects missing or ambiguous stylesheets and rules before changing any fixed rule', () => {
  for (const change of [
    f => { f.document.styleSheets = []; },
    f => { f.document.styleSheets.push(f.document.styleSheets[0]); },
    f => { f.document.styleSheets[0].cssRules[1].conditionText = '(max-width: 901px)'; },
    f => { f.document.styleSheets[0].cssRules.push(f.rules[0]); }
  ]) {
    const f = styleFixture(), before = f.rules.map(rule => rule.style.cssText); change(f);
    assert.throws(() => f.run('apply'), /Expected/);
    assert.deepEqual(f.rules.map(rule => rule.style.cssText), before);
    assert.equal(f.context.__rwnPageMenuReflowStyles, undefined);
  }
});

test('fixed CSS is restored after both successful and failing baseline research', async () => {
  for (const fail of [false, true]) {
    const f = styleFixture(), before = f.rules.map(rule => rule.style.cssText), original = new Error('Intentional baseline assertion failure');
    const call = withPageMenuBaseline({ client: {}, evaluate: async (_, code) => vm.runInContext(code, f.context),
      run: async applied => { assert.equal(applied.length, 2); if (fail) throw original; return 'evidence'; } });
    if (fail) await assert.rejects(call, error => error === original);
    else assert.equal(await call, 'evidence');
    assert.deepEqual(f.rules.map(rule => rule.style.cssText), before);
  }
});

test('restoration failure is surfaced without concealing the original baseline failure', async () => {
  const original = new Error('baseline failed'), restore = new Error('restore failed');
  let calls = 0;
  await assert.rejects(withPageMenuBaseline({ client: {}, evaluate: async () => { if (++calls === 2) throw restore; return []; },
    run: async () => { throw original; } }), error => error instanceof AggregateError && error.errors[0] === original && error.errors[1] === restore);
  assert.equal(calls, 2);
});

test('snapshot handles a missing document without converting it to a usable page', () => {
  const result = vm.runInNewContext(`(${pageMenuReflowSnapshot.toString()})()`, {});
  assert.equal(result.ready, false);
  assert.equal(result.timeOrigin, null);
  assert.equal(result.links.length, 0);
  assert.equal(pageMenuReflowIdentity(result, expected()), false);
});

function contributorReflowFixture() {
  const nodes = new Map([
    ['h1', { textContent: 'Contribute to Real World Needs' }],
    ['header.rwn-unified-header a[href="/join"][aria-current="page"]', {}], ['form#accountForm', {}],
    ['#accountForm input[name="email"][type="email"]', {}],
    ['#accountForm input[name="password"][type="password"]', {}],
    ['#accountForm button#accountSubmit[type="submit"]', {}]
  ]);
  const document = { title: 'Contribute | Real World Needs', body: {},
    documentElement: { clientWidth: 320, scrollWidth: 320 }, readyState: 'complete',
    querySelector: selector => nodes.get(selector) || null };
  const globals = { document, location: { href: 'http://127.0.0.1:4175/join', pathname: '/join' },
    performance: { timeOrigin: 101 }, innerWidth: 320, innerHeight: 422, scrollX: 0, scrollY: 0 };
  return { nodes, globals, snapshot: () => vm.runInNewContext(`(${pageMenuReflowSnapshot.toString()})()`, globals) };
}

test('final Contribute destination is ready only with its complete standalone account page', () => {
  const f = contributorReflowFixture(), state = f.snapshot();
  assert.equal(state.ready, true);
  assert.equal(state.menuOpen, false);
  assert.equal(state.nav, undefined);
  assert.equal(state.links.length, 0);
  assert.equal(pageMenuReflowIdentity(state, { href: f.globals.location.href, width: 320, height: 422, previousTimeOrigin: 100 }), true);
  assert.equal(pageMenuReflowIdentity(state, { href: f.globals.location.href, width: 320, height: 422, previousTimeOrigin: 101 }), false);
});

test('Contribute readiness rejects missing account fields, blank shells and incomplete loads', () => {
  for (const selector of contributorReflowFixture().nodes.keys()) {
    const f = contributorReflowFixture(); f.nodes.delete(selector);
    assert.equal(f.snapshot().ready, false, selector);
  }
  for (const mutate of [
    f => { f.globals.document.body = null; }, f => { f.globals.document.documentElement = null; },
    f => { f.globals.document.readyState = 'loading'; }, f => { f.globals.document.readyState = 'interactive'; }
  ]) { const f = contributorReflowFixture(); mutate(f); assert.equal(f.snapshot().ready, false); }
});

test('standalone account markers never substitute for navigation on other routes', () => {
  for (const pathname of ['/directory', '/sources', '/editorial-policy', '/join-other', '/join/', '/']) {
    const f = contributorReflowFixture(); f.globals.location.pathname = pathname;
    f.globals.location.href = `http://127.0.0.1:4175${pathname}`;
    assert.equal(f.snapshot().ready, false, pathname);
  }
});

test('snapshot computes scrollport from client edges and entire outline from actual style', () => {
  const link = { getBoundingClientRect: () => box(20, 70, 280, 50), getAttribute: () => '/', textContent: 'Find help',
    contains: () => false, matches: selector => selector === ':focus-visible' };
  const summary = { getBoundingClientRect: () => box(232, 11, 76, 44), contains: () => false };
  const nav = { getBoundingClientRect: () => box(12, 62, 296, 160), clientLeft: 1, clientTop: 1, clientWidth: 294,
    clientHeight: 158, scrollHeight: 380, scrollTop: 0, scrollWidth: 294, querySelectorAll: () => [link] };
  const menu = { open: true, querySelector: selector => selector === 'nav' ? nav : summary };
  const document = { title: 'Directory | RWN', body: {}, documentElement: { clientWidth: 320, scrollWidth: 320 }, readyState: 'complete', activeElement: link,
    querySelector: selector => selector === '.rwn-page-menu' ? menu : selector === 'h1' ? { textContent: 'Free essential services' } : null,
    elementFromPoint: x => x > 200 ? summary : link };
  const result = vm.runInNewContext(`(${pageMenuReflowSnapshot.toString()})()`, { document,
    location: { href: expected().href }, performance: { timeOrigin: 100 }, innerWidth: 320, innerHeight: 250, scrollX: 0, scrollY: 0,
    getComputedStyle: node => node === link ? { outlineWidth: '3px', outlineOffset: '3px', outlineStyle: 'solid', outlineColor: 'rgb(53, 108, 78)' }
      : node === nav ? { overflowY: 'auto', overscrollBehaviorY: 'contain', borderTopLeftRadius: '8px', borderTopRightRadius: '8px', borderBottomRightRadius: '8px', borderBottomLeftRadius: '8px', borderTopWidth: '1px', borderBottomWidth: '1px', borderLeftWidth: '1px', borderRightWidth: '1px' } : { display: 'block' } });
  assert.equal(result.ready, true);
  assert.deepEqual(JSON.parse(JSON.stringify(result.nav.port)), { left: 13, top: 63, right: 307, bottom: 221 });
  assert.deepEqual(JSON.parse(JSON.stringify(result.links[0].ring)), { left: 14, top: 64, right: 306, bottom: 126 });
  assert.equal(result.links[0].focused, true);
  assert.equal(result.links[0].focusVisible, true);
});

test('orchestration uses native inputs, exact destination identity, failure evidence and leaves PR62 lifecycle untouched', () => {
  const source = verifyPageMenuReflow.toString();
  for (const method of ['Input.dispatchKeyEvent', 'Input.dispatchMouseEvent', 'rawKeyDown', 'mouseWheel']) assert.ok(source.includes(method));
  assert.match(source, /previousTimeOrigin: expected\.timeOrigin/);
  assert.match(source, /href: `\$\{host\}\$\{PAGE_MENU_REFLOW_LINKS.at\(-1\)\[0\]\}`/);
  assert.match(source, /record\.outside = await waitForPageMenuReflowQuiet/);
  assert.match(source, /scrollY: wheelScrollY/);
  assert.match(source, /fixedCSSRestored = true/);
  assert.match(source, /page-menu-reflow\.json/);
  assert.match(source, /\[\['directory',[^\n]*\['service',[^\n]*\['trust',/);
  assert.doesNotMatch(source, /\.focus\(|\.click\(|\.dispatchEvent\(|\.scrollIntoView\(|scrollTop\s*=(?!=)/);
  assert.doesNotMatch(source, /Page\.navigateToHistoryEntry|pageshow|pagehide|setBypassServiceWorker|setCacheDisabled/);
});


test('rounded clip rejects ring corners that pass rectangular containment, including scrollbar-side corners', () => {
  const nav = fixture().nav;
  assert.equal(pageMenuRingContained(fixture().links[0].ring, nav), true);
  for (const ring of [
    { left: 13.4, top: 63.4, right: 300, bottom: 120 },
    { left: 20, top: 63.4, right: 306.6, bottom: 120 },
    { left: 20, top: 160, right: 306.6, bottom: 220.6 },
    { left: 13.4, top: 160, right: 300, bottom: 220.6 }
  ]) assert.equal(pageMenuRingContained(ring, nav), false, JSON.stringify(ring));
  for (const change of [{ radii: undefined }, { radii: [{ x: NaN, y: 7 }, ...nav.radii.slice(1)] }]) {
    assert.equal(pageMenuRingContained(fixture().links[0].ring, { ...nav, ...change }), false);
  }
  assert.equal(pageMenuRingContained(fixture().links[0].ring, { ...nav, radii: nav.radii.map(() => ({ x: 0, y: 0 })) }), true);
  const state = fixture(); state.links[0].ring.left = 13.4; state.links[0].ring.top = 63.4;
  assert.ok(issues(state).includes('focused-ring-clipped'));
});


test('outside native focus waits for stable final scroll instead of accepting an animation frame', async () => {
  let time = 0, index = 0;
  const positions = [0, 30, 80, 120, 180, 241];
  const result = await waitForPageMenuReflowQuiet({
    sample: async () => ({ ...fixture(), scrollY: positions[Math.min(index++, positions.length - 1)] }),
    predicate: state => pageMenuReflowIdentity(state, expected()), now: () => time, wait: async ms => { time += ms; }
  });
  assert.equal(result.scrollY, 241);
  assert.ok(time >= 400, `Smooth scroll became final at200ms and must remain quiet for200ms: ${time}`);
});

test('quiet waiter rejects unchanged wrong documents and continuously moving native scroll', async () => {
  for (const mode of ['wrong-document', 'moving']) {
    let time = 0;
    await assert.rejects(waitForPageMenuReflowQuiet({
      sample: async () => ({ ...fixture(), timeOrigin: mode === 'wrong-document' ? 101 : 100, scrollY: mode === 'moving' ? time : 0 }),
      predicate: state => pageMenuReflowIdentity(state, expected()), now: () => time, wait: async ms => { time += ms; }, timeoutMs: 400
    }), /did not settle/);
    assert.equal(time, 400);
  }
});


async function nativeKeyCalls(value, shift = false, mutate = source => source) {
  const source = verifyPageMenuReflow.toString(), calls = [];
  const helper = mutate(source.slice(source.indexOf('  const key = async'), source.indexOf('  const click = async')));
  const key = vm.runInNewContext(`${helper}; key`, {
    client: { call: async (method, params) => { calls.push({ method, params: JSON.parse(JSON.stringify(params)) }); } },
    frame: async () => { calls.push({ frame: true }); }
  });
  await key(value, shift); return calls;
}

const enterSequence = () => [
  { method: 'Input.dispatchKeyEvent', params: { type: 'keyDown', key: 'Enter', code: 'Enter',
    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 0, text: '\r', unmodifiedText: '\r' } },
  { method: 'Input.dispatchKeyEvent', params: { type: 'keyUp', key: 'Enter', code: 'Enter',
    windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, modifiers: 0 } },
  { frame: true }
];

test('actual Enter helper sends character-bearing keyDown then keyUp before observing close/reopen', async () => {
  assert.deepEqual(await nativeKeyCalls('Enter'), enterSequence());
  assert.deepEqual(await nativeKeyCalls('Enter'), enterSequence(), 'Reopening uses the same complete native activation sequence');
});

test('exact activation contract rejects the original raw-only Enter mutation', async () => {
  const calls = await nativeKeyCalls('Enter', false, source => source.replace(
    "const keyDown = value === 'Enter' ? 'keyDown' : 'rawKeyDown';", "const keyDown = 'rawKeyDown';"));
  assert.equal(calls[0].params.type, 'rawKeyDown');
  assert.equal(calls[0].params.text, undefined);
  assert.equal(calls[0].params.unmodifiedText, undefined);
  assert.throws(() => assert.deepEqual(calls, enterSequence()), assert.AssertionError);
});

for (const shift of [false, true]) test(`native Tab sequence is unchanged (Shift=${shift})`, async () => {
  assert.deepEqual(await nativeKeyCalls('Tab', shift), [
    ...['rawKeyDown', 'keyUp'].map(type => ({ method: 'Input.dispatchKeyEvent', params: { type, key: 'Tab', code: 'Tab',
      windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9, modifiers: shift ? 8 : 0 } })), { frame: true }
  ]);
});


test('actual wheel helper observes bounded quiet state after native dispatch instead of a fixed delay', async () => {
  const source = verifyPageMenuReflow.toString(), calls = [];
  const helper = source.slice(source.indexOf('  const wheel = async'), source.indexOf('  const load = async'));
  const sample = () => {}, predicate = () => {}, result = { settled: true };
  const wheel = vm.runInNewContext(`${helper}; wheel`, {
    client: { call: async (method, params) => { calls.push({ method, params: JSON.parse(JSON.stringify(params)) }); } },
    frame: async () => { calls.push('frame'); }, snapshot: () => {},
    waitForPageMenuReflowQuiet: async options => { assert.equal(options.sample, sample); assert.equal(options.predicate, predicate); calls.push('quiet'); return result; }
  });
  assert.equal(await wheel(box(10, 60, 300, 150), 2000, { sample, predicate }), result);
  assert.deepEqual(calls, [
    { method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', x: 160, y: 135, deltaX: 0, deltaY: 2000 } },
    'frame', 'quiet'
  ]);
  assert.doesNotMatch(helper, /sleep\(/);
});

test('actual fixed-wheel sampler rejects even a transient page-scroll leak before it could return to baseline', async () => {
  const source = verifyPageMenuReflow.toString();
  const helper = source.slice(source.indexOf('      const menuWheel ='), source.indexOf('      if (scrollable)', source.indexOf('      const menuWheel =')));
  let time = 0, sampleCount = 0;
  const initial = fixture(); initial.scrollY = 241;
  const menuWheel = vm.runInNewContext(`${helper}; menuWheel`, {
    expected: expected(), wheelScrollY: 241,
    snapshot: async () => ({ ...initial, scrollY: ++sampleCount === 2 ? 245 : 241 }),
    check: (state, expected, options) => { assert.deepEqual(pageMenuReflowViolations(state, expected, options), []); return state; },
    wheel: async (_box, _delta, options) => waitForPageMenuReflowQuiet({ ...options, now: () => time, wait: async ms => { time += ms; } })
  });
  await assert.rejects(menuWheel(initial, -2000), error => error instanceof assert.AssertionError && /page-scroll-leak/.test(error.message));
  assert.equal(sampleCount, 2, 'A later return to baseline must not hide observed leakage');
});

test('baseline keyboard motion must become quiet before wheel can claim separate page-scroll movement', () => {
  const source = verifyPageMenuReflow.toString();
  const quiet = source.indexOf('const keyboard = await waitForPageMenuReflowQuiet');
  const wheel = source.indexOf('const pointer = await wheel(panel, 800');
  assert.ok(quiet >= 0 && wheel > quiet);
  assert.match(source.slice(quiet, wheel), /pageMenuReflowIdentity\(state, baselineExpected\) && state.links.at\(-1\).focused/);
  assert.match(source.slice(wheel), /state.nav.scrollTop === 0 && state.scrollY > keyboard.scrollY/);
});


function roundedWheelFixture(scrollTop) {
  // Exact scrollport and link geometry from the second CI failure. The browser
  // stops at57px although its integer heights report382-324=58px.
  const state = fixture(); state.height = 422; state.summary.focused = true;
  state.nav = { ...state.nav, box: box(11.203125, 61.6875, 296, 326),
    port: { left: 12.203125, top: 62.6875, right: 306.203125, bottom: 386.6875 },
    clientHeight: 324, scrollHeight: 382, scrollTop };
  state.links = state.links.map((link, index) => {
    // Preserve the recorded first/last geometry when navigation content changes.
    const top = 71.484375 + (index === state.links.length - 1 ? 5 : index) * 62.796875 - scrollTop;
    return { ...link, focused: false, focusVisible: false,
      box: box(21, top, 276.40625, 50), ring: box(15, top - 6, 288.40625, 62),
      hit: top >= state.nav.port.top && top + 50 <= state.nav.port.bottom };
  });
  return state;
}

async function actualWheelBoundary(state, deltaY = 2000, mutate = source => source) {
  const source = verifyPageMenuReflow.toString();
  const helper = mutate(source.slice(source.indexOf('      const menuWheel ='), source.indexOf('      if (scrollable)', source.indexOf('      const menuWheel ='))));
  const menuWheel = vm.runInNewContext(`${helper}; menuWheel`, {
    expected: { ...expected(), height: 422 }, wheelScrollY: 0, snapshot: async () => state,
    check: (value, expected, options) => { assert.deepEqual(pageMenuReflowViolations(value, expected, options), []); return value; },
    wheel: async (_box, _delta, options) => options.predicate(await options.sample())
  });
  return menuWheel(state, deltaY);
}

test('actual bottom predicate accepts the observed1px integer rounding discrepancy and valid fractional positions', async () => {
  for (const scrollTop of [57, 57.25, 57.5, 58, 58.75, 59]) assert.equal(await actualWheelBoundary(roundedWheelFixture(scrollTop)), true, String(scrollTop));
  for (const scrollTop of [0, 56, 56.99, 59.01, 60]) assert.equal(await actualWheelBoundary(roundedWheelFixture(scrollTop)), false, String(scrollTop));
});

test('old half-pixel bottom predicate mutation rejects the recorded reachable boundary', async () => {
  const state = roundedWheelFixture(57);
  assert.equal(await actualWheelBoundary(state), true);
  assert.equal(await actualWheelBoundary(state, 2000, source => source.replace('clientHeight)) <= 1', 'clientHeight)) <= .5')), false);
  assert.equal(state.links.at(-1).hit, true);
  assert.equal(state.links.at(-1).box.bottom, 378.46875);
  assert.ok(state.links.at(-1).box.bottom < state.nav.port.bottom);
});

test('rounding allowance cannot admit invalid metrics, page leakage or a nonzero top boundary', async () => {
  for (const scrollTop of [-1, NaN, Infinity]) await assert.rejects(actualWheelBoundary(roundedWheelFixture(scrollTop)), assert.AssertionError);
  for (const property of ['clientHeight', 'scrollHeight']) {
    const state = roundedWheelFixture(57); state.nav[property] = NaN;
    await assert.rejects(actualWheelBoundary(state), assert.AssertionError);
  }
  const leaked = roundedWheelFixture(57); leaked.scrollY = 1;
  await assert.rejects(actualWheelBoundary(leaked), error => /page-scroll-leak/.test(error.message));
  assert.equal(await actualWheelBoundary(roundedWheelFixture(0), -2000), true);
  assert.equal(await actualWheelBoundary(roundedWheelFixture(.25), -2000), false);
});

test('metric rounding never replaces focused target, ring or second-wheel no-motion proof', async () => {
  const state = roundedWheelFixture(57), expectedPage = { ...expected(), height: 422 };
  state.summary.focused = false; state.links.at(-1).focused = true; state.links.at(-1).focusVisible = true;
  assert.deepEqual(pageMenuReflowViolations(state, expectedPage, { focusedIndex: PAGE_MENU_REFLOW_LINKS.length - 1 }), []);
  for (const mutate of [s => { s.links.at(-1).box.bottom = 388; }, s => { s.links.at(-1).ring.bottom = 388; }, s => { s.links.at(-1).hit = false; }]) {
    const broken = structuredClone(state); mutate(broken);
    assert.equal(await actualWheelBoundary(broken), true, 'The independent numeric boundary is still satisfied');
    assert.ok(pageMenuReflowViolations(broken, expectedPage, { focusedIndex: PAGE_MENU_REFLOW_LINKS.length - 1 }).some(issue => /clipped/.test(issue)));
  }
  assert.match(verifyPageMenuReflow.toString(), /record.boundary.nav.scrollTop === record.pointer.nav.scrollTop/);
});


test('native link-focus phase permits recorded ancestor reveal only after exact focus and geometry settle', async () => {
  let time = 0, index = 0;
  const positions = [30, 27, 24, 22, 22];
  const result = await waitForPageMenuFocus({ sample: async () => ({ ...fixture(), scrollY: positions[Math.min(index++, positions.length - 1)] }),
    expected: expected(), target: 0, now: () => time, wait: async ms => { time += ms; } });
  assert.equal(result.scrollY, 22);
  assert.ok(time >= 320, 'Final keyboard position must remain quiet for200ms');
  assert.equal(result.links[0].focused, true);
  assert.deepEqual(pageMenuReflowViolations(result, expected(), { focusedIndex: 0, scrollY: 22 }), []);
  assert.ok(pageMenuReflowViolations(result, expected(), { focusedIndex: 0, scrollY: 30 }).includes('page-scroll-leak'),
    'The same movement still fails the separate fixed-position/wheel oracle');
});

test('native focus phase cannot excuse wrong documents, lost focus, clipped targets or rings, or nonstop movement', async () => {
  for (const mutate of [
    s => { s.timeOrigin++; }, s => { s.href += '#other'; }, s => { s.links[0].focused = false; },
    s => { s.links[0].box.bottom = 224; }, s => { s.links[0].ring.top = 62; },
    s => { s.links[0].outline.style = 'none'; }, s => { s.links[0].box.height = 43; }
  ]) {
    let time = 0; const state = fixture(); state.scrollY = 24; mutate(state);
    await assert.rejects(waitForPageMenuFocus({ sample: async () => state, expected: expected(), target: 0,
      now: () => time, wait: async ms => { time += ms; }, timeoutMs: 400 }), /did not settle/);
  }
  let time = 0;
  await assert.rejects(waitForPageMenuFocus({ sample: async () => ({ ...fixture(), scrollY: time }), expected: expected(), target: 0,
    now: () => time, wait: async ms => { time += ms; }, timeoutMs: 400 }), /did not settle/);
});

test('summary arrival has its own quiet focus gate and invalid keyboard targets cannot bypass it', async () => {
  let time = 0;
  const state = fixture(); state.links[0].focused = false; state.summary.focused = true; state.scrollY = 16;
  const result = await waitForPageMenuFocus({ sample: async () => state, expected: expected(), target: 'summary',
    now: () => time, wait: async ms => { time += ms; } });
  assert.equal(result.summary.focused, true); assert.equal(result.scrollY, 16); assert.ok(time >= 200);
  for (const target of [undefined, null, -1, 6, .5, 'wheel']) await assert.rejects(
    waitForPageMenuFocus({ sample: async () => state, expected: expected(), target }), /Invalid expected/);
  state.summary.focused = false; time = 0;
  await assert.rejects(waitForPageMenuFocus({ sample: async () => state, expected: expected(), target: 'summary',
    now: () => time, wait: async ms => { time += ms; }, timeoutMs: 400 }), /did not settle/);
});

test('one settled summary baseline owns Enter and every wheel; outside or wheel results cannot replace it', () => {
  const source = verifyPageMenuReflow.toString();
  assert.match(source, /record.forward.push\(await waitForPageMenuFocus/);
  assert.match(source, /record.backward.push\(await waitForPageMenuFocus/);
  assert.match(source, /record.summaryArrival = await waitForPageMenuFocus/);
  assert.match(source, /const wheelScrollY = record.summaryArrival.scrollY/);
  assert.match(source, /Math.abs\(state.scrollY - wheelScrollY\) <= .5/);
  assert.match(source, /sample: async \(\) => check\(await snapshot\(\), expected, \{ scrollY: wheelScrollY \}\)/);
  assert.equal((source.match(/const wheelScrollY =/g) || []).length, 1);
  assert.doesNotMatch(source, /wheelScrollY = (?:record.outside|record.pointer|record.boundary|state)/);
  assert.match(source, /record.focusScroll =/);
  assert.doesNotMatch(source, /Page.navigateToHistoryEntry|pageshow|pagehide/);
});


test('recorded320x250 reverse-focus reveal passes geometry while retaining a separate strict wheel baseline', async () => {
  const state = roundedWheelFixture(188); state.height = 250; state.scrollY = 24; state.summary.focused = false;
  state.nav.box = box(11.203125, 61.6875, 296, 154); state.nav.port.bottom = 214.6875; state.nav.clientHeight = 152;
  for (const link of state.links) link.hit = link.box.top >= state.nav.port.top && link.box.bottom <= state.nav.port.bottom;
  state.links[3].focused = true; state.links[3].focusVisible = true;
  assert.equal(state.links[3].box.top, 71.875);
  assert.equal(state.links[3].ring.top, 65.875);
  assert.deepEqual(pageMenuReflowViolations(state, expected(), { focusedIndex: 3, scrollY: 30 }), ['page-scroll-leak']);
  let time = 0;
  const result = await waitForPageMenuFocus({ sample: async () => state, expected: expected(), target: 3,
    now: () => time, wait: async ms => { time += ms; } });
  assert.equal(result.scrollY, 24); assert.ok(time >= 200);
});
