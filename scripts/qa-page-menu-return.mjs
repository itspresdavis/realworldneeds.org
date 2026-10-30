import { PAGE_MENU_REFLOW_LINKS } from './qa-page-menu-reflow.mjs';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { newYorkCatalogFixtures } from './qa-catalog-expectations.mjs';
import { directorySavedBrowseHeaderPoint, isDirectoryStartupNavigationError } from './qa-directory-startup.mjs';

// CI-only native history regression. The ordinary QA server remains no-store.
// A separate origin forwards unchanged public bytes and adjusts Cache-Control
// only for the exact HTML fixtures below. No production behavior is replaced.
export const PAGE_MENU_LOCAL = '/directory/local/united-states/new-york/help/referral';
export const PAGE_MENU_SERVICE = '/service/new-york-public-library-access';
export const PAGE_MENU_VIEWPORTS = [
  { name: '390', width: 390, height: 844, mobile: true, deviceScaleFactor: 1 },
  { name: '320', width: 320, height: 780, mobile: true, deviceScaleFactor: 1 },
  // Equivalent CSS reflow to a 780 x 1000 viewport at 200% browser zoom;
  // Chrome's actual browser zoom setting is not changed by this emulation.
  { name: 'zoom-equivalent-200', width: 390, height: 500, mobile: false, deviceScaleFactor: 2 }
];
export const PAGE_MENU_SHORT_HEIGHT_LIMITATION = {
  excludedViewport: { width: 390, height: 422 },
  measuredMenuBottom: 426.671875,
  observedViewport: { width: 390, height: 844 },
  observedMenuOpen: false,
  source: 'CI 38200935924: page-menu-return.json, retained menu-link geometry in the Saved failure snapshot',
  note: 'Prior CI reported a last-link box bottom of 426.671875px, suggesting clipping risk at a 422px height. That shorter viewport was not rendered in this observation. This suite uses a 500px-high zoom-equivalent viewport; it does not verify 422px-height coverage or change existing menu CSS.'
};
const fixturePaths = new Set([PAGE_MENU_LOCAL, PAGE_MENU_SERVICE, '/directory', '/editorial-policy', '/sources', '/transparency', '/join']);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const assert = (ok, label, detail) => { if (!ok) throw new Error(`${label}: ${JSON.stringify(detail)}`); };

export function pageMenuFixtureCacheControl(pathname, status, contentType, original) {
  return status === 200 && fixturePaths.has(pathname) && /^text\/html(?:;|$)/i.test(contentType || '')
    ? 'private, max-age=0, must-revalidate' : original;
}

async function startFixtureProxy(upstream) {
  const responses = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', 'http://127.0.0.1');
      if (!['GET', 'HEAD'].includes(request.method) || /^\/(?:api(?:\/|$)|workspace(?:\/|$))/.test(url.pathname)) {
        response.writeHead(405); response.end(); return;
      }
      const result = await fetch(new URL(url.pathname + url.search, upstream), { method: request.method, redirect: 'manual', signal: AbortSignal.timeout(8000) });
      const headers = Object.fromEntries(result.headers);
      for (const key of ['connection', 'keep-alive', 'transfer-encoding', 'content-encoding']) delete headers[key];
      const cache = pageMenuFixtureCacheControl(url.pathname, result.status, headers['content-type'], headers['cache-control']);
      if (cache !== undefined) headers['cache-control'] = cache;
      const bytes = Buffer.from(await result.arrayBuffer());
      if (request.method !== 'HEAD') headers['content-length'] = String(bytes.length);
      if (fixturePaths.has(url.pathname)) responses.push({ path: url.pathname, status: result.status, upstreamCache: result.headers.get('cache-control'), cache });
      response.writeHead(result.status, headers); response.end(bytes);
    } catch (error) { response.writeHead(502, { 'Content-Type': 'text/plain' }); response.end(`QA fixture proxy: ${error.message}`); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { host: `http://127.0.0.1:${server.address().port}`, responses,
    close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}

export function observePageMenuReturn(origin, binding) {
  if (location.origin !== origin) return;
  const probe = globalThis.__rwnPageMenuQA = { shows: [], hides: [], inputs: [] };
  const report = value => { if (typeof globalThis[binding] === 'function') globalThis[binding](JSON.stringify(value)); };
  for (const type of ['pageshow', 'pagehide']) window.addEventListener(type, event => {
    const value = { type, persisted: event.persisted, trusted: event.isTrusted, href: location.href,
      timeOrigin: performance.timeOrigin, menuOpen: Boolean(document.querySelector('.rwn-page-menu[open]')), scroll: scrollY };
    probe[type === 'pageshow' ? 'shows' : 'hides'].push(value); report(value);
  });
  document.addEventListener('input', event => {
    if (event.target.matches?.('[data-directory-query]')) probe.inputs.push({ value: event.target.value, trusted: event.isTrusted });
  }, true);
  for (const type of ['mousedown', 'mouseup', 'click']) document.addEventListener(type, event => {
    const selector = globalThis.__rwnPageMenuExpectedClick;
    if (!selector) return;
    const node = document.querySelector(selector);
    report({ type, selector, trusted: event.isTrusted, expected: Boolean(node && (event.target === node || node.contains(event.target))),
      href: location.href, targetHref: event.target.closest?.('a')?.getAttribute('href') || null, scroll: scrollY });
  }, true);
}

// This exact function is serialized into Chrome and unit-tested with partial
// DOMs. The probe observes browser events; it never dispatches pageshow itself.
export function pageMenuReturnSnapshot() {
  const document = globalThis.document;
  const pick = selector => document?.querySelector(selector);
  const all = selector => [...(document?.querySelectorAll(selector) || [])];
  const box = node => { const r = node?.getBoundingClientRect(); return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null; };
  const visible = node => {
    if (!node) return false;
    const r = node.getBoundingClientRect(), style = getComputedStyle(node);
    if (!(r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight)
      || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return Boolean(hit && (hit === node || node.contains(hit)));
  };
  const active = document?.activeElement, summary = pick('.rwn-page-menu > summary'), input = pick('[data-directory-query]');
  const style = active ? getComputedStyle(active) : null;
  const rect = active?.getBoundingClientRect();
  const header = pick('.legal-header');
  const inHeader = Boolean(active && header?.contains(active));
  const useful = Boolean(active?.matches('a[href], button, input, select, summary, [tabindex="-1"]') && active !== document?.body);
  const focusVisible = useful && visible(active) && (inHeader || rect.top >= (header?.getBoundingClientRect().bottom || 0) + 1);
  const rows = selector => all(selector).map(node => ({ href: node.getAttribute('href'), text: node.textContent.trim() }));
  const panel = pick('[data-saved-services]');
  return {
    documentPresent: Boolean(document?.documentElement && document.body),
    ready: Boolean(document?.documentElement && document.body && pick('h1') && summary && (!input || pick('.directory-global-results'))),
    href: globalThis.location?.href || '', path: globalThis.location?.pathname || '', title: document?.title || '', heading: pick('h1')?.textContent || '',
    timeOrigin: globalThis.performance?.timeOrigin ?? null, navigationType: globalThis.performance?.getEntriesByType?.('navigation')[0]?.type || '',
    viewport: { width: globalThis.innerWidth ?? null, height: globalThis.innerHeight ?? null },
    menuOpen: Boolean(pick('.rwn-page-menu[open]')), summaryVisible: visible(summary), summaryBox: box(summary),
    menuLinks: all('.rwn-page-menu nav a').map(node => ({ href: node.getAttribute('href'), visible: visible(node), box: box(node) })),
    focus: { tag: active?.tagName || '', href: active?.getAttribute('href') || '', id: active?.id || '', summary: Boolean(active && active === summary),
      inMenu: Boolean(active && pick('.rwn-page-menu nav')?.contains(active)), visible: Boolean(focusVisible), box: box(active),
      keyboardRing: Boolean(focusVisible && active.matches(':focus-visible') && style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) },
    query: input?.value, country: pick('[data-directory-country]')?.value, category: pick('[data-directory-category][aria-pressed="true"]')?.dataset.directoryCategory,
    count: pick('[data-directory-count]')?.textContent, summary: pick('[data-global-summary]')?.textContent,
    rows: rows('.directory-global-result'), staticRows: rows('.directory-records h2 a'),
    filtered: Boolean(pick('.directory-shell.has-global-search')), resultsHidden: pick('.directory-global-results')?.hidden,
    more: Boolean(pick('[data-directory-more]') && !pick('[data-directory-more]').hidden),
    empty: pick('.directory-global-empty')?.textContent, history: globalThis.history?.state?.rwnDirectory,
    saved: Boolean(pick('.directory-shell.has-saved-view')), panelVisible: Boolean(panel?.getBoundingClientRect().height),
    scroll: globalThis.scrollY ?? null, documentHeight: document?.documentElement?.scrollHeight ?? null,
    overflow: document?.documentElement ? document.documentElement.scrollWidth - globalThis.innerWidth : null,
    overlay: Boolean(pick('vite-error-overlay, nextjs-portal, #webpack-dev-server-client-overlay')),
    probe: globalThis.__rwnPageMenuQA || null
  };
}

export function pageMenuRetainedState(actual, source, { requireHistory = true } = {}) {
  const keys = ['href', 'path', 'query', 'country', 'category', 'count', 'summary', 'filtered', 'resultsHidden', 'more', 'empty'];
  if (!actual.ready || keys.some(key => actual[key] !== source[key])
    || JSON.stringify(actual.rows) !== JSON.stringify(source.rows) || JSON.stringify(actual.staticRows) !== JSON.stringify(source.staticRows)) return false;
  if (source.query === undefined || !requireHistory && !source.history && !actual.history) return true;
  const expected = { path: source.path, query: source.query, country: source.country || '', category: (source.category || '').toLowerCase() };
  const shown = source.history?.shown ?? source.rows.length;
  // Unfiltered restore normalizes the saved batch capacity to at least 60,
  // while retaining zero live rows and the exact static cards. This is not
  // a displayed-row count; filtered/search batches remain exact.
  const sameShown = actual.history?.shown === shown || requireHistory && !source.filtered && source.rows.length === 0
    && actual.history?.shown === Math.max(60, Math.min(shown, 6000));
  return sameShown && Object.entries(expected).every(([key, value]) => actual.history?.[key] === value);
}

export function pageMenuReturnedFromBFCache(actual, source) {
  const show = actual.probe?.shows?.at(-1), hide = actual.probe?.hides?.at(-1);
  return Boolean(actual.documentPresent && Number.isFinite(actual.timeOrigin) && actual.timeOrigin === source.timeOrigin
    && actual.probe?.shows?.length === source.probe?.shows?.length + 1 && actual.probe?.hides?.length === source.probe?.hides?.length + 1
    && show?.persisted === true && show.trusted === true && show.href === source.href && show.timeOrigin === source.timeOrigin
    && hide?.persisted === true && hide.trusted === true && hide.href === source.href && hide.timeOrigin === source.timeOrigin);
}

const validNativeHistory = snapshot => Boolean(Array.isArray(snapshot?.entries) && Number.isInteger(snapshot.index)
  && snapshot.index >= 0 && snapshot.index < snapshot.entries.length
  && snapshot.entries.every(entry => Number.isInteger(entry?.id) && typeof entry.url === 'string' && entry.url.length > 0)
  && new Set(snapshot.entries.map(entry => entry.id)).size === snapshot.entries.length
  && snapshot.entry?.id === snapshot.entries[snapshot.index].id && snapshot.entry?.url === snapshot.entries[snapshot.index].url);

export function pageMenuNativeEntryWasAdded(source, destination, destinationUrl) {
  if (!validNativeHistory(source) || !validNativeHistory(destination)) return false;
  const preceding = destination.entries[destination.index - 1];
  // Chrome drops its oldest entry at the history cap, so a real new navigation
  // can leave currentIndex unchanged. Verify exact adjacent identities in the
  // post-navigation snapshot instead of comparing absolute array positions.
  return destination.index === destination.entries.length - 1 && preceding?.id === source.entry.id
    && preceding.url === source.entry.url && destination.entry.url === destinationUrl
    && destination.entry.id !== source.entry.id && !source.entries.some(entry => entry.id === destination.entry.id);
}

export function pageMenuFreshDocument(actual, previousTimeOrigin) {
  const shows = actual.probe?.shows;
  return Boolean(actual.documentPresent && actual.ready && Number.isFinite(actual.timeOrigin) && actual.timeOrigin !== previousTimeOrigin
    && shows?.length === 1 && shows[0].persisted === false && shows[0].trusted === true && shows[0].timeOrigin === actual.timeOrigin
    && shows[0].href === actual.href && actual.probe?.hides?.length === 0);
}

// Reload is tested from a real committed reading position. Native Tab may
// intentionally scroll the next control into view without updating history;
// that live focus movement is not a new committed reload baseline.
export function pageMenuReloadSourceReady(actual, source) {
  return Boolean(actual.documentPresent && Number.isFinite(actual.timeOrigin) && actual.timeOrigin === source.timeOrigin
    && pageMenuRetainedState(actual, source) && Number.isFinite(actual.scroll) && Number.isFinite(actual.history?.scroll)
    && actual.scroll === actual.history.scroll && actual.scroll === source.scroll && source.history?.scroll === source.scroll
    && !actual.menuOpen && !actual.saved && !actual.panelVisible && actual.focus?.visible && !actual.focus.inMenu);
}

export function pageMenuReloadRestored(actual, source) {
  return Boolean(pageMenuFreshDocument(actual, source.timeOrigin) && actual.navigationType === 'reload'
    && pageMenuRetainedState(actual, source) && Number.isFinite(source.scroll) && source.history?.scroll === source.scroll
    && actual.scroll === source.scroll && actual.history?.scroll === source.scroll
    && !actual.menuOpen && !actual.saved && !actual.panelVisible && actual.focus?.visible && !actual.focus.inMenu);
}

// Secondary history cycles may legitimately rebuild an evicted document.
// Classify that separately; each primary Back above remains BFCache-only.
export function pageMenuHistoryTraversalClassification(actual, previous, expectedEntry) {
  if (!actual?.ready || !Number.isFinite(previous?.timeOrigin) || !validNativeHistory(actual.nativeHistory)
    || actual.nativeHistory.entry.id !== expectedEntry?.id || actual.nativeHistory.entry.url !== expectedEntry?.url
    || actual.href !== expectedEntry.url || actual.href !== previous.href || actual.path !== previous.path
    || actual.menuOpen || !actual.focus?.visible || actual.focus.inMenu) return null;
  let saved;
  try { saved = new URL(expectedEntry.url).hash === '#saved'; } catch { return null; }
  if (saved ? !(actual.saved && actual.panelVisible && actual.focus.id === 'saved-services-heading') : actual.saved || actual.panelVisible) return null;
  if (pageMenuReturnedFromBFCache(actual, previous)) return 'persisted';
  if (actual.navigationType === 'back_forward' && pageMenuFreshDocument(actual, previous.timeOrigin)) return 'fresh-history';
  return null;
}

export async function waitForPageMenuSettled({ sample, predicate, label = 'Page menu return', timeoutMs = 8000,
  quietMs = 500, wait = sleep, now = () => performance.now() }) {
  const started = now(); let anchor, since = started, count = 0, latest;
  const trace = [];
  const failure = () => new Error(`${label} did not settle: ${JSON.stringify({ latest, trace })}`);
  while (now() - started < timeoutMs) {
    let deadline;
    try {
      latest = await Promise.race([sample(), new Promise((_, reject) => { deadline = setTimeout(() => reject(failure()), Math.max(1, timeoutMs - (now() - started))); })]);
    } catch (error) {
      if (!isDirectoryStartupNavigationError(error)) throw error;
      latest = { documentPresent: false };
    } finally { clearTimeout(deadline); }
    const valid = latest.documentPresent && latest.ready && Number.isFinite(latest.timeOrigin) && Number.isFinite(latest.scroll)
      && Number.isFinite(latest.overflow) && latest.overflow <= 1 && !latest.overlay && predicate(latest);
    const signature = JSON.stringify([latest.href, latest.timeOrigin, latest.query, latest.category, latest.count, latest.rows,
      latest.staticRows, latest.menuOpen, latest.focus, latest.saved, latest.probe?.shows, latest.probe?.hides]);
    const same = valid && anchor && signature === anchor.signature && Math.abs(latest.scroll - anchor.scroll) <= .5;
    if (!same) { anchor = valid ? { signature, scroll: latest.scroll } : null; since = now(); count = valid ? 1 : 0; }
    else count++;
    trace.push({ at: now() - started, valid: Boolean(valid), path: latest.path, timeOrigin: latest.timeOrigin, scroll: latest.scroll,
      menuOpen: latest.menuOpen, focus: latest.focus, shows: latest.probe?.shows });
    if (trace.length > 20) trace.shift();
    if (count >= 6 && now() - since >= quietMs && now() - started < timeoutMs) return { state: latest, durationMs: now() - started, samples: count };
    await wait(50);
  }
  throw failure();
}

// Cleanup must attempt every step, including closing its socket, even after a
// browser disconnect. Bounded operations cannot hide the original QA failure.
const bounded = async (task, timeoutMs) => {
  let timer;
  try { return await Promise.race([Promise.resolve().then(task), new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
  })]); } finally { clearTimeout(timer); }
};

export async function cleanupPageMenuQA(steps, { timeoutMs = 1800 } = {}) {
  const errors = [];
  for (const [name, task] of steps) {
    try { await bounded(task, timeoutMs); }
    catch (error) { errors.push({ name, error: error.message }); }
  }
  return errors;
}

export async function pageMenuWorkerReady() {
  if (!navigator.serviceWorker) throw new Error('BFCache fixture requires its real service-worker lifecycle');
  const started = performance.now();
  let timer;
  try {
    const registration = await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Real fixture service worker did not activate within 8000ms')), 8000);
    })]);
    while (performance.now() - started < 8000) {
      const controller = navigator.serviceWorker.controller;
      if (!registration.installing && !registration.waiting && registration.active?.state === 'activated' && controller?.state === 'activated') {
        return { active: registration.active.scriptURL, controller: controller.scriptURL, state: controller.state, durationMs: performance.now() - started };
      }
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error('Real fixture service worker did not finish claiming this document within 8000ms');
  } finally { clearTimeout(timer); }
}

export async function verifyPageMenuReturn({ client, host, navigate, evaluate, capture }) {
  const expectedLocalHrefs = newYorkCatalogFixtures().referral.map(id => `/service/${encodeURIComponent(id)}`).sort();
  assert(expectedLocalHrefs.includes(PAGE_MENU_SERVICE), 'Known library fixture is missing from reviewed local source membership', expectedLocalHrefs);
  const fixture = await startFixtureProxy(host), origin = fixture.host;
  const binding = '__rwnPageMenuReturnReport';
  const evidence = [], events = [], errors = [], notRestored = [];
  let instrumentation, currentCase, worker, failure;
  const onMessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.bindingCalled' && message.params.name === binding) events.push(JSON.parse(message.params.payload));
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.consoleAPICalled' && ['error', 'assert'].includes(message.params.type)) errors.push({ type: message.params.type, args: message.params.args });
    if (message.method === 'Page.backForwardCacheNotUsed') notRestored.push(message.params);
  };
  const snapshot = () => evaluate(client, `(${pageMenuReturnSnapshot.toString()})()`);
  const settled = async (predicate, label, sample = snapshot) => (await waitForPageMenuSettled({ sample, predicate, label })).state;
  const nativeClick = async (selector, header = true) => {
    const start = events.length;
    const point = await evaluate(client, `(async () => {
      globalThis.__rwnPageMenuExpectedClick = ${JSON.stringify(selector)};
      ${header ? '' : `document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({ block: 'center', behavior: 'instant' });`}
      return (${directorySavedBrowseHeaderPoint.toString()})(${JSON.stringify(selector)});
    })()`);
    await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    let delivered;
    for (let attempt = 0; attempt < 80; attempt++) {
      delivered = events.slice(start).filter(item => item.selector === selector);
      if (delivered.length >= 3) break;
      await sleep(25);
    }
    assert(delivered.length === 3 && ['mousedown', 'mouseup', 'click'].every((type, index) => delivered[index].type === type && delivered[index].trusted && delivered[index].expected),
      'Native page-menu click missed its rendered target', { selector, point, delivered });
    return { selector, point, events: delivered };
  };
  const type = async query => {
    await nativeClick('[data-directory-query]', false);
    await client.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await client.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
    await client.call('Input.insertText', { text: query });
  };
  const entry = async () => { const history = await client.call('Page.getNavigationHistory'); return { entry: history.entries[history.currentIndex], index: history.currentIndex, entries: history.entries }; };
  const historySnapshot = async () => ({ ...await snapshot(), nativeHistory: await entry() });
  const open = async path => {
    const before = (await snapshot()).timeOrigin;
    await navigate(client, 'about:blank');
    await navigate(client, `${origin}${path}`);
    return settled(s => s.path === path && pageMenuFreshDocument(s, before) && !s.menuOpen && s.summaryVisible, 'Fresh fixture document and closed navigation');
  };
  const roundTrip = async ({ path, target, query, name, repeat = false }) => {
    currentCase = name;
    let source = await open(path);
    if (!worker) {
      worker = await evaluate(client, `(${pageMenuWorkerReady.toString()})()`);
      source = await settled(s => s.path === path && pageMenuFreshDocument(s, null) && !s.menuOpen && s.summaryVisible,
        'Fresh fixture remains stable after real worker activation and controllerchange');
    }
    if (query) {
      await type(query);
      source = await settled(s => s.path === path && s.query === query && s.history?.query === query
        && s.category === '' && s.history?.category === '' && s.filtered
        && (query === 'library' ? s.count === '1 matching listing' && s.rows.length === 1 && s.rows[0].href === PAGE_MENU_SERVICE
          : s.count === 'No matching listings' && s.rows.length === 0 && s.empty?.includes('does not mean help is unavailable')),
      'Exact local query and scoped result commitment');
      assert(source.probe.inputs.some(input => input.value === query && input.trusted), 'Local query was not entered with trusted input', source.probe.inputs);
    } else if (path === PAGE_MENU_LOCAL) {
      assert(source.query === '' && !source.filtered && source.rows.length === 0
        && JSON.stringify(source.staticRows.map(row => row.href).sort()) === JSON.stringify(expectedLocalHrefs)
        && source.count === `${expectedLocalHrefs.length.toLocaleString('en-US')} listings on this page`,
      'Default local browse disagrees with reviewed source membership', source);
    }
    // Only prepare a meaningful, nonzero reading position. No query, result,
    // history, focus or menu state is synthesized by this preparation.
    await evaluate(client, "window.scrollTo({ top: Math.min(240, Math.max(0, document.documentElement.scrollHeight - innerHeight)), behavior: 'instant' })");
    source = await settled(s => s.path === path && !s.menuOpen && s.scroll > 0 && s.summaryVisible, 'Stable scrolled source');
    assert(!new URL(source.href).search && !new URL(source.href).hash, 'Local query escaped into URL', source.href);
    const sourceEntry = await entry();
    const openedBy = await nativeClick('.rwn-page-menu > summary');
    const opened = await settled(s => s.path === path && s.menuOpen && s.menuLinks.length === PAGE_MENU_REFLOW_LINKS.length && s.menuLinks.every(link => link.visible && link.box.height >= 44)
      && Math.abs(s.scroll - source.scroll) <= 1 && pageMenuRetainedState(s, source, { requireHistory: false }), 'Menu remains usable before real navigation');
    await capture(client, `page-menu-${name}-opened.png`);
    const leftBy = await nativeClick(target === "/directory#saved" ? ".rwn-saved-link" : `.rwn-page-menu a[href="${target}"]`);
    const destinationUrl = new URL(target, origin).href;
    const destination = await settled(s => s.href === destinationUrl && pageMenuFreshDocument(s, source.timeOrigin) && !s.menuOpen
      && (target !== '/directory#saved' || s.saved && s.panelVisible), 'Native menu link destination');
    const destinationEntry = await entry();
    assert(pageMenuNativeEntryWasAdded(sourceEntry, destinationEntry, destinationUrl),
      'Menu link did not add one new native entry adjacent to its exact source', { sourceEntry, destinationEntry });
    await client.call('Page.navigateToHistoryEntry', { entryId: sourceEntry.entry.id });
    let returned = await settled(s => pageMenuReturnedFromBFCache(s, source) && pageMenuRetainedState(s, source)
      && !s.menuOpen && !s.saved && !s.panelVisible && s.focus.visible && !s.focus.inMenu && Math.abs(s.scroll - source.scroll) <= 1,
    'Actual persisted Back must close the menu and retain query, exact rows, scroll and visible focus');
    assert(returned.probe.hides.at(-1).menuOpen, 'The real source must enter BFCache with its menu open', returned.probe);
    const primaryBackEntry = await entry();
    assert(primaryBackEntry.entry.id === sourceEntry.entry.id && primaryBackEntry.entry.url === sourceEntry.entry.url,
      'Back returned to the wrong history entry', primaryBackEntry);
    const repeated = [];
    // Publish the passed primary proof before any later cycle can fail. The
    // artifact must retain real progress as well as the final failure state.
    const record = { name, phase: 'primary-back-verified', source, opened, openedBy, leftBy, sourceEntry, destinationEntry,
      destination, primaryBackClassification: 'persisted', primaryBackEntry, back: returned, repeated };
    evidence.push(record);
    await capture(client, `page-menu-${name}-back.png`);
    if (repeat) for (let iteration = 0; iteration < 2; iteration++) {
      const previousReturn = returned;
      const previousDestination = iteration ? repeated.at(-1).forward : destination;
      const cycle = { iteration: iteration + 1 };
      repeated.push(cycle);
      record.phase = `secondary-forward-${iteration + 1}`;
      await client.call('Page.navigateToHistoryEntry', { entryId: destinationEntry.entry.id });
      const forward = await settled(s => pageMenuHistoryTraversalClassification(s, previousDestination, destinationEntry.entry) !== null,
        'Repeated Forward requires an explicitly classified native history destination', historySnapshot);
      cycle.forward = forward;
      cycle.forwardClassification = pageMenuHistoryTraversalClassification(forward, previousDestination, destinationEntry.entry);
      record.phase = `secondary-back-${iteration + 1}`;
      await client.call('Page.navigateToHistoryEntry', { entryId: sourceEntry.entry.id });
      returned = await settled(s => pageMenuHistoryTraversalClassification(s, previousReturn, sourceEntry.entry) !== null
        && pageMenuRetainedState(s, source) && Math.abs(s.scroll - source.scroll) <= 1,
        'Repeated native Back must retain exact source state and classified lifecycle evidence', historySnapshot);
      cycle.back = returned;
      cycle.backClassification = pageMenuHistoryTraversalClassification(returned, previousReturn, sourceEntry.entry);
    }
    record.finalBack = returned;
    let keyboardSource = returned;
    if (repeat) {
      record.phase = 'reload-source';
      record.reloadSource = await settled(s => pageMenuReloadSourceReady(s, returned),
        'Reload source must retain the exact committed state with matching live and saved scroll');
      record.phase = 'reload';
      await client.call('Page.reload', { ignoreCache: true });
      record.reload = await settled(s => pageMenuReloadRestored(s, record.reloadSource),
        'Fresh reload must retain exact committed state and scroll without pretending to be BFCache');
      await capture(client, `page-menu-${name}-reload.png`);
      keyboardSource = record.reload;
    }
    record.phase = 'keyboard';
    record.keyboardAfter = repeat ? 'fresh-reload' : 'persisted-back';
    // Repeated library cases independently check keyboard access after reload.
    // Every non-repeat case still checks Tab directly after the strict BFCache
    // Back. Neither check lets Tab's intentional scroll redefine saved history.
    await client.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await client.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    record.keyboard = await settled(s => s.timeOrigin === keyboardSource.timeOrigin && pageMenuRetainedState(s, source)
      && !s.menuOpen && s.focus.visible && !s.focus.inMenu && s.focus.keyboardRing,
      'Visible native keyboard focus after the explicitly recorded lifecycle check');
    await capture(client, `page-menu-${name}-keyboard.png`);
    record.phase = 'complete';
  };
  client.ws.addEventListener('message', onMessage);
  try {
    await client.call('Network.enable');
    await client.call('Network.setBypassServiceWorker', { bypass: true });
    await client.call('Runtime.addBinding', { name: binding });
    instrumentation = await client.call('Page.addScriptToEvaluateOnNewDocument', { source: `(${observePageMenuReturn.toString()})(${JSON.stringify(origin)}, ${JSON.stringify(binding)})` });
    for (const viewport of PAGE_MENU_VIEWPORTS) {
      const { name, ...metrics } = viewport;
      await client.call('Emulation.setDeviceMetricsOverride', { ...metrics, screenWidth: metrics.width, screenHeight: metrics.height });
      await roundTrip({ path: PAGE_MENU_LOCAL, target: '/directory#saved', query: 'library', name: `${name}-library`, repeat: true });
      await roundTrip({ path: PAGE_MENU_LOCAL, target: '/directory#saved', query: '', name: `${name}-default` });
      await roundTrip({ path: PAGE_MENU_LOCAL, target: '/directory#saved', query: 'zzzz-no-local-service-here', name: `${name}-empty` });
      await roundTrip({ path: PAGE_MENU_LOCAL, target: '/sources', query: 'library', name: `${name}-library-menu-sources` });
      await roundTrip({ path: PAGE_MENU_SERVICE, target: '/sources', name: `${name}-service-sources` });
      await roundTrip({ path: '/editorial-policy', target: '/join', name: `${name}-trust-contribute` });
    }
    assert(errors.length === 0, 'Page-menu QA observed browser runtime errors', errors);
    assert(fixture.responses.some(response => response.upstreamCache === 'no-store' && response.cache === 'private, max-age=0, must-revalidate'),
      'Separate BFCache fixture did not preserve and explicitly override the ordinary no-store server', fixture.responses);
  } catch (error) {
    failure = error;
    evidence.push({ name: currentCase, error: error.message, state: await bounded(snapshot, 1800).catch(() => null) });
    await bounded(() => capture(client, `page-menu-${currentCase || 'setup'}-failure.png`), 1800).catch(() => {});
    throw error;
  } finally {
    let cleanupErrors = [];
    try {
      cleanupErrors = await cleanupPageMenuQA([
        ['remove document observer', () => instrumentation && client.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: instrumentation.identifier })],
        ['remove event binding', () => client.call('Runtime.removeBinding', { name: binding })],
        ['restore normal service-worker routing', () => client.call('Network.setBypassServiceWorker', { bypass: false })],
        ['leave fixture document', () => client.call('Page.navigate', { url: 'about:blank' })]
      ]);
    } finally {
      client.ws.removeEventListener('message', onMessage);
      cleanupErrors.push(...await cleanupPageMenuQA([['close separate fixture server', () => fixture.close()]]));
      cleanupErrors.push(...await cleanupPageMenuQA([['write QA evidence', async () => {
        await mkdir('qa-screenshots', { recursive: true });
        await writeFile('qa-screenshots/page-menu-return.json', JSON.stringify({ evidence, viewports: PAGE_MENU_VIEWPORTS, shortHeightLimitation: PAGE_MENU_SHORT_HEIGHT_LIMITATION, worker, responses: fixture.responses, errors, notRestored, cleanupErrors }, null, 2));
      }]]));
    }
    if (!failure && cleanupErrors.length) throw new Error(`Page-menu QA cleanup failed: ${JSON.stringify(cleanupErrors)}`);
  }
  console.log(`PASS page-menu history: ${evidence.length} primary native persisted Back cases, explicitly classified secondary Forward/Back, new-document reload, keyboard focus, exact local states and 390/320/200%-equivalent reflow.`);
}
