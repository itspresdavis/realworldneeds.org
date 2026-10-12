import { mkdir, writeFile } from 'node:fs/promises';
import { isDirectoryStartupNavigationError } from './qa-directory-startup.mjs';
import { PAGE_MENU_REFLOW_LINKS, pageMenuReflowSnapshot, pageMenuReflowIdentity } from './qa-page-menu-reflow.mjs';

export const PAGE_MENU_DISMISSAL_VIEWPORTS = [[320, 780], [390, 844], [320, 250], [390, 250], [900, 250]];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (ok, label, detail) => { if (!ok) throw new Error(`${label}: ${JSON.stringify(detail)}`); };
const bounded = async (task, timeoutMs = 5000) => {
  let timer;
  try { return await Promise.race([task(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Menu dismissal operation timed out')), timeoutMs); })]); }
  finally { clearTimeout(timer); }
};

// CI-only event observation. The two one-shot guards exercise prevented Escape
// and a native outside click whose mousedown deliberately leaves focus in place.
// No DOM state, production code, history lifecycle, or synthetic input is used.
export function observePageMenuDismissal() {
  const probe = globalThis.__rwnMenuDismissal = { events: [], ids: new WeakMap(), sequence: 0, preventEscape: false, retainPointer: false };
  for (const type of ['keydown', 'mousedown', 'click']) window.addEventListener(type, event => {
    const outside = !document.querySelector('.rwn-page-menu')?.contains(event.target);
    if (type === 'keydown' && event.key === 'Escape' && probe.preventEscape) { probe.preventEscape = false; event.preventDefault(); }
    if (type === 'mousedown' && outside && probe.retainPointer) { probe.retainPointer = false; event.preventDefault(); }
    const entry = { type, key: event.key || '', trusted: event.isTrusted, outside, prevented: event.defaultPrevented };
    probe.events.push(entry);
    setTimeout(() => { entry.prevented = event.defaultPrevented; }, 0);
  }, true);
}

// Extend the existing read-only geometry snapshot; focus IDs identify the exact
// node within one document even when directory rendering changes nearby nodes.
export function pageMenuDismissalSnapshot(base) {
  const doc = globalThis.document, menu = doc?.querySelector('.rwn-page-menu'), header = menu?.closest('header');
  const active = doc?.activeElement, probe = globalThis.__rwnMenuDismissal;
  if (active && probe && !probe.ids.has(active)) probe.ids.set(active, ++probe.sequence);
  const rect = active?.getBoundingClientRect(), css = active && getComputedStyle(active);
  const hit = rect && doc.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
  const visible = Boolean(rect && rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth
    && rect.top >= 0 && rect.bottom <= innerHeight && css.display !== 'none' && css.visibility !== 'hidden'
    && hit && (hit === active || active.contains(hit)));
  let outsidePoint = null;
  const h = header?.getBoundingClientRect();
  if (h) for (let x = Math.max(1, h.left + 2); x < Math.min(innerWidth, h.right) - 1; x += 4) {
    const y = Math.max(1, h.top + h.height / 2), node = doc.elementFromPoint(x, y);
    if (node && header.contains(node) && !menu.contains(node) && !node.closest('a, button, input, select, textarea, summary, [tabindex]')) {
      outsidePoint = { x, y }; break;
    }
  }
  return { ...base, native: Boolean(menu?.tagName === 'DETAILS' && menu.querySelector('summary')?.tagName === 'SUMMARY'),
    navigationType: globalThis.performance?.getEntriesByType?.('navigation')[0]?.type || '', outsidePoint,
    query: doc?.querySelector('[data-directory-query]')?.value,
    focus: { key: active && probe ? probe.ids.get(active) : null, tag: active?.tagName || '', visible,
      inMenu: Boolean(active && menu?.contains(active)), inHeader: Boolean(active && header?.contains(active)),
      query: Boolean(active?.matches('[data-directory-query]')), body: Boolean(active && active === doc?.body) },
    events: probe?.events || [] };
}

export function pageMenuDismissalViolations(actual, expected, { open, focus, focusKey, scrollY } = {}) {
  const issues = [];
  if (!pageMenuReflowIdentity(actual, expected)) issues.push('document-identity');
  if (!actual) return issues;
  if (!actual.native) issues.push('native-details');
  if (JSON.stringify(actual.links?.map(link => [link.href, link.text])) !== JSON.stringify(PAGE_MENU_REFLOW_LINKS)) issues.push('link-order');
  if (actual.scrollWidth > actual.clientWidth + 1 || Math.abs(actual.scrollX) > .5) issues.push('horizontal-overflow');
  if (open !== undefined && actual.menuOpen !== open) issues.push('menu-state');
  if (scrollY !== undefined && (!Number.isFinite(scrollY) || Math.abs(actual.scrollY - scrollY) > .5)) issues.push('page-scroll-leak');
  if (focus === 'summary' && (!actual.summary?.focused || !actual.summary.hit || !actual.focus?.visible)) issues.push('summary-focus');
  if (Number.isInteger(focus) && (!actual.links?.[focus]?.focused || !actual.links[focus].hit || !actual.focus?.visible)) issues.push('link-focus');
  if (focus === 'header' && (!actual.focus?.inHeader || actual.focus.inMenu || actual.focus.tag !== 'A' || !actual.focus.visible)) issues.push('header-focus');
  if (focus === 'query' && !actual.focus?.query) issues.push('query-focus');
  if (focusKey !== undefined && (!Number.isInteger(focusKey) || actual.focus?.key !== focusKey)) issues.push('focus-stolen');
  return issues;
}

export async function waitForPageMenuDismissal({ sample, expected, options = {}, predicate = () => true,
  wait = sleep, now = () => performance.now(), timeoutMs = 4000, quietMs = 200 }) {
  const start = now(); let latest, signature, since = start, count = 0;
  while (now() - start < timeoutMs) {
    try { latest = await bounded(sample, Math.max(1, timeoutMs - (now() - start))); }
    catch (error) { if (!isDirectoryStartupNavigationError(error)) throw error; latest = null; }
    const issues = pageMenuDismissalViolations(latest, expected, options);
    // A later return to the baseline must not conceal a sampled focus-scroll leak.
    assert(!issues.includes('page-scroll-leak'), 'Dismissal moved the page', latest);
    const valid = issues.length === 0 && predicate(latest);
    const next = valid && JSON.stringify([latest.href, latest.timeOrigin, latest.menuOpen, latest.focus,
      latest.scrollX, latest.scrollY, latest.nav?.scrollTop, latest.query]);
    if (!valid || next !== signature) { signature = next; since = now(); count = valid ? 1 : 0; }
    else count++;
    if (valid && count >= 3 && now() - since >= quietMs && now() - start < timeoutMs) return latest;
    await wait(40);
  }
  throw new Error(`Menu dismissal did not settle: ${JSON.stringify({ expected, options, latest })}`);
}

export async function verifyPageMenuDismissal({ client, host, serviceUrl, navigate, evaluate, capture }) {
  const evidence = { cases: [], errors: [], composition: 'Non-editable composing Escape is covered by runtime unit tests; no synthetic browser events.' };
  let current = 'startup';
  const call = (method, params) => bounded(() => client.call(method, params));
  const read = expression => bounded(() => evaluate(client, expression));
  const snapshot = () => read(`(${pageMenuDismissalSnapshot.toString()})((${pageMenuReflowSnapshot.toString()})())`);
  const frame = () => read('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const key = async (value, shift = false) => {
    const code = { Tab: 9, Enter: 13, Escape: 27, '/': 191 }[value];
    assert(code, 'Unsupported native key', value);
    for (const type of [value === 'Enter' ? 'keyDown' : 'rawKeyDown', 'keyUp']) await call('Input.dispatchKeyEvent', {
      type, key: value, code: value === '/' ? 'Slash' : value, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: shift ? 8 : 0,
      ...(type === 'keyDown' ? { text: '\r', unmodifiedText: '\r' } : {})
    });
    await frame();
  };
  const click = async point => {
    assert(point && Number.isFinite(point.x) && Number.isFinite(point.y), 'Missing native click point', point);
    for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
    await frame();
  };
  const resize = (width, height) => call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 650, screenWidth: width, screenHeight: height });
  const settle = (expected, options, predicate) => waitForPageMenuDismissal({ sample: snapshot, expected, options, predicate });
  const open = async expected => {
    const state = await snapshot(); assert(!state.menuOpen && state.summary.hit, 'Menu must start closed and reachable', state);
    const b = state.summary.box; await click({ x: (b.left + b.right) / 2, y: (b.top + b.bottom) / 2 });
    return settle(expected, { open: true, focus: 'summary' });
  };
  const escape = async (expected, from) => {
    await key('Escape');
    const state = await settle(expected, { open: false, focus: 'summary', scrollY: from.scrollY });
    const events = state.events.slice(from.events.length);
    assert(events.length === 1 && events[0].type === 'keydown' && events[0].key === 'Escape'
      && events[0].trusted && !events[0].outside && events[0].prevented, 'Ordinary owned Escape was not consumed', events);
    return state;
  };
  const outside = async (expected, from, focus) => {
    await read('globalThis.__rwnMenuDismissal.retainPointer = true');
    await click(from.outsidePoint);
    return settle(expected, { open: false, focus, ...(focus === 'header' ? { focusKey: from.focus.key } : {}), scrollY: from.scrollY });
  };
  const onMessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') evidence.errors.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(message.params.type)) evidence.errors.push(message.params);
  };
  client.ws.addEventListener('message', onMessage);
  try {
    const pages = [['directory', `${host}/directory`], ['service', serviceUrl], ['trust', `${host}/editorial-policy`]];
    for (const [name, href] of pages) for (const [width, height] of PAGE_MENU_DISMISSAL_VIEWPORTS) {
      current = `${name}-${width}x${height}`;
      await resize(width, height);
      const previousTimeOrigin = await read('performance.timeOrigin');
      await bounded(() => navigate(client, href), 10000);
      const initial = await settle({ href, width, height, previousTimeOrigin }, { open: false });
      let expected = { href, width, height, timeOrigin: initial.timeOrigin, title: initial.title, heading: initial.heading };
      await read(`(${observePageMenuDismissal.toString()})()`);
      const record = { name, width, height, expected: { ...expected } }; evidence.cases.push(record);
      record.summaryEscape = await escape(expected, await open(expected));
      await key('Enter'); await key('Tab');
      record.link = await settle(expected, { open: true, focus: 0 });
      if (width === 390 && height === 844) await bounded(() => capture(client, `page-menu-dismissal-${name}-open.png`));
      record.linkEscape = await escape(expected, record.link);
      await key('Enter'); await key('Tab');
      const guarded = await settle(expected, { open: true, focus: 0 });
      await read('globalThis.__rwnMenuDismissal.preventEscape = true'); await key('Escape');
      record.preventedEscape = await settle(expected, { open: true, focus: 0, focusKey: guarded.focus.key, scrollY: guarded.scrollY });
      await escape(expected, record.preventedEscape);
      await key('Enter'); await key('Tab', true);
      const header = await settle(expected, { open: true, focus: 'header' });
      await key('Escape');
      record.outsideEscape = await settle(expected, { open: true, focus: 'header', focusKey: header.focus.key, scrollY: header.scrollY });
      record.outsideKept = await outside(expected, record.outsideEscape, 'header');
      await open(expected);
      for (let index = 0; index < PAGE_MENU_REFLOW_LINKS.length; index++) await key('Tab');
      record.lastLink = await settle(expected, { open: true, focus: 5 });
      if (height === 250) assert(record.lastLink.nav.scrollTop > 0, 'Short-height menu must scroll to its last link', record.lastLink);
      record.outsideRepaired = await outside(expected, record.lastLink, 'summary');
      await key('Enter'); await settle(expected, { open: true, focus: 'summary' });
      await key('Enter'); record.nativeToggle = await settle(expected, { open: false, focus: 'summary' });
      if (name === 'directory' && width === 390 && height === 844) {
        await key('Enter'); await key('/'); await settle(expected, { open: true, focus: 'query' });
        await call('Input.insertText', { text: 'library' });
        const query = await settle(expected, { open: true, focus: 'query' }, state => state.query === 'library');
        await key('Escape');
        record.queryEscape = await settle(expected, { open: true, focus: 'query', focusKey: query.focus.key }, state => state.query === '');
        // Real outside click on the inert header; let the browser own ordinary pointer focus.
        await click(record.queryEscape.outsidePoint); record.ordinaryOutside = await settle(expected, { open: false });
      }
      const beforeReload = await snapshot();
      await call('Page.reload');
      const { timeOrigin, ...reloadExpected } = expected;
      record.reload = await settle({ ...reloadExpected, previousTimeOrigin: timeOrigin }, { open: false }, state => state.navigationType === 'reload');
      expected = { ...expected, timeOrigin: record.reload.timeOrigin };
      await read(`(${observePageMenuDismissal.toString()})()`);
      await open(expected); await key('Tab');
      record.reloadRepeat = await escape(expected, await settle(expected, { open: true, focus: 0 }));
      if (width === 900) {
        await key('Enter'); await key('Tab');
        record.inclusive900 = await settle(expected, { open: true, focus: 0 });
        await resize(901, height);
        record.desktop901 = await settle({ ...expected, width: 901 }, { open: false, focus: 'header' }, state => state.menuDisplay === 'none');
        await resize(900, height); await settle(expected, { open: false });
        record.resizeRepeat = await escape(expected, await open(expected));
        await resize(901, height);
        record.closedSummary901 = await settle({ ...expected, width: 901 }, { open: false, focus: 'header' }, state => state.menuDisplay === 'none');
        await resize(900, height);
        record.closedResizeRepeat = await escape(expected, await open(expected));
      }
      if (width === 390 && height === 844) await bounded(() => capture(client, `page-menu-dismissal-${name}-closed.png`));
      const events = beforeReload.events;
      assert(events.every(event => event.trusted)
        && events.some(event => event.type === 'keydown' && event.key === 'Escape' && !event.outside && event.prevented)
        && events.some(event => event.type === 'keydown' && event.key === 'Escape' && event.outside && !event.prevented)
        && events.filter(event => event.type === 'mousedown' && event.outside && event.prevented).length === 2
        && events.filter(event => event.type === 'click' && event.outside && !event.prevented).length >= 2,
      'Missing native dismissal input evidence', events);
      record.passed = true;
    }
    assert(!evidence.errors.length, 'Generated menu browser errors', evidence.errors);
    console.log(`Generated menu dismissal passed: ${evidence.cases.length} native-input cases including reload and the 900/901 breakpoint.`);
    return evidence;
  } catch (error) {
    evidence.failure = { current, message: error.message };
    try { evidence.failure.snapshot = await snapshot(); await bounded(() => capture(client, `page-menu-dismissal-failure-${current}.png`)); }
    catch (captureError) { evidence.failure.captureError = captureError.message; }
    throw error;
  } finally {
    client.ws.removeEventListener('message', onMessage);
    await mkdir('qa-screenshots', { recursive: true });
    await writeFile('qa-screenshots/page-menu-dismissal.json', JSON.stringify(evidence, null, 2));
  }
}
