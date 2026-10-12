import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDirectoryStartupNavigationError } from './qa-directory-startup.mjs';

// CI-only: this module uses the existing runner's browser and never launches one.
export const DIRECTORY_PAGINATION_VIEWPORTS = [[1440, 1000], [320, 844]];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (ok, label, detail) => { if (!ok) throw new Error(`${label}: ${JSON.stringify(detail)}`); };
const finite = values => values.every(Number.isFinite);
const pageHref = page => page === 1 ? '/directory' : `/directory/page/${page}`;
const contained = (box, port) => Boolean(box && port && finite([box.left, box.right, box.top, box.bottom, port.left, port.right, port.top, port.bottom])
  && box.left >= port.left - 1 && box.right <= port.right + 1 && box.top >= port.top - 1 && box.bottom <= port.bottom + 1);

// Serialized into the browser. Observation only: never focus, scroll, click,
// assign values, open details, or synthesize DOM input from an evaluation.
export function directoryPaginationSnapshot() {
  const doc = globalThis.document;
  const box = node => {
    const r = node?.getBoundingClientRect();
    return r ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height } : null;
  };
  const element = node => {
    if (!node) return null;
    const rect = box(node), css = getComputedStyle(node), extent = Math.max(0, parseFloat(css.outlineWidth) + parseFloat(css.outlineOffset));
    const hiddenDetails = node.closest('details:not([open])');
    const visible = Boolean(rect.width > 0 && rect.height > 0 && css.display !== 'none' && !['hidden', 'collapse'].includes(css.visibility)
      && css.opacity !== '0' && (!hiddenDetails || hiddenDetails.querySelector(':scope > summary')?.contains(node)));
    const hit = visible && doc.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
    const ring = { left: rect.left - extent, right: rect.right + extent, top: rect.top - extent, bottom: rect.bottom + extent };
    const clips = [];
    for (let parent = node.parentElement; parent && parent !== doc.body && parent !== doc.documentElement; parent = parent.parentElement) {
      const style = getComputedStyle(parent), r = box(parent);
      if (['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowX) || ['hidden', 'clip', 'auto', 'scroll'].includes(style.overflowY)) {
        clips.push({ left: r.left + parent.clientLeft, right: r.left + parent.clientLeft + parent.clientWidth,
          top: r.top + parent.clientTop, bottom: r.top + parent.clientTop + parent.clientHeight,
          x: style.overflowX !== 'visible', y: style.overflowY !== 'visible' });
      }
    }
    return { tag: node.tagName, text: node.textContent.trim(), href: node.getAttribute('href'), label: node.getAttribute('aria-label'),
      current: node.getAttribute('aria-current'), role: node.getAttribute('role'), tabIndex: node.tabIndex,
      visible, box: rect, hit: Boolean(hit && (hit === node || node.contains(hit))), inHeader: Boolean(node.closest('.legal-header')), focused: doc.activeElement === node,
      focusVisible: node.matches(':focus-visible'), ring, clips,
      outline: { width: parseFloat(css.outlineWidth), offset: parseFloat(css.outlineOffset), style: css.outlineStyle, color: css.outlineColor } };
  };
  const navs = [...(doc?.querySelectorAll('nav.directory-pagination') || [])].map(nav => {
    const picker = nav.querySelector(':scope > details.directory-page-picker'), list = picker?.querySelector(':scope > ol.directory-page-list');
    return { tag: nav.tagName, label: nav.getAttribute('aria-label'), classes: [...nav.classList], visible: element(nav).visible, box: box(nav),
      status: nav.querySelector(':scope > span')?.textContent.trim(), pickerTag: picker?.tagName, open: Boolean(picker?.open),
      summary: element(picker?.querySelector(':scope > summary')), listTag: list?.tagName, listBox: box(list),
      listClientWidth: list?.clientWidth, listScrollWidth: list?.scrollWidth,
      previous: [...nav.querySelectorAll(':scope > a[rel~="prev"]')].map(element),
      next: [...nav.querySelectorAll(':scope > a[rel~="next"]')].map(element),
      items: [...(list?.children || [])].map(item => ({ li: item.tagName === 'LI', children: item.children.length, ...element(item.firstElementChild) })) };
  });
  const shell = doc?.querySelector('.directory-shell');
  return { ready: Boolean(doc?.body && doc.readyState === 'complete' && doc.querySelector('#directory h1') && navs.length),
    href: globalThis.location?.href, title: doc?.title, heading: doc?.querySelector('h1')?.textContent.trim(),
    timeOrigin: globalThis.performance?.timeOrigin, width: globalThis.innerWidth, height: globalThis.innerHeight,
    clientWidth: doc?.documentElement?.clientWidth, scrollWidth: doc?.documentElement?.scrollWidth,
    scrollX: globalThis.scrollX, scrollY: globalThis.scrollY,
    headerBottom: Math.max(0, doc?.querySelector('.legal-header')?.getBoundingClientRect().bottom || 0),
    overlay: Boolean(doc?.querySelector('vite-error-overlay, nextjs-portal, #webpack-dev-server-client-overlay')),
    navs, staticRows: [...(doc?.querySelectorAll('.directory-records h2 a') || [])].map(node => node.getAttribute('href')),
    query: element(doc?.querySelector('[data-directory-query]')), queryValue: doc?.querySelector('[data-directory-query]')?.value,
    initialized: Boolean(doc?.querySelector('.directory-global-results')),
    search: Boolean(shell?.classList.contains('has-global-search')), saved: Boolean(shell?.classList.contains('has-saved-view')),
    savedVisible: Boolean(element(doc?.querySelector('[data-saved-services]'))?.visible),
    savedLink: [...(doc?.querySelectorAll('.legal-header a[href="/directory#saved"]') || [])].map(element).find(node => node.visible),
    menuSummary: element(doc?.querySelector('.rwn-page-menu > summary')), menuOpen: Boolean(doc?.querySelector('.rwn-page-menu[open]')),
    count: doc?.querySelector('[data-directory-count]')?.textContent.trim() };
}

export function directoryPaginationIdentity(actual, expected) {
  return Boolean(actual?.ready && actual.href === expected.href && actual.title && actual.heading && !actual.overlay
    && finite([actual.timeOrigin, actual.width, actual.height, actual.clientWidth, actual.scrollWidth, actual.scrollX, actual.scrollY])
    && actual.width === expected.width && actual.height === expected.height && actual.clientWidth > 0 && actual.scrollWidth >= actual.clientWidth
    && (!('timeOrigin' in expected) || Number.isFinite(expected.timeOrigin) && actual.timeOrigin === expected.timeOrigin)
    && (!('previousTimeOrigin' in expected) || Number.isFinite(expected.previousTimeOrigin) && actual.timeOrigin !== expected.previousTimeOrigin));
}

export function directoryPaginationViolations(actual, expected, { hidden = false, focus } = {}) {
  const issues = [];
  if (!directoryPaginationIdentity(actual, expected)) issues.push('document-identity');
  if (!actual) return issues;
  if (actual.scrollWidth > actual.clientWidth + 1 || Math.abs(actual.scrollX) > .5) issues.push('horizontal-overflow');
  if (!Number.isInteger(expected.page) || !Number.isInteger(expected.total) || expected.page < 1 || expected.total < 2 || expected.page > expected.total) issues.push('invalid-expectation');
  if (actual.navs?.length !== 2) issues.push('two-pagination-landmarks');
  for (const [index, nav] of (actual.navs || []).entries()) {
    const fail = value => issues.push(`${index}:${value}`);
    if (nav.tag !== 'NAV' || nav.label !== 'Directory pages' || !nav.classes?.includes('directory-downloads')) fail('landmark');
    if (nav.status !== `Page ${expected.page} of ${expected.total}`) fail('status');
    if (nav.pickerTag !== 'DETAILS' || nav.summary?.tag !== 'SUMMARY' || nav.summary?.text !== 'Choose a page' || nav.summary.role) fail('native-picker');
    if (nav.listTag !== 'OL' || nav.items?.length !== expected.total) fail('complete-page-list');
    for (const [itemIndex, item] of (nav.items || []).entries()) {
      const page = itemIndex + 1, current = page === expected.page;
      if (!item.li || item.children !== 1 || item.text !== String(page)
        || item.tag !== (current ? 'SPAN' : 'A') || item.label !== `Page ${page}${current ? ', current page' : ''}`
        || item.current !== (current ? 'page' : null) || item.href !== (current ? null : pageHref(page))
        || (current ? item.tabIndex >= 0 : item.tabIndex !== 0)) fail(`page-${page}-semantics`);
    }
    for (const [name, page, present, label] of [['previous', expected.page - 1, expected.page > 1, 'Previous'], ['next', expected.page + 1, expected.page < expected.total, 'Next']]) {
      const links = nav[name];
      if (links?.length !== (present ? 1 : 0) || (present && (links[0].href !== pageHref(page) || links[0].text !== label))) fail(`${name}-semantics`);
    }
    if (hidden) {
      if (nav.visible || nav.summary?.visible || nav.items?.some(item => item.visible) || [...(nav.previous || []), ...(nav.next || [])].some(item => item.visible)) fail('hidden-state');
      continue;
    }
    if (!nav.visible || !nav.summary?.visible) fail('visible-pagination');
    const targets = [nav.summary, ...(nav.previous || []), ...(nav.next || []), ...(nav.open ? nav.items || [] : [])];
    if (targets.some(item => !item?.visible || !item.box || !finite(Object.values(item.box)) || item.box.width < 44 || item.box.height < 44)) fail('small-or-hidden-target');
    if (targets.some(item => !item?.box || item.box.left < -1 || item.box.right > actual.clientWidth + 1)) fail('target-horizontal-overflow');
    if (nav.open && (!finite([nav.listClientWidth, nav.listScrollWidth]) || nav.listScrollWidth > nav.listClientWidth + 1)) fail('list-horizontal-overflow');
    if (!nav.open && nav.items?.some(item => item.visible)) fail('collapsed-list-visible');
  }
  if (focus) {
    const nav = actual.navs?.[focus.nav], target = focus.target === 'summary' ? nav?.summary : nav?.items?.[focus.target - 1];
    const viewport = { left: 0, right: actual.clientWidth, top: actual.headerBottom + 2, bottom: actual.height };
    if (!target?.focused || !target.focusVisible) issues.push('keyboard-focus');
    if (!target?.hit || !contained(target?.box, viewport)) issues.push('focused-target-clipped');
    if (!target?.outline || !finite([target.outline.width, target.outline.offset]) || target.outline.width <= 0
      || ['none', 'hidden'].includes(target.outline.style) || ['transparent', 'rgba(0, 0, 0, 0)'].includes(target.outline.color)) issues.push('focus-ring-missing');
    if (!contained(target?.ring, viewport) || target?.clips?.some(clip => (clip.x && (target.ring.left < clip.left - 1 || target.ring.right > clip.right + 1))
      || (clip.y && (target.ring.top < clip.top - 1 || target.ring.bottom > clip.bottom + 1)))) issues.push('focus-ring-clipped');
  }
  return issues;
}

export async function directoryPaginationKey(client, value, { shift = false, control = false } = {}) {
  const keys = { Tab: [9, 'Tab'], Enter: [13, 'Enter'], ' ': [32, 'Space'], Escape: [27, 'Escape'], a: [65, 'KeyA'] };
  if (!keys[value]) throw new Error(`Unsupported pagination QA key: ${value}`);
  const [code, name] = keys[value], text = value === 'Enter' ? '\r' : value === ' ' ? ' ' : null;
  for (const type of [text ? 'keyDown' : 'rawKeyDown', 'keyUp']) await client.call('Input.dispatchKeyEvent', {
    type, key: value, code: name, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code, modifiers: (shift ? 8 : 0) | (control ? 2 : 0),
    ...(type === 'keyDown' ? { text, unmodifiedText: text } : {})
  });
}

export async function withDirectoryScriptsDisabled(client, run) {
  await client.call('Emulation.setScriptExecutionDisabled', { value: true });
  let result, failure;
  try { result = await run(); } catch (error) { failure = error; }
  try { await client.call('Emulation.setScriptExecutionDisabled', { value: false }); }
  catch (error) { throw failure ? new AggregateError([failure, error], 'Pagination QA and JavaScript restoration failed') : error; }
  if (failure) throw failure;
  return result;
}

export async function waitForDirectoryPagination({ sample, predicate, label, wait = sleep, now = () => performance.now(), timeoutMs = 6500 }) {
  const started = now(); let state, signature, since = started, samples = 0;
  while (now() - started < timeoutMs) {
    try { state = await sample(); }
    catch (error) { if (!isDirectoryStartupNavigationError(error)) throw error; state = null; }
    const valid = Boolean(state && predicate(state));
    const next = valid && JSON.stringify([state.href, state.timeOrigin, state.scrollX, state.scrollY, state.navs?.map(nav => [nav.open, nav.box])]);
    if (!valid || next !== signature) { signature = next; since = now(); samples = valid ? 1 : 0; } else samples++;
    if (valid && samples >= 3 && now() - since >= 160) return state;
    await wait(40);
  }
  throw new Error(`${label} did not settle: ${JSON.stringify(state)}`);
}

export async function verifyDirectoryPagination({ client, host, navigate, evaluate, capture, qaDir = 'qa-screenshots' }) {
  const evidence = { cases: [], errors: [] }; let current = 'setup', failure;
  const snapshot = () => evaluate(client, `(${directoryPaginationSnapshot.toString()})()`);
  const settled = (predicate, label) => waitForDirectoryPagination({ sample: snapshot, predicate, label });
  const key = (value, options) => directoryPaginationKey(client, value, options);
  const check = (state, expected, options) => {
    const issues = directoryPaginationViolations(state, expected, options);
    assert(issues.length === 0, `${current}: ${issues.join(', ')}`, state); return state;
  };
  const load = async (path, width, height, scripts = true) => {
    await client.call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 600, screenWidth: width, screenHeight: height });
    await navigate(client, 'about:blank');
    const before = await evaluate(client, 'performance.timeOrigin');
    const href = `${host}${path}`;
    await navigate(client, href);
    const state = await settled(s => directoryPaginationIdentity(s, { href, width, height, previousTimeOrigin: before })
      && (!scripts || s.initialized), 'Fresh directory document');
    const page = Number(path.match(/\/page\/(\d+)/)?.[1] || 1), total = state.navs[0].items.length;
    const expected = { href, width, height, page, total, timeOrigin: state.timeOrigin };
    check(state, expected);
    assert(state.staticRows.length > 0 && state.navs.every(nav => !nav.open), 'Fresh static listings and closed native pickers', state);
    if (!scripts) assert(!state.initialized && !state.search && !state.saved, 'JavaScript-disabled fixture executed the directory runtime', state);
    return expected;
  };
  // Wheel input reveals the rendered control; evaluation never changes scroll.
  const reveal = async (select, expected) => {
    let state;
    for (let attempt = 0; attempt < 8; attempt++) {
      state = await snapshot(); const target = select(state), r = target?.box;
      assert(directoryPaginationIdentity(state, expected) && target?.visible && r, 'Reveal requires the exact visible control', { state, target });
      const edge = target.inHeader ? 0 : state.headerBottom + 10;
      if (target.hit && r.top >= edge && r.bottom <= state.height - 10) return target;
      const top = Math.max(edge + 10, (state.height - r.height) / 2);
      await client.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: state.width / 2, y: state.height / 2, deltaX: 0, deltaY: r.top - top });
      await settled(s => directoryPaginationIdentity(s, expected), 'Native wheel reveal');
    }
    throw new Error(`Native wheel could not reveal control: ${JSON.stringify(state)}`);
  };
  const click = async (select, expected) => {
    const target = await reveal(select, expected), r = target.box;
    for (const type of ['mousePressed', 'mouseReleased']) await client.call('Input.dispatchMouseEvent', {
      type, x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, button: 'left', clickCount: 1
    });
  };
  const focused = (expected, nav, target) => settled(s => directoryPaginationViolations(s, expected, { focus: { nav, target } }).length === 0,
    `Visible native keyboard focus on picker ${nav}, target ${target}`);
  const exercise = async (expected, nav, record) => {
    // Top picker is reached with Tab alone. Bottom is revealed and opened with
    // a trusted pointer click, then independently exercises keyboard focus.
    if (nav === 0) {
      let reached = false;
      for (let attempt = 0; attempt < 100; attempt++) {
        await key('Tab'); const state = await snapshot();
        if (state.navs[0].summary.focused) { reached = true; break; }
      }
      assert(reached, 'Top picker missing from native Tab order');
      record.summary = await focused(expected, nav, 'summary');
      await key('Enter');
    } else {
      await click(s => s.navs[nav].summary, expected);
    }
    record.opened = await settled(s => directoryPaginationIdentity(s, expected) && s.navs[nav].open, 'Native details opening');
    check(record.opened, expected);
    // The first current-page span is omitted by native Tab order on page one.
    const firstLink = expected.page === 1 ? 2 : 1;
    await key('Tab'); record.firstLink = await focused(expected, nav, firstLink);
    await key('Tab', { shift: true }); record.returnedSummary = await focused(expected, nav, 'summary');
    record.cycles = [];
    for (const value of ['Enter', ' ']) {
      await key(value);
      const closed = await settled(s => directoryPaginationIdentity(s, expected) && !s.navs[nav].open, 'Native details collapse');
      check(closed, expected, { focus: { nav, target: 'summary' } });
      await key(value);
      const opened = await focused(expected, nav, 'summary');
      assert(opened.navs[nav].open, 'Native details did not reopen', opened);
      record.cycles.push({ key: value, closed, opened });
    }
    await capture(client, `directory-pagination-${current}-${nav ? 'bottom' : 'top'}.png`);
  };
  const follow = async (expected, select, { keyboard = false, nav = 0, page } = {}) => {
    const href = `${host}${pageHref(page)}`;
    if (keyboard) {
      let reached = false;
      for (let attempt = 0; attempt <= expected.total; attempt++) {
        const state = await snapshot();
        if (select(state)?.focused) { reached = true; break; }
        await key('Tab');
      }
      assert(reached, 'Requested page link missing from native Tab order');
      await focused(expected, nav, page); await key('Enter');
    } else await click(select, expected);
    const next = { ...expected, href, page, previousTimeOrigin: expected.timeOrigin }; delete next.timeOrigin;
    const state = await settled(s => directoryPaginationIdentity(s, next), 'Native link reached the exact new document');
    next.timeOrigin = state.timeOrigin; delete next.previousTimeOrigin;
    check(state, next);
    assert(state.staticRows.length > 0 && state.navs.every(item => !item.open), 'Destination must contain listings and closed pickers', state);
    return { expected: next, state };
  };
  const runCase = async (width, height, scripts) => {
    current = `${width}-${scripts ? 'scripts' : 'no-js'}`;
    let expected = await load('/directory', width, height, scripts);
    assert(expected.total >= 3, 'Pagination QA needs at least three real generated pages', expected);
    const record = { name: current, scripts, top: {}, bottom: {} }; evidence.cases.push(record);
    await exercise(expected, 0, record.top);
    const later = Math.min(3, expected.total);
    record.destination = await follow(expected, s => s.navs[0].items[later - 1], { keyboard: true, page: later });
    assert(JSON.stringify(record.destination.state.staticRows) !== JSON.stringify(record.top.opened.staticRows), 'Later page repeated the first page listings');
    expected = record.destination.expected;
    await exercise(expected, 1, record.bottom);
    record.firstPage = await follow(expected, s => s.navs[1].items[0], { keyboard: true, nav: 1, page: 1 });
    expected = record.firstPage.expected;
    record.next = await follow(expected, s => s.navs[0].next[0], { page: 2 });
    record.previous = await follow(record.next.expected, s => s.navs[0].previous[0], { page: 1 });
    expected = record.previous.expected;
    await click(s => s.navs[0].summary, expected);
    await settled(s => directoryPaginationIdentity(s, expected) && s.navs[0].open, 'Open picker before last-page link');
    record.lastPage = await follow(expected, s => s.navs[0].items.at(-1), { page: expected.total });
    await capture(client, `directory-pagination-${current}-last.png`);
    if (!scripts) assert(!record.lastPage.state.initialized, 'Destination unexpectedly executed JavaScript', record.lastPage.state);
    if (scripts) {
      expected = await load('/directory', width, height);
      await click(s => s.query, expected);
      await key('a', { control: true });
      await client.call('Input.insertText', { text: 'zzzz-pagination-no-match' });
      record.search = await settled(s => directoryPaginationIdentity(s, expected) && s.search && s.queryValue === 'zzzz-pagination-no-match'
        && s.count === 'No matching listings', 'Search hides both pagination landmarks');
      check(record.search, expected, { hidden: true });
      await key('Escape');
      record.cleared = await settled(s => directoryPaginationIdentity(s, expected) && !s.search && s.queryValue === '', 'Clearing search restores pagination');
      check(record.cleared, expected);
      const state = await snapshot();
      if (!state.savedLink) await click(s => s.menuSummary, expected);
      await settled(s => directoryPaginationIdentity(s, expected) && Boolean(s.savedLink), 'Native header Saved link');
      await click(s => s.savedLink, expected);
      const savedExpected = { ...expected, href: `${host}/directory#saved` };
      record.saved = await settled(s => directoryPaginationIdentity(s, savedExpected) && s.saved && s.savedVisible, 'Saved hides both pagination landmarks');
      check(record.saved, savedExpected, { hidden: true });
    }
    record.complete = true;
  };
  const onMessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') evidence.errors.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(message.params.type)) evidence.errors.push(message.params);
  };
  client.ws.addEventListener('message', onMessage);
  try {
    for (const [width, height] of DIRECTORY_PAGINATION_VIEWPORTS) await runCase(width, height, true);
    await withDirectoryScriptsDisabled(client, () => runCase(320, 844, false));
    assert(evidence.errors.length === 0, 'Pagination browser errors', evidence.errors);
  } catch (error) {
    failure = error; evidence.failure = { case: current, message: error.message, state: await snapshot().catch(() => null) };
    await capture(client, `directory-pagination-${current}-failure.png`).catch(() => {});
    throw error;
  } finally {
    client.ws.removeEventListener('message', onMessage);
    evidence.passed = !failure;
    await mkdir(qaDir, { recursive: true });
    await writeFile(join(qaDir, 'directory-pagination.json'), JSON.stringify(evidence, null, 2));
  }
  console.log('PASS directory pagination: 1440px/320px native keyboard and pointer navigation, both pickers, first/middle/last pages, search/Saved hiding, and JavaScript-disabled browsing.');
}
