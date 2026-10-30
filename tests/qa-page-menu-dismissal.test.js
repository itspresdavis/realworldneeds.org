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
  const state = fixture(); state.menuOpen = true; state.summary.focused = false; state.links.at(-1).focused = true; state.links.at(-1).hit = true;
  assert.deepEqual(pageMenuDismissalViolations(state, expected(), { open: true, focus: PAGE_MENU_REFLOW_LINKS.length - 1 }), []);
  state.links.at(-1).hit = false;
  assert.ok(pageMenuDismissalViolations(state, expected(), { open: true, focus: PAGE_MENU_REFLOW_LINKS.length - 1 }).includes('link-focus'));
  assert.ok(pageMenuDismissalViolations(state, expected(), { focus: 'query' }).includes('query-focus'));
  state.focus.query = true;
  assert.deepEqual(pageMenuDismissalViolations(state, expected(), { focus: 'query' }), []);
});

test('actual final-link traversal targets the last menu index after exactly one Tab per link', async () => {
  const source = verifyPageMenuDismissal.toString();
  const start = source.indexOf('      await open(expected);\n      for (let index');
  const end = source.indexOf('      if (height === 250)', start);
  assert.ok(start >= 0 && end > start);
  const traversal = source.slice(start, end);
  const run = async code => {
    const state = fixture(), record = {}; let tabs = 0;
    const execute = vm.runInNewContext(`(async () => { ${code}; return record.lastLink; })`, {
      PAGE_MENU_REFLOW_LINKS, expected: expected(), record,
      open: async () => { state.menuOpen = true; state.summary.focused = true; },
      key: async key => {
        assert.equal(key, 'Tab'); state.summary.focused = false;
        for (const link of state.links) { link.focused = false; link.hit = false; }
        const link = state.links[tabs++]; assert.ok(link, 'Traversal must not leave the menu');
        link.focused = true; link.hit = true;
      },
      settle: async (wanted, options) => {
        assert.equal(tabs, PAGE_MENU_REFLOW_LINKS.length);
        assert.equal(state.links.at(-1).href, '/join');
        assert.deepEqual(pageMenuDismissalViolations(state, wanted, options), [], 'The native final link must satisfy the exact focus oracle');
        return state;
      }
    });
    return execute();
  };
  assert.equal((await run(traversal)).links.at(-1).focused, true);
  await assert.rejects(run(traversal.replace('focus: PAGE_MENU_REFLOW_LINKS.length - 1', 'focus: PAGE_MENU_REFLOW_LINKS.length')), /exact focus oracle/);
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

function breakpointObserverFixture() {
  const handlers = {}, pending = [], registrations = [];
  const node = (tagName, href = '') => Object.freeze({ tagName, nodeType: 1, id: '', getAttribute: () => href,
    focus: () => { throw new Error('Observer must not move focus'); } });
  const summary = node('SUMMARY'), link = node('A', '/sources'), brand = node('A', '/'), body = node('BODY');
  const state = { active: summary, open: true, display: 'block', focused: true, time: 0, dispatching: false, styleReads: 0 };
  const menu = Object.freeze({ contains: target => target === summary || target === link, get open() { return state.open; } });
  const context = { innerWidth: 900, innerHeight: 250, performance: { now: () => ++state.time },
    window: { addEventListener: (type, fn, capture) => { handlers[type] = fn; registrations.push({ type, capture }); } },
    document: { querySelector: () => menu, get activeElement() { return state.active; }, hasFocus: () => state.focused },
    getComputedStyle: target => {
      assert.equal(state.dispatching, false, 'A capture-phase style read would perturb native blur/resize ordering');
      assert.equal(target, menu); state.styleReads++; return { display: state.display, visibility: 'visible' };
    },
    setTimeout: fn => pending.push(fn) };
  vm.runInNewContext(`(${observePageMenuDismissal.toString()})()`, context);
  const dispatch = (type, target, relatedTarget = null) => {
    state.dispatching = true;
    try { handlers[type]({ target, relatedTarget, isTrusted: true,
      preventDefault: () => { throw new Error('Read-only trace must not prevent events'); },
      stopPropagation: () => { throw new Error('Read-only trace must not intercept events'); } }); }
    finally { state.dispatching = false; }
  };
  return { context, state, summary, link, brand, body, probe: context.__rwnMenuDismissal, registrations, dispatch,
    flush: () => pending.splice(0).forEach(fn => fn()), pending };
}

test('breakpoint trace observes capture and post-dispatch focus/resize order without mixing input evidence', () => {
  const f = breakpointObserverFixture(), { probe, state, context } = f;
  f.dispatch('focusout', f.summary); assert.equal(probe.breakpointTrace.length, 0); assert.equal(f.pending.length, 0);
  probe.breakpoint = 'open-link-1'; context.innerWidth = 901; state.active = f.body; state.display = 'none';
  f.dispatch('focusout', f.link);
  f.dispatch('resize', context.window);
  state.active = f.brand; state.open = false;
  f.dispatch('focusin', f.brand, f.link);
  const capture = probe.breakpointTrace;
  assert.deepEqual(Array.from(capture, event => [event.order, event.event, event.type, event.phase]),
    [[1, 1, 'focusout', 'capture'], [2, 2, 'resize', 'capture'], [3, 3, 'focusin', 'capture']]);
  assert.equal(capture[0].target.tag, 'A'); assert.equal(capture[0].target.href, '/sources'); assert.equal(capture[0].target.inMenu, true);
  assert.equal(capture[0].relatedTarget, null); assert.equal(capture[0].active.tag, 'BODY'); assert.equal(capture[0].viewport.width, 901);
  assert.equal(capture[0].menu.display, undefined); assert.equal(capture[0].menu.visibility, undefined);
  assert.equal(state.styleReads, 0); assert.equal(capture[0].menu.open, true); assert.equal(capture[0].documentFocused, true);
  assert.equal(capture[1].target.tag, 'WINDOW'); assert.equal(capture[1].target.inMenu, false);
  assert.equal(capture[2].relatedTarget.key, capture[0].target.key); assert.equal(capture[2].active.href, '/');
  probe.breakpoint = null; state.focused = false; f.flush();
  assert.deepEqual(Array.from(probe.breakpointTrace.slice(3), event => [event.order, event.event, event.type, event.phase]),
    [[4, 1, 'focusout', 'after-dispatch'], [5, 2, 'resize', 'after-dispatch'], [6, 3, 'focusin', 'after-dispatch']]);
  for (const event of probe.breakpointTrace.slice(3)) {
    assert.equal(event.label, 'open-link-1'); assert.equal(event.active.key, capture[2].active.key);
    assert.equal(event.documentFocused, false); assert.equal(event.menu.open, false); assert.equal(event.trusted, true);
    assert.equal(event.menu.display, 'none'); assert.equal(event.menu.visibility, 'visible');
  }
  assert.equal(probe.events.length, 0); assert.equal(probe.traceDropped, 0); assert.equal(state.styleReads, 3);
  assert.ok(f.registrations.every(entry => entry.capture === true));
  assert.equal(state.active, f.brand, 'Observation did not move the active element');
});

test('breakpoint trace retains only the latest 200 observations and counts discarded entries', () => {
  const f = breakpointObserverFixture(); f.probe.breakpoint = 'closed-summary-3';
  for (let index = 0; index < 105; index++) { f.dispatch('resize', f.context.window); f.flush(); }
  assert.equal(f.probe.breakpointTrace.length, 200); assert.equal(f.probe.traceDropped, 10);
  assert.equal(f.probe.breakpointTrace[0].order, 11); assert.equal(f.probe.breakpointTrace.at(-1).order, 210);
  assert.equal(f.probe.traceEvents, 105); assert.equal(f.probe.events.length, 0);
  f.probe.breakpoint = null; f.dispatch('focusin', f.brand, f.summary);
  assert.equal(f.probe.breakpointTrace.at(-1).order, 210); assert.equal(f.pending.length, 0);
});

test('snapshot handles detached document and preserves supplied base identity', () => {
  const value = vm.runInNewContext(`(${pageMenuDismissalSnapshot.toString()})({ href: 'before', ready: false })`, {});
  assert.equal(value.href, 'before'); assert.equal(value.native, false); assert.equal(value.focus.key, null);
  assert.equal(value.focus.visible, false); assert.equal(value.focus.body, false); assert.equal(value.outsidePoint, null);
  assert.equal(value.breakpointTrace.length, 0); assert.equal(value.breakpointTraceDropped, 0);
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
    __rwnMenuDismissal: { ids: new WeakMap(), sequence: 0, events: [], breakpointTrace: [{ order: 11 }], traceDropped: 10 } };
  const snapshot = () => vm.runInNewContext(`(${pageMenuDismissalSnapshot.toString()})({ ready: true })`, globals);
  const initial = snapshot(); assert.equal(initial.native, true); assert.equal(initial.focus.visible, true);
  assert.equal(initial.breakpointTrace[0].order, 11); assert.equal(initial.breakpointTraceDropped, 10);
  assert.equal(initial.focus.inMenu, true); assert.equal(initial.focus.inHeader, true);
  assert.deepEqual(JSON.parse(JSON.stringify(initial.outsidePoint)), { x: 2, y: 33 });
  assert.equal(snapshot().focus.key, initial.focus.key);
  document.activeElement = brand; const outside = snapshot();
  assert.notEqual(outside.focus.key, initial.focus.key); assert.equal(outside.focus.inMenu, false); assert.equal(outside.focus.visible, true);
  document.activeElement = summary; assert.equal(snapshot().focus.key, initial.focus.key);
});

async function keyCalls(value, shift = false, alt = false) {
  const source = verifyPageMenuDismissal.toString(), calls = [];
  const helper = source.slice(source.indexOf('  const key = async'), source.indexOf('  const click = async'));
  const key = vm.runInNewContext(`${helper}; key`, { call: async (method, params) => calls.push({ method, params: JSON.parse(JSON.stringify(params)) }),
    frame: async () => calls.push('frame'), assert: assert.ok });
  await key(value, shift, alt); return calls;
}
for (const [value, code, shift, alt] of [['Escape', 27, false, false], ['Enter', 13, false, false], ['Tab', 9, true, false], ['/', 191, false, true]]) {
  test(`native ${alt ? 'Alt+' : ''}${value} input sends the correct key pair and observes after it`, async () => {
    const calls = await keyCalls(value, shift, alt);
    assert.deepEqual(calls, [
      ...[value === 'Enter' ? 'keyDown' : 'rawKeyDown', 'keyUp'].map(type => ({ method: 'Input.dispatchKeyEvent', params: {
        type, key: value, code: value === '/' ? 'Slash' : value, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: (shift ? 8 : 0) | (alt ? 1 : 0),
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

test('actual repeated breakpoint loop keeps every desktop transition closed and visibly header-focused', async () => {
  const source = verifyPageMenuDismissal.toString(), sizes = [], desktop = [], record = {}, options = [], labels = [];
  const start = source.indexOf('      if (width === 900) {');
  const block = source.slice(start, source.indexOf('      if (width === 390 && height === 844) await bounded', start));
  await vm.runInNewContext(`(async () => { ${block} })()`, { width: 900, height: 250, name: 'trust', current: '', record,
    expected: { ...expected(), width: 900 }, key: async () => {}, read: async expression => labels.push(expression),
    resize: async (width, height) => sizes.push([width, height]),
    settle: async (identity, wanted, predicate) => {
      options.push(wanted);
      if (identity.width === 901) {
        assert.equal(wanted.open, false); assert.equal(wanted.focus, 'header');
        assert.equal(predicate({ menuDisplay: 'none' }), true); assert.equal(predicate({ menuDisplay: 'block' }), false);
        desktop.push(identity);
      }
      return { ...fixture(), ...identity };
    }, open: async () => fixture(), escape: async () => fixture() });
  assert.equal(record.breakpointRepeats.length, 3); assert.equal(desktop.length, 6);
  assert.equal(labels.length, 9); assert.match(labels[0], /open-link-2/); assert.match(labels[4], /open-link-3/);
  assert.ok(labels.every(value => !/-1/.test(value)), 'The first complete pair runs without trace instrumentation');
  assert.equal(labels.at(-1), 'globalThis.__rwnMenuDismissal.breakpoint = null');
  assert.deepEqual(sizes, Array.from({ length: 3 }, () => [[901, 250], [900, 250], [901, 250], [900, 250]]).flat());
  assert.equal(options.filter(value => value.open === true && value.focus === 0).length, 3);
  for (const [index, transition] of record.breakpointRepeats.entries()) {
    assert.equal(transition.cycle, index + 1); assert.equal(transition.instrumented, index > 0);
    for (const key of ['inclusive900', 'desktop901', 'resizeRepeat', 'closedSummary901', 'closedResizeRepeat']) assert.ok(transition[key]);
  }
});

test('CI matrix preserves real native inputs, existing history suites and same-document identity', async () => {
  assert.deepEqual(PAGE_MENU_DISMISSAL_VIEWPORTS, [[320, 780], [390, 844], [320, 250], [390, 250], [900, 250]]);
  const source = verifyPageMenuDismissal.toString();
  assert.match(source, /\[\['directory',[^\n]*\['service',[^\n]*\['trust',/);
  for (const requirement of ['Input.dispatchMouseEvent', 'Input.dispatchKeyEvent', 'Input.insertText', 'Page.reload',
    'preventedEscape', 'outsideEscape', 'outsideKept', 'outsideRepaired', 'queryEscape', 'reloadRepeat', 'inclusive900', 'desktop901',
    'closedSummary901', 'closedResizeRepeat', 'page-menu-dismissal.json', 'Runtime.exceptionThrown']) assert.ok(source.includes(requirement), requirement);
  assert.match(source, /for \(let cycle = 1; cycle <= 3; cycle\+\+\)/);
  assert.match(source, /record.breakpointRepeats.push\(transition\)/);
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
