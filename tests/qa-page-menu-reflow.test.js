import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import {
  PAGE_MENU_REFLOW_LINKS, PAGE_MENU_REFLOW_VIEWPORTS, PAGE_MENU_BASELINE_RULES,
  pageMenuReflowSnapshot, pageMenuReflowIdentity, pageMenuReflowViolations, pageMenuRingContained,
  pageMenuBaselineStyle, withPageMenuBaseline, verifyPageMenuReflow, waitForPageMenuReflowQuiet
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
  assert.deepEqual(PAGE_MENU_REFLOW_LINKS.map(([href]) => href), ['/', '/directory', '/directory#saved', '/editorial-policy', '/sources', '/transparency']);
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
  state.links[5].box.bottom = 426.671875;
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
  assert.match(source, /href: `\$\{host\}\/transparency`/);
  assert.match(source, /record\.outside = await waitForPageMenuReflowQuiet/);
  assert.match(source, /scrollY: reverseScrollY/);
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
