import { mkdir, writeFile } from 'node:fs/promises';
import { isDirectoryStartupNavigationError } from './qa-directory-startup.mjs';

export const PAGE_MENU_REFLOW_LINKS = [
  ['/', 'Find help'], ['/directory', 'Directory'], ['/directory#saved', 'Saved'],
  ['/editorial-policy', 'How listings are checked'], ['/sources', 'Sources'], ['/transparency', 'Transparency']
];
export const PAGE_MENU_REFLOW_VIEWPORTS = [
  [320, 422], [390, 422], [320, 250], [390, 250], [320, 189], [390, 189],
  [568, 250], [900, 250], [390, 844]
];
// Exact declarations from main 7e68bc3102f52d1304a905b2bfc871c6a6a0437d.
// Original public/navigation-actions.css SHA-256:
// 1fe73d007c9c71398e1a1b9a03dc722064c098355ade74630674bde8bd7df3f5
// Replacing these two CSSOM rules removes new declarations as well as restoring
// old ones. This is a CI-only baseline fixture, never a production stylesheet.
export const PAGE_MENU_BASELINE_RULES = [
  { selector: '.rwn-page-menu nav', media: null,
    declarations: 'position:absolute;top:calc(100% + .45rem);right:0;z-index:80;display:grid;width:min(19rem,calc(100vw - 1.5rem));overflow:hidden;border:1px solid var(--rwn-action-line);border-radius:8px;background:#fff;box-shadow:0 16px 38px rgba(8,26,34,.14)' },
  { selector: '.legal-header.rwn-unified-header .rwn-page-menu nav', media: '(max-width: 900px)',
    declarations: 'display:grid!important;max-width:none!important;overflow:hidden!important;white-space:normal!important' }
];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (ok, label, detail) => { if (!ok) throw new Error(`${label}: ${JSON.stringify(detail)}`); };
const finite = values => values.every(Number.isFinite);
const contained = (box, port) => Boolean(box && port && finite([box.left, box.right, box.top, box.bottom, port.left, port.right, port.top, port.bottom])
  && box.left >= port.left - .5 && box.right <= port.right + .5 && box.top >= port.top - .5 && box.bottom <= port.bottom + .5);

// Border-radius clips overflow at the inner border edge. Requiring every
// outline corner to fit also catches clipping that rectangular bounds miss.
export function pageMenuRingContained(ring, nav) {
  if (!contained(ring, nav?.port) || nav.radii?.length !== 4) return false;
  const p = nav.port;
  return nav.radii.every(({ x, y }, index) => {
    if (!finite([x, y]) || x < 0 || y < 0) return false;
    if (!x || !y) return true;
    const right = index === 1 || index === 2, bottom = index >= 2;
    const dx = Math.max(0, x - (right ? p.right - ring.right : ring.left - p.left));
    const dy = Math.max(0, y - (bottom ? p.bottom - ring.bottom : ring.top - p.top));
    return dx === 0 || dy === 0 || (dx / x) ** 2 + (dy / y) ** 2 <= 1;
  });
}

// Serialized into Chrome. Observe layout and focus without scrolling or focusing
// anything. Browser input, rather than element.focus()/click(), owns the flow.
export function pageMenuReflowSnapshot() {
  const doc = globalThis.document, menu = doc?.querySelector('.rwn-page-menu'), nav = menu?.querySelector('nav');
  const box = node => {
    const r = node?.getBoundingClientRect();
    return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } : null;
  };
  const hit = node => {
    const r = box(node); if (!r || r.width <= 0 || r.height <= 0) return false;
    const target = doc.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
    return Boolean(target && (target === node || node.contains(target)));
  };
  const navBox = box(nav), summary = menu?.querySelector('summary'), style = nav && getComputedStyle(nav);
  const radius = (value, size) => parseFloat(value) * (value?.endsWith('%') ? size / 100 : 1);
  const radii = nav && ['TopLeft', 'TopRight', 'BottomRight', 'BottomLeft'].map(corner => {
    const [x, y = x] = style[`border${corner}Radius`].split(/\s+/);
    return { x: Math.max(0, radius(x, navBox.width) - parseFloat(style[corner.includes('Left') ? 'borderLeftWidth' : 'borderRightWidth'])),
      y: Math.max(0, radius(y, navBox.height) - parseFloat(style[corner.includes('Top') ? 'borderTopWidth' : 'borderBottomWidth'])) };
  });
  const links = [...(nav?.querySelectorAll('a') || [])].map(node => {
    const rect = box(node), css = getComputedStyle(node), outline = parseFloat(css.outlineWidth), offset = parseFloat(css.outlineOffset);
    const extent = Math.max(0, outline + offset), ring = rect && { left: rect.left - extent, right: rect.right + extent, top: rect.top - extent, bottom: rect.bottom + extent };
    return { href: node.getAttribute('href'), text: node.textContent.trim(), box: rect, hit: hit(node),
      focused: doc.activeElement === node, focusVisible: node.matches(':focus-visible'),
      outline: { style: css.outlineStyle, width: outline, offset, color: css.outlineColor }, ring };
  });
  return {
    ready: Boolean(doc?.documentElement && doc.body && doc.querySelector('h1') && menu && nav && summary && doc.readyState === 'complete'),
    href: globalThis.location?.href, title: doc?.title || '', heading: doc?.querySelector('h1')?.textContent.trim() || '',
    timeOrigin: globalThis.performance?.timeOrigin ?? null, width: globalThis.innerWidth, height: globalThis.innerHeight,
    clientWidth: doc?.documentElement?.clientWidth, scrollWidth: doc?.documentElement?.scrollWidth,
    scrollX: globalThis.scrollX, scrollY: globalThis.scrollY,
    overlay: Boolean(doc?.querySelector('vite-error-overlay, nextjs-portal, #webpack-dev-server-client-overlay')),
    menuOpen: Boolean(menu?.open), menuDisplay: menu && getComputedStyle(menu).display,
    summary: { box: box(summary), hit: hit(summary), focused: doc?.activeElement === summary },
    nav: nav && { box: navBox, port: { left: navBox.left + nav.clientLeft, top: navBox.top + nav.clientTop,
      right: navBox.left + nav.clientLeft + nav.clientWidth, bottom: navBox.top + nav.clientTop + nav.clientHeight },
      radii, clientHeight: nav.clientHeight, scrollHeight: nav.scrollHeight, scrollTop: nav.scrollTop,
      scrollWidth: nav.scrollWidth, clientWidth: nav.clientWidth, overflowY: style.overflowY, overscrollY: style.overscrollBehaviorY },
    links, inputs: globalThis.__rwnPageMenuReflowInputs || []
  };
}

export function pageMenuReflowIdentity(actual, expected) {
  return Boolean(actual?.ready && actual.href === expected.href && actual.title && actual.heading && !actual.overlay
    && finite([actual.timeOrigin, actual.width, actual.height, actual.clientWidth, actual.scrollWidth, actual.scrollX, actual.scrollY])
    && actual.width > 0 && actual.height > 0 && actual.clientWidth > 0 && actual.scrollWidth >= actual.clientWidth
    && actual.width === expected.width && actual.height === expected.height
    && (!('timeOrigin' in expected) || Number.isFinite(expected.timeOrigin) && actual.timeOrigin === expected.timeOrigin)
    && (!('previousTimeOrigin' in expected) || Number.isFinite(expected.previousTimeOrigin) && actual.timeOrigin !== expected.previousTimeOrigin)
    && (!('title' in expected) || actual.title === expected.title) && (!('heading' in expected) || actual.heading === expected.heading));
}

export function pageMenuReflowViolations(actual, expected, { focusedIndex, scrollY = 0 } = {}) {
  const issues = [];
  if (!pageMenuReflowIdentity(actual, expected)) issues.push('document-identity');
  if (!actual) return issues;
  const viewport = { left: 0, top: 0, right: actual.clientWidth, bottom: actual.height };
  if (actual.scrollWidth > actual.clientWidth + 1 || Math.abs(actual.scrollX) > .5) issues.push('horizontal-overflow');
  if (!Number.isFinite(scrollY) || Math.abs(actual.scrollY - scrollY) > .5) issues.push('page-scroll-leak');
  if (!actual.menuOpen || actual.menuDisplay === 'none') issues.push('menu-closed');
  if (JSON.stringify(actual.links?.map(link => [link.href, link.text])) !== JSON.stringify(PAGE_MENU_REFLOW_LINKS)) issues.push('link-order');
  if (!contained(actual.summary?.box, viewport) || actual.summary?.box?.height < 44 || actual.summary?.box?.width < 44 || !actual.summary?.hit) issues.push('summary-unreachable');
  if (!contained(actual.nav?.box, viewport)) issues.push('panel-outside-viewport');
  if (!actual.nav || !finite([actual.nav.clientHeight, actual.nav.clientWidth, actual.nav.scrollHeight, actual.nav.scrollWidth, actual.nav.scrollTop])
    || actual.nav.clientHeight < 44 || actual.nav.clientWidth < 44 || actual.nav.scrollTop < 0 || actual.nav.overflowY !== 'auto'
    || actual.nav.scrollWidth > actual.nav.clientWidth + 1) issues.push('panel-scrollport');
  if (actual.links?.some(link => !link.box || !finite(Object.values(link.box)) || link.box.height < 44 || link.box.width < 44)) issues.push('small-target');
  if (focusedIndex !== undefined) {
    const link = actual.links?.[focusedIndex];
    if (!link?.focused || !link.focusVisible) issues.push('keyboard-focus');
    if (!link?.hit || !contained(link?.box, actual.nav?.port) || !contained(link?.box, viewport)) issues.push('focused-link-clipped');
    if (!link?.outline || !finite([link.outline.width, link.outline.offset]) || link.outline.width <= 0
      || ['none', 'hidden'].includes(link.outline.style) || ['transparent', 'rgba(0, 0, 0, 0)'].includes(link.outline.color)) issues.push('focused-ring-missing');
    if (!pageMenuRingContained(link?.ring, actual.nav) || !contained(link?.ring, viewport)) issues.push('focused-ring-clipped');
  }
  return issues;
}

// Operates only on the already loaded QA document. Each fixed declaration is
// retained verbatim and restored even when baseline evidence fails.
export function pageMenuBaselineStyle(mode, baselineRules) {
  const key = '__rwnPageMenuReflowStyles';
  if (mode === 'restore') {
    const saved = globalThis[key];
    if (!saved) return false;
    for (const { rule, cssText } of saved) rule.style.cssText = cssText;
    const restored = saved.every(({ rule, cssText }) => rule.style.cssText === cssText);
    delete globalThis[key]; return restored;
  }
  if (mode !== 'apply' || globalThis[key]) throw new Error('Invalid baseline CSS fixture lifecycle');
  const sheets = [...document.styleSheets].filter(sheet => sheet.href && new URL(sheet.href).pathname === '/navigation-actions.css');
  if (sheets.length !== 1) throw new Error('Expected one real navigation-actions.css stylesheet');
  const candidates = [];
  const visit = (rules, media = null) => {
    for (const rule of rules) {
      if (rule.selectorText) candidates.push({ rule, media });
      else if (rule.cssRules) visit(rule.cssRules, rule.conditionText || media);
    }
  };
  visit(sheets[0].cssRules);
  const saved = baselineRules.map(fixture => {
    const matches = candidates.filter(({ rule, media }) => rule.selectorText === fixture.selector && media === fixture.media);
    if (matches.length !== 1) throw new Error(`Expected exactly one baseline rule: ${fixture.selector}`);
    return { rule: matches[0].rule, cssText: matches[0].rule.style.cssText, baseline: fixture.declarations };
  });
  globalThis[key] = saved;
  try { for (const { rule, baseline } of saved) rule.style.cssText = baseline; }
  catch (error) { for (const { rule, cssText } of saved) rule.style.cssText = cssText; delete globalThis[key]; throw error; }
  return saved.map(({ rule, cssText }) => ({ selector: rule.selectorText, fixed: cssText, baseline: rule.style.cssText }));
}

export async function withPageMenuBaseline({ client, evaluate, run }) {
  const applied = await evaluate(client, `(${pageMenuBaselineStyle.toString()})('apply', ${JSON.stringify(PAGE_MENU_BASELINE_RULES)})`);
  let result, failure;
  try { result = await run(applied); } catch (error) { failure = error; }
  try {
    assert(await evaluate(client, `(${pageMenuBaselineStyle.toString()})('restore')`), 'Baseline CSS was not restored');
  } catch (error) { throw failure ? new AggregateError([failure, error], 'Baseline QA failed and fixed CSS restoration failed') : error; }
  if (failure) throw failure;
  return result;
}

// Native focus outside the sticky menu can start a smooth document scroll.
// Adopt its resting position, never an intermediate animation frame, as the
// baseline for subsequent menu-only containment checks.
export async function waitForPageMenuReflowQuiet({ sample, predicate, wait = sleep, now = () => performance.now(),
  timeoutMs = 3000, quietMs = 200 }) {
  const start = now(); let latest, signature, since = start, count = 0;
  while (now() - start < timeoutMs) {
    latest = await sample();
    const valid = predicate(latest) && finite([latest.scrollX, latest.scrollY, latest.nav?.scrollTop]);
    const next = valid && JSON.stringify([latest.href, latest.timeOrigin, latest.scrollX, latest.scrollY, latest.nav.scrollTop]);
    if (!valid || next !== signature) { signature = next; since = now(); count = valid ? 1 : 0; }
    else count++;
    if (valid && count >= 3 && now() - since >= quietMs) return latest;
    await wait(40);
  }
  throw new Error(`Native menu focus scroll did not settle: ${JSON.stringify(latest)}`);
}

export async function verifyPageMenuReflow({ client, host, serviceUrl, navigate, evaluate, capture }) {
  const evidence = { baseline: null, cases: [], errors: [] };
  let current = 'startup';
  const snapshot = () => evaluate(client, `(${pageMenuReflowSnapshot.toString()})()`);
  const frame = () => evaluate(client, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const sampleUntil = async (predicate, label) => {
    let last;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { last = await snapshot(); if (predicate(last)) return last; }
      catch (error) { if (!isDirectoryStartupNavigationError(error)) throw error; }
      await sleep(40);
    }
    throw new Error(`${label}: ${JSON.stringify(last)}`);
  };
  const key = async (value, shift = false) => {
    const code = value === 'Tab' ? 9 : 13;
    // Enter needs the character-bearing keyDown used by the existing native
    // keyboard QA. rawKeyDown alone dispatches keydown without activation.
    const keyDown = value === 'Enter' ? 'keyDown' : 'rawKeyDown';
    for (const type of [keyDown, 'keyUp']) await client.call('Input.dispatchKeyEvent', {
      type, key: value, code: value, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: shift ? 8 : 0,
      ...(type === 'keyDown' ? { text: '\r', unmodifiedText: '\r' } : {})
    });
    await frame();
  };
  const click = async (box, settle = true) => {
    const point = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
    for (const type of ['mousePressed', 'mouseReleased']) await client.call('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
    if (settle) await frame();
  };
  const wheel = async (box, deltaY, { sample = snapshot, predicate }) => {
    await client.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2, deltaX: 0, deltaY });
    await frame();
    return waitForPageMenuReflowQuiet({ sample, predicate });
  };
  const load = async (href, width, height) => {
    await client.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 650, screenWidth: width, screenHeight: height });
    const previousTimeOrigin = await evaluate(client, 'performance.timeOrigin');
    assert(Number.isFinite(previousTimeOrigin), 'Missing previous document');
    await navigate(client, href);
    const state = await sampleUntil(actual => pageMenuReflowIdentity(actual, { href, width, height, previousTimeOrigin }), `Fresh document ${current}`);
    assert(state.scrollY === 0 && !state.menuOpen, 'Fresh page must begin closed and at top', state);
    await evaluate(client, `(() => {
      globalThis.__rwnPageMenuReflowInputs = [];
      for (const type of ['keydown', 'wheel']) document.addEventListener(type, event => {
        globalThis.__rwnPageMenuReflowInputs.push({ type, key: event.key, shift: event.shiftKey, trusted: event.isTrusted });
      }, { capture: true, passive: true });
    })()`);
    return { href, width, height, timeOrigin: state.timeOrigin, title: state.title, heading: state.heading };
  };
  const check = (state, expected, options) => {
    const issues = pageMenuReflowViolations(state, expected, options);
    assert(issues.length === 0, `${current} ${issues.join(', ')}`, state);
    return state;
  };
  const onMessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') evidence.errors.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(message.params.type)) evidence.errors.push(message.params);
  };
  client.ws.addEventListener('message', onMessage);
  try {
    current = 'baseline-320x250';
    const baselineExpected = await load(`${host}/directory`, 320, 250);
    evidence.baseline = await withPageMenuBaseline({ client, evaluate, run: async rules => {
      await click((await snapshot()).summary.box);
      const opened = await snapshot();
      for (let index = 0; index < 6; index++) await key('Tab');
      const keyboard = await waitForPageMenuReflowQuiet({ sample: snapshot,
        predicate: state => pageMenuReflowIdentity(state, baselineExpected) && state.links[5].focused });
      const issues = pageMenuReflowViolations(keyboard, baselineExpected, { focusedIndex: 5 });
      assert(pageMenuReflowIdentity(keyboard, baselineExpected) && keyboard.links[5].focused
        && keyboard.links[5].box.bottom > keyboard.height && issues.includes('panel-outside-viewport')
        && issues.includes('focused-link-clipped'), 'Real baseline did not reproduce the short-height defect', { keyboard, issues });
      await capture(client, 'page-menu-reflow-baseline-320x250.png');
      const panel = { ...opened.nav.box, bottom: Math.min(opened.nav.box.bottom, opened.height - 1) };
      const pointer = await wheel(panel, 800, {
        predicate: state => pageMenuReflowIdentity(state, baselineExpected) && state.nav.scrollTop === 0 && state.scrollY > keyboard.scrollY
      });
      assert(pageMenuReflowIdentity(pointer, baselineExpected) && keyboard.nav.scrollTop === 0 && pointer.nav.scrollTop === 0
        && pointer.scrollY > keyboard.scrollY && pointer.links[5].box.bottom > pointer.height,
        'Baseline wheel did not reproduce page-scroll leakage', { keyboard, pointer });
      return { sourceCommit: '7e68bc3102f52d1304a905b2bfc871c6a6a0437d', rules, opened, keyboard, issues, pointer };
    } });
    evidence.baseline.fixedCSSRestored = true;
    const pages = [['directory', `${host}/directory`], ['service', serviceUrl], ['trust', `${host}/editorial-policy`]];
    for (const [name, href] of pages) for (const [width, height] of PAGE_MENU_REFLOW_VIEWPORTS) {
      current = `${name}-${width}x${height}`;
      const expected = await load(href, width, height), record = { name, width, height, expected, forward: [], backward: [] };
      evidence.cases.push(record);
      await click((await snapshot()).summary.box);
      record.opened = check(await snapshot(), expected);
      for (let index = 0; index < 6; index++) {
        await key('Tab'); record.forward.push(check(await snapshot(), expected, { focusedIndex: index }));
      }
      await capture(client, `page-menu-reflow-${current}.png`);
      // Move beyond the final item, then reverse through all six links. This
      // proves Shift+Tab reaches the last link as well as the preceding five.
      await key('Tab');
      record.outside = await waitForPageMenuReflowQuiet({ sample: snapshot,
        predicate: state => pageMenuReflowIdentity(state, expected) && !state.summary.focused && state.links.every(link => !link.focused) });
      // Focusing content outside the sticky header may legitimately scroll the
      // page. Preserve that explicit baseline while input is back in the menu.
      const reverseScrollY = record.outside.scrollY;
      await key('Tab', true);
      for (let index = 5; index >= 0; index--) {
        if (index < 5) await key('Tab', true);
        record.backward.push(check(await snapshot(), expected, { focusedIndex: index, scrollY: reverseScrollY }));
      }
      await key('Tab', true);
      assert((await snapshot()).summary.focused, `${current} reverse traversal did not return to Menu`);
      await key('Enter');
      record.closed = await snapshot();
      assert(pageMenuReflowIdentity(record.closed, expected) && !record.closed.menuOpen && record.closed.summary.focused, `${current} native close failed`, record.closed);
      await key('Enter');
      record.reopened = check(await snapshot(), expected, { scrollY: reverseScrollY });
      const scrollable = record.reopened.nav.scrollHeight > record.reopened.nav.clientHeight;
      const menuWheel = (state, deltaY) => wheel(state.nav.port, deltaY, {
        // Every intermediate sample retains the original page-scroll baseline;
        // leaked scroll must throw, never settle into an accepted new baseline.
        sample: async () => check(await snapshot(), expected, { scrollY: reverseScrollY }),
        predicate: state => deltaY < 0 ? state.nav.scrollTop === 0
          : Math.abs(state.nav.scrollTop - (state.nav.scrollHeight - state.nav.clientHeight)) <= .5
      });
      if (scrollable) {
        // Reverse traversal resets toward the first link naturally. A negative
        // wheel reaches the boundary; the following wheel must scroll the menu.
        record.top = await menuWheel(record.reopened, -2000);
        assert(record.top.nav.scrollTop === 0, `${current} wheel cannot reach first link`, record.top.nav);
        record.pointer = await menuWheel(record.top, 2000);
      } else record.pointer = check(await snapshot(), expected, { scrollY: reverseScrollY });
      const final = record.pointer.links[5], viewport = { left: 0, top: 0, right: width, bottom: height };
      assert(final.hit && contained(final.box, record.pointer.nav.port) && contained(final.box, viewport)
        && (!scrollable || record.pointer.nav.scrollTop > 0), `${current} pointer cannot reach Transparency`, record.pointer);
      if (scrollable) {
        record.boundary = await menuWheel(record.pointer, 2000);
        assert(record.boundary.nav.scrollTop === record.pointer.nav.scrollTop, `${current} wheel did not settle at bottom`, record.boundary.nav);
      }
      const input = (record.boundary || record.pointer).inputs;
      assert(input.filter(event => event.type === 'keydown' && event.key === 'Tab' && !event.shift && event.trusted).length === 7
        && input.filter(event => event.type === 'keydown' && event.key === 'Tab' && event.shift && event.trusted).length === 7
        && (!scrollable || input.filter(event => event.type === 'wheel' && event.trusted).length >= 3), `${current} missing native input evidence`, input);
      await click(final.box, false);
      record.destination = await sampleUntil(actual => pageMenuReflowIdentity(actual, {
        href: `${host}/transparency`, width, height, previousTimeOrigin: expected.timeOrigin
      }) && !actual.menuOpen, `${current} exact Transparency navigation`);
      record.passed = true;
    }
    for (const [name, href] of pages) {
      current = `${name}-901x768`;
      const expected = await load(href, 901, 768), state = await snapshot();
      assert(pageMenuReflowIdentity(state, expected) && state.menuDisplay === 'none' && !state.menuOpen
        && state.scrollWidth <= state.clientWidth + 1, `${current} desktop breakpoint regression`, state);
      evidence.cases.push({ name, width: 901, height: 768, expected, desktop: state, passed: true });
    }
    assert(!evidence.errors.length, 'Generated menu browser errors', evidence.errors);
    console.log(`Generated menu reflow passed: ${evidence.cases.length} cases, native baseline defect reproduced and fixed CSS restored.`);
    return evidence;
  } catch (error) {
    evidence.failure = { current, message: error.message };
    try { evidence.failure.snapshot = await snapshot(); await capture(client, `page-menu-reflow-failure-${current}.png`); }
    catch (captureError) { evidence.failure.captureError = captureError.message; }
    throw error;
  } finally {
    client.ws.removeEventListener('message', onMessage);
    await mkdir('qa-screenshots', { recursive: true });
    await writeFile('qa-screenshots/page-menu-reflow.json', JSON.stringify(evidence, null, 2));
  }
}
