import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { PAGE_MENU_REFLOW_LINKS } from '../scripts/qa-page-menu-reflow.mjs';
import {
  PAGE_MENU_DISMISSAL_VIEWPORTS, observePageMenuDismissal, pageMenuDismissalSnapshot,
  pageMenuDismissalViolations, waitForPageMenuDismissal, verifyPageMenuDismissal
} from '../scripts/qa-page-menu-dismissal.mjs';

const expected = () => ({ href: 'http://127.0.0.1:4175/directory', width: 320, height: 250, timeOrigin: 100, title: 'Directory | RWN', heading: 'Free essential services' });
const fixture = () => ({ ...expected(), ready: true, overlay: false, native: true, clientWidth: 320, scrollWidth: 320,
  scrollX: 0, scrollY: 24, menuOpen: false, menuDisplay: 'block', nav: { scrollTop: 0 },
  summary: { focused: true, hit: true }, focus: { key: 1, tag: 'SUMMARY', visible: true, inMenu: true, inHeader: true, query: false, body: false },
  links: PAGE_MENU_REFLOW_LINKS.map(([href, text]) => ({ href, text, focused: false, hit: false })), query: '', events: [] });
const options = () => ({ open: false, focus: 'summary', scrollY: 24 });
const issues = state => pageMenuDismissalViolations(state, expected(), options());

function sampler(transform = () => ({})) {
  let time = 0, calls = 0;
  return { sample: async () => ({ ...fixture(), ...transform(time, calls++) }), now: () => time, wait: async ms => { time += ms; }, calls: () => calls };
}

test('closed summary oracle rejects wrong documents, hidden focus, overflow and lost native semantics', () => {
  assert.deepEqual(issues(fixture()), []);
  for (const change of [{ ready: false }, { href: `${expected().href}#saved` }, { timeOrigin: 101 }, { timeOrigin: NaN },
    { width: 390 }, { title: 'Wrong title' }, { heading: '' }, { overlay: true }, { native: false }, { menuOpen: true },
    { scrollWidth: 322 }, { scrollX: 1 }, { scrollY: 25 }, { summary: { focused: false, hit: true } },
    { summary: { focused: true, hit: false } }, { focus: { ...fixture().focus, visible: false } }, { links: [] }]) {
    assert.ok(issues({ ...fixture(), ...change }).length, JSON.stringify(change));
  }
  assert.deepEqual(issues(null), ['document-identity']);
});

test('exact focus identity detects stealing even between otherwise identical visible header controls', () => {
  const state = fixture(); state.focus = { key: 3, tag: 'A', visible: true, inMenu: false, inHeader: true };
  assert.deepEqual(pageMenuDismissalViolations(state, expected(), { open: false, focus: 'header', focusKey: 3 }), []);
  for (const change of [{ key: 4 }, { key: null }, { inMenu: true }, { inHeader: false }, { visible: false }, { tag: 'BODY' }]) {
    assert.ok(pageMenuDismissalViolations({ ...state, focus: { ...state.focus, ...change } }, expected(), { focus: 'header', focusKey: 3 }).length);
  }
  assert.ok(pageMenuDismissalViolations(state, expected(), { focusKey: NaN }).includes('focus-stolen'));
});

test('retained menu-link and query ownership cannot be satisfied by summary focus', () => {
  const state = fixture(); state.menuOpen = true; state.summary.focused = false; state.links[5].focused = true; state.links[5].hit = true;
  assert.deepEqual(pageMenuDismissalViolations(state, expected(), { open: true, focus: 5 }), []);
  state.links[5].hit = false;
  assert.ok(pageMenuDismissalViolations(state, expected(), { open: true, focus: 5 }).includes('link-focus'));
  assert.ok(pageMenuDismissalViolations(state, expected(), { focus: 'query' }).includes('query-focus'));
  state.focus.query = true;
  assert.deepEqual(pageMenuDismissalViolations(state, expected(), { focus: 'query' }), []);
});

test('reload identity requires a different time origin with exact route and page identity', () => {
  const { timeOrigin, ...rest } = expected(), wanted = { ...rest, previousTimeOrigin: timeOrigin };
  assert.ok(pageMenuDismissalViolations(fixture(), wanted).includes('document-identity'));
  assert.deepEqual(pageMenuDismissalViolations({ ...fixture(), timeOrigin: 101 }, wanted), []);
  assert.ok(pageMenuDismissalViolations({ ...fixture(), timeOrigin: 101, href: `${rest.href}#saved` }, wanted).includes('document-identity'));
});

test('quiet gate adopts genuine keyboard scroll only before a dismissal baseline is frozen', async () => {
  const moving = sampler((time) => ({ scrollY: time < 160 ? time : 24 }));
  const reached = await waitForPageMenuDismissal({ ...moving, expected: expected(), options: { open: false, focus: 'summary' } });
  assert.equal(reached.scrollY, 24); assert.ok(moving.now() >= 360);
  const still = sampler();
  assert.equal((await waitForPageMenuDismissal({ ...still, expected: expected(), options: options() })).focus.key, 1);
  assert.ok(still.now() >= 200); assert.ok(still.calls() >= 3);
});

test('dismissal rejects a transient scroll leak even if a later sample could return to baseline', async () => {
  const f = sampler((_time, index) => ({ scrollY: index === 1 ? 25 : 24 }));
  await assert.rejects(waitForPageMenuDismissal({ ...f, expected: expected(), options: options() }), /Dismissal moved the page/);
  assert.equal(f.calls(), 2);
});

test('quiet gate bounds wrong documents, focus loss, moving state and a hung sample', async () => {
  for (const transform of [() => ({ timeOrigin: 101 }), () => ({ menuOpen: true }),
    () => ({ focus: { ...fixture().focus, visible: false } }), time => ({ nav: { scrollTop: time } })]) {
    const f = sampler(transform);
    await assert.rejects(waitForPageMenuDismissal({ ...f, expected: expected(), options: options(), timeoutMs: 400 }), /did not settle/);
    assert.equal(f.now(), 400);
  }
  await assert.rejects(waitForPageMenuDismissal({ sample: () => new Promise(() => {}), expected: expected(), timeoutMs: 20 }), /timed out/);
  const f = sampler(); let first = true;
  assert.ok(await waitForPageMenuDismissal({ ...f, sample: async () => {
    if (first) { first = false; throw new Error('Runtime.evaluate: Execution context was destroyed'); }
    return f.sample();
  }, expected: expected(), options: options() }));
  await assert.rejects(waitForPageMenuDismissal({ sample: async () => { throw new Error('Broken selector'); }, expected: expected() }), /Broken selector/);
});

test('observer guards only one native Escape or outside mousedown and records final default prevention', () => {
  const handlers = {}, pending = [], menuTarget = {};
  const context = { window: { addEventListener: (type, fn) => { handlers[type] = fn; } },
    document: { querySelector: () => ({ contains: node => node === menuTarget }) }, setTimeout: fn => pending.push(fn) };
  vm.runInNewContext(`(${observePageMenuDismissal.toString()})()`, context);
  const probe = context.__rwnMenuDismissal;
  const event = (key, target = menuTarget) => ({ key, target, isTrusted: true, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });
  probe.preventEscape = true;
  const tab = event('Tab'); handlers.keydown(tab); assert.equal(tab.defaultPrevented, false); assert.equal(probe.preventEscape, true);
  const escape = event('Escape'); handlers.keydown(escape); assert.equal(escape.defaultPrevented, true); assert.equal(probe.preventEscape, false);
  const repeat = event('Escape'); handlers.keydown(repeat); assert.equal(repeat.defaultPrevented, false);
  repeat.preventDefault(); pending.splice(0).forEach(fn => fn()); assert.equal(probe.events.at(-1).prevented, true);
  probe.retainPointer = true;
  const inside = event(''); handlers.mousedown(inside); assert.equal(inside.defaultPrevented, false); assert.equal(probe.retainPointer, true);
  const outside = event('', {}); handlers.mousedown(outside); assert.equal(outside.defaultPrevented, true); assert.equal(probe.retainPointer, false);
  const click = event('', {}); handlers.click(click); assert.equal(click.defaultPrevented, false);
  assert.ok(probe.events.every(e => e.trusted));
});

test('snapshot handles detached document and preserves supplied base identity', () => {
  const value = vm.runInNewContext(`(${pageMenuDismissalSnapshot.toString()})({ href: 'before', ready: false })`, {});
  assert.equal(value.href, 'before'); assert.equal(value.native, false); assert.equal(value.focus.key, null);
  assert.equal(value.focus.visible, false); assert.equal(value.focus.body, false); assert.equal(value.outsidePoint, null);
});

test('snapshot assigns stable exact-node IDs and finds a genuinely inert outside point', () => {
  const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const node = (tagName, box) => ({ tagName, getBoundingClientRect: () => box, contains: other => false,
    matches: () => false, closest: () => null });
  const summary = node('SUMMARY', rect(234, 11, 72, 44)), brand = node('A', rect(14, 11, 120, 44));
  const header = node('HEADER', rect(0, 0, 320, 66)); header.contains = target => [header, brand, summary].includes(target);
  const menu = { tagName: 'DETAILS', contains: target => target === summary, querySelector: () => summary, closest: () => header };
  const document = { activeElement: summary, body: {}, querySelector: selector => selector === '.rwn-page-menu' ? menu : null,
    elementFromPoint: x => x < 14 ? header : x < 150 ? brand : summary };
  const globals = { document, innerWidth: 320, innerHeight: 250, getComputedStyle: () => ({ display: 'block', visibility: 'visible' }),
    __rwnMenuDismissal: { ids: new WeakMap(), sequence: 0, events: [] } };
  const snapshot = () => vm.runInNewContext(`(${pageMenuDismissalSnapshot.toString()})({ ready: true })`, globals);
  const initial = snapshot(); assert.equal(initial.native, true); assert.equal(initial.focus.visible, true);
  assert.equal(initial.focus.inMenu, true); assert.equal(initial.focus.inHeader, true);
  assert.deepEqual(JSON.parse(JSON.stringify(initial.outsidePoint)), { x: 2, y: 33 });
  assert.equal(snapshot().focus.key, initial.focus.key);
  document.activeElement = brand; const outside = snapshot();
  assert.notEqual(outside.focus.key, initial.focus.key); assert.equal(outside.focus.inMenu, false); assert.equal(outside.focus.visible, true);
  document.activeElement = summary; assert.equal(snapshot().focus.key, initial.focus.key);
});

async function keyCalls(value, shift = false) {
  const source = verifyPageMenuDismissal.toString(), calls = [];
  const helper = source.slice(source.indexOf('  const key = async'), source.indexOf('  const click = async'));
  const key = vm.runInNewContext(`${helper}; key`, { call: async (method, params) => calls.push({ method, params: JSON.parse(JSON.stringify(params)) }),
    frame: async () => calls.push('frame'), assert: assert.ok });
  await key(value, shift); return calls;
}
for (const [value, code, shift] of [['Escape', 27, false], ['Enter', 13, false], ['Tab', 9, true], ['/', 191, false]]) {
  test(`native ${value} input sends the correct key pair and observes after it`, async () => {
    const calls = await keyCalls(value, shift);
    assert.deepEqual(calls, [
      ...[value === 'Enter' ? 'keyDown' : 'rawKeyDown', 'keyUp'].map(type => ({ method: 'Input.dispatchKeyEvent', params: {
        type, key: value, code: value === '/' ? 'Slash' : value, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: shift ? 8 : 0,
        ...(type === 'keyDown' ? { text: '\r', unmodifiedText: '\r' } : {}) } })), 'frame'
    ]);
  });
}

test('ordinary dismissal helper verifies its own new consumed Escape, never an earlier injected guard', async () => {
  const source = verifyPageMenuDismissal.toString();
  const helper = source.slice(source.indexOf('  const escape = async'), source.indexOf('  const outside = async'));
  const earlier = { type: 'keydown', key: 'Escape', trusted: true, outside: false, prevented: true };
  const ordinary = { ...earlier }, from = { ...fixture(), events: [earlier] };
  const run = async events => {
    const escape = vm.runInNewContext(`${helper}; escape`, { key: async key => assert.equal(key, 'Escape'),
      settle: async (_expected, options) => {
        assert.equal(options.open, false); assert.equal(options.focus, 'summary'); assert.equal(options.scrollY, 24);
        return { ...fixture(), events };
      }, assert: (ok, label) => assert.ok(ok, label) });
    return escape(expected(), from);
  };
  assert.ok(await run([earlier, ordinary]));
  for (const change of [{ prevented: false }, { trusted: false }, { outside: true }, { key: 'Enter' }, { type: 'click' }]) {
    await assert.rejects(run([earlier, { ...ordinary, ...change }]), /Ordinary owned Escape was not consumed/);
  }
  await assert.rejects(run([earlier]), /Ordinary owned Escape was not consumed/);
  await assert.rejects(run([earlier, ordinary, ordinary]), /Ordinary owned Escape was not consumed/);
});

test('CI matrix preserves real native inputs, existing history suites and same-document identity', async () => {
  assert.deepEqual(PAGE_MENU_DISMISSAL_VIEWPORTS, [[320, 780], [390, 844], [320, 250], [390, 250], [900, 250]]);
  const source = verifyPageMenuDismissal.toString();
  assert.match(source, /\[\['directory',[^\n]*\['service',[^\n]*\['trust',/);
  for (const requirement of ['Input.dispatchMouseEvent', 'Input.dispatchKeyEvent', 'Input.insertText', 'Page.reload',
    'preventedEscape', 'outsideEscape', 'outsideKept', 'outsideRepaired', 'queryEscape', 'reloadRepeat', 'inclusive900', 'desktop901',
    'closedSummary901', 'closedResizeRepeat', 'page-menu-dismissal.json', 'Runtime.exceptionThrown']) assert.ok(source.includes(requirement), requirement);
  assert.match(source, /const \{ timeOrigin, \.\.\.reloadExpected \} = expected/);
  assert.match(source, /previousTimeOrigin: timeOrigin/);
  assert.doesNotMatch(source, /timeOrigin: undefined|\.focus\(|\.click\(|\.dispatchEvent\(|\.scrollIntoView\(|\.open\s*=|scrollTop\s*=(?!=)|pageshow|pagehide|Page\.navigateToHistoryEntry|setBypassServiceWorker|setCacheDisabled/);
  const runner = await readFile(new URL('../scripts/browser-service-qa.mjs', import.meta.url), 'utf8');
  assert.match(runner, /import \{ verifyPageMenuDismissal \} from "\.\/qa-page-menu-dismissal.mjs"/);
  assert.match(runner, /await verifyPageMenuReturn\(/); assert.match(runner, /await verifyPageMenuReflow\(/);
  assert.equal((runner.match(/await verifyPageMenuDismissal\(/g) || []).length, 1);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.scripts.check.includes('node --check scripts/qa-page-menu-dismissal.mjs'));
});
