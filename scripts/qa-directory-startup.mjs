import { selectDirectoryNeed } from "./qa-directory-need.mjs";
import { mkdir, writeFile } from "node:fs/promises";

// CI-only regression: hold the real entry module at the network boundary, type
// into the static form, then release it without synthesizing another input.
// No application delay, replacement module, or browser launch belongs here.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const QUERY = 'Drinking fountains for London';
const IME_CANDIDATE = 'Drinking fountains for Lon';
const FINDER = '/service/london-drinking-fountains';
const assert = (condition, label, detail) => {
  if (!condition) throw new Error(`${label}: ${JSON.stringify(detail)}`);
};

function observeStartup(origin) {
  if (location.origin !== origin) return;
  const probe = window.__rwnDirectoryStartupQA = { inputs: [], compositions: [], catalogReads: 0, catalogSettled: 0 };
  document.addEventListener('input', event => {
    if (!event.target.matches?.('[data-directory-query]')) return;
    probe.inputs.push({ value: event.target.value, composing: event.isComposing, trusted: event.isTrusted, runtime: Boolean(document.querySelector('.directory-global-results')) });
  }, true);
  for (const type of ['compositionstart', 'compositionupdate', 'compositionend']) document.addEventListener(type, event => {
    if (event.target.matches?.('[data-directory-query]')) probe.compositions.push({ type, data: event.data, value: event.target.value, trusted: event.isTrusted, runtime: Boolean(document.querySelector('.directory-global-results')) });
  }, true);
  // Observe completion of the actual JSON read, including a discarded stale
  // response. A DOM-only empty-state wait could pass before that response lands.
  const fetch = window.fetch.bind(window);
  window.fetch = (...args) => {
    const url = new URL(args[0] instanceof Request ? args[0].url : args[0], location.href);
    if (url.origin !== origin || url.pathname !== '/data/search-index.json') return fetch(...args);
    probe.catalogReads++;
    return fetch(...args).then(response => {
      const json = response.json.bind(response);
      response.json = async () => {
        try { return await json(); }
        finally { probe.catalogSettled++; }
      };
      return response;
    });
  };
}

// Serialize this exact function into the page and exercise it in unit tests.
// Page.navigate can expose a provisional document with no documentElement.
export function directoryStartupSnapshot() {
  const document = globalThis.document;
  const pick = selector => document?.querySelector(selector);
  const input = pick('[data-directory-query]');
  const results = pick('.directory-global-results');
  const category = pick('[data-directory-category][aria-pressed="true"]');
  const country = pick('[data-directory-country]');
  const rect = input?.getBoundingClientRect();
  const href = globalThis.location?.href || '';
  let pathname = '';
  try { pathname = new URL(href).pathname; } catch { /* Provisional or absent location is not ready. */ }
  const snapshot = storage => Object.fromEntries(Object.keys(storage).sort().map(key => [key, storage.getItem(key)]));
  return {
    viewport: { width: globalThis.innerWidth ?? null, height: globalThis.innerHeight ?? null },
    href, pathname, title: document?.title || '', timeOrigin: globalThis.performance?.timeOrigin ?? null,
    documentPresent: Boolean(document?.documentElement),
    ready: Boolean(document?.documentElement && results && category),
    query: input?.value, disabled: input?.disabled, countryDisabled: country?.disabled,
    inputVisible: Boolean(rect?.width && rect?.height),
    focusedInput: Boolean(input && document?.activeElement === input), focusedHref: document?.activeElement?.getAttribute('href'),
    focusedBrand: Boolean(document?.activeElement && document.activeElement === pick('.legal-header .legal-brand[href="/"]')),
    selection: input ? [input.selectionStart, input.selectionEnd] : null,
    country: country?.value, category: category?.textContent,
    rows: [...(document?.querySelectorAll('.directory-global-result') || [])].map(row => ({ href: row.getAttribute('href'), text: row.textContent })),
    resultsHidden: results?.hidden, clearHidden: pick('[data-directory-clear]')?.hidden,
    count: pick('[data-directory-count]')?.textContent,
    history: globalThis.history?.state?.rwnDirectory, scroll: globalThis.scrollY ?? null,
    probe: globalThis.__rwnDirectoryStartupQA || null,
    click: globalThis.__rwnDirectoryClickQA ? { selector: globalThis.__rwnDirectoryClickQA.selector, point: globalThis.__rwnDirectoryClickQA.point, events: globalThis.__rwnDirectoryClickQA.events } : null,
    storage: input ? { local: snapshot(globalThis.localStorage), session: snapshot(globalThis.sessionStorage) } : null,
    overflow: document?.documentElement ? document.documentElement.scrollWidth - globalThis.innerWidth : null,
    overlay: Boolean(pick('vite-error-overlay, nextjs-portal, #webpack-dev-server-client-overlay'))
  };
}

export const directoryStartupStaticReady = (snapshot, previousTimeOrigin, moduleHeld) => Boolean(
  snapshot.documentPresent && Number.isFinite(snapshot.timeOrigin) && snapshot.timeOrigin !== previousTimeOrigin
  && snapshot.pathname === '/directory' && snapshot.inputVisible && snapshot.probe && moduleHeld > 0
);

export const isDirectoryStartupNavigationError = error => /^(?:Runtime\.evaluate: )?(?:Execution context was destroyed|Cannot find (?:default execution )?context|No execution context|Inspected target navigated)/i.test(error?.message || '');

// The desktop Directory nav link is hidden at narrow widths. The brand is
// outside both responsive navs; verify rendered visibility and actual focus
// before using it as the pre-runtime blur witness.
export function focusDirectoryStartupBlurTarget() {
  const selector = '.legal-header .legal-brand[href="/"]';
  const link = document.querySelector(selector);
  if (!link) throw new Error('Startup blur brand link is missing');
  const rect = link.getBoundingClientRect(), style = getComputedStyle(link);
  const visible = rect.width > 0 && rect.height > 0 && rect.top >= 0 && rect.left >= 0
    && rect.bottom <= innerHeight && rect.right <= innerWidth
    && style.display !== 'none' && !['hidden', 'collapse'].includes(style.visibility);
  if (!visible) throw new Error(`Startup blur brand link is not visible: ${JSON.stringify({ width: innerWidth, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, display: style.display, visibility: style.visibility })}`);
  link.focus({ preventScroll: true });
  if (document.activeElement !== link) throw new Error('Startup blur brand link did not receive focus');
  return { selector, href: link.getAttribute('href'), focused: true, visible };
}

export async function directoryStartupClickPoint(selector) {
  let target = document.querySelector(selector);
  if (!target || target.hidden || target.disabled) throw new Error('Missing enabled control: ' + selector);
  globalThis.__rwnDirectoryClickQA?.stop();
  target.scrollIntoView({ block: 'center', behavior: 'instant' });
  let previous, last;
  // scrollIntoView and scroll anchoring can settle on later rendering frames.
  // Take coordinates only after the same node/box/scroll is stable across two
  // frames. This prepares one native action; it never retries a delivered click.
  for (let frame = 0; frame < 60; frame++) {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const node = document.querySelector(selector);
    if (!node || node.hidden || node.disabled) throw new Error('Missing enabled control: ' + selector);
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    const point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    if (!rect.width || !rect.height || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility)
      || style.opacity === '0' || point.x < 0 || point.x >= innerWidth || point.y < 0 || point.y >= innerHeight) {
      throw new Error(`Control is not visibly clickable: ${selector} ${JSON.stringify({ point, width: rect.width, height: rect.height, display: style.display, visibility: style.visibility })}`);
    }
    const hit = document.elementFromPoint(point.x, point.y);
    if (!hit || !(hit === node || node.contains(hit))) throw new Error('Control click target is covered or clipped: ' + selector);
    last = { selector, point, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, scroll: [scrollX, scrollY], frames: frame + 1 };
    const signature = JSON.stringify([last.rect, last.scroll]);
    if (node === target && signature === previous) {
      const events = [], types = ['mousedown', 'mouseup', 'click'];
      const record = event => events.push({
        type: event.type, trusted: event.isTrusted, expected: event.target === node || node.contains(event.target),
        x: event.clientX, y: event.clientY, tag: event.target?.tagName || '', id: event.target?.id || '',
        category: event.target?.closest?.('[data-directory-category]')?.dataset.directoryCategory ?? null,
        href: event.target?.closest?.('a')?.getAttribute('href') ?? null,
        text: event.target?.textContent?.trim().slice(0, 100) || ''
      });
      for (const type of types) document.addEventListener(type, record, true);
      globalThis.__rwnDirectoryClickQA = { ...last, events, stop: () => {
        for (const type of types) document.removeEventListener(type, record, true);
      } };
      return point;
    }
    target = node; previous = signature;
  }
  throw new Error(`Control geometry did not settle before native click: ${JSON.stringify(last)}`);
}

export const directoryStartupClickWasDelivered = evidence => Boolean(evidence
  && evidence.events?.length === 3
  && ['mousedown', 'mouseup', 'click'].every((type, index) => evidence.events[index].type === type
    && evidence.events[index].trusted && evidence.events[index].expected));

export function directoryStartupRequestLeaksQuery(request) {
  const url = new URL(request.url);
  const referrer = request.headers?.Referer || request.headers?.referer || '';
  const fields = [request.url, request.postData || '', referrer, ...url.searchParams.values(), ...new URLSearchParams(request.postData || '').values()];
  if (referrer) {
    try { fields.push(...new URL(referrer).searchParams.values()); } catch { /* Raw referrers are still checked below. */ }
  }
  return fields.some(raw => {
    let value = raw;
    try { value = decodeURIComponent(raw); } catch { /* Literal percent signs can occur in bodies. */ }
    const lower = value.toLowerCase();
    return lower.includes(QUERY.toLowerCase()) || lower.includes(IME_CANDIDATE.toLowerCase()) || /\bWIC\b/i.test(value);
  }) || [...url.searchParams.keys()].some(key => /^(q|query|search|search_term)$/i.test(key));
}

// The shared click preparer scrolls ordinary controls into view. A sticky
// header action is already visible and must not move the directory baseline.
// It gets the same settled-box/hit-test and trusted ordered-event requirements.
export async function directorySavedBrowseHeaderPoint(selector, { timeoutMs = 8000 } = {}) {
  const started = performance.now(), trace = [];
  const diagnostic = globalThis.__rwnSavedHeaderGeometryQA = { selector, timeoutMs, trace };
  const failure = () => new Error(`Saved header control did not settle within ${timeoutMs}ms: ${JSON.stringify(diagnostic)}`);
  let previous, target;
  while (performance.now() - started < timeoutMs) {
    let deadline, frame;
    try {
      await Promise.race([
        new Promise(resolve => { frame = requestAnimationFrame(resolve); }),
        new Promise((_, reject) => { deadline = setTimeout(() => reject(failure()), Math.max(1, timeoutMs - (performance.now() - started))); })
      ]);
    } finally { clearTimeout(deadline); globalThis.cancelAnimationFrame?.(frame); }
    if (performance.now() - started >= timeoutMs) break;
    const node = document.querySelector(selector), rect = node?.getBoundingClientRect();
    if (!node || node.hidden || node.disabled) throw new Error('Missing Saved header control: ' + selector);
    const style = getComputedStyle(node), point = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    trace.push({ elapsedMs: performance.now() - started, sameNode: node === target,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, scroll: [scrollX, scrollY], point,
      display: style.display, visibility: style.visibility, opacity: style.opacity });
    if (trace.length > 40) trace.shift();
    if (!(rect.width > 0 && rect.height > 0 && rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight)
      || style.display === 'none' || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') throw new Error('Saved header control is not visible: ' + JSON.stringify(diagnostic));
    const hit = document.elementFromPoint(point.x, point.y);
    if (!hit || !(hit === node || node.contains(hit))) throw new Error('Saved header control is covered: ' + JSON.stringify(diagnostic));
    const signature = JSON.stringify([rect.x, rect.y, rect.width, rect.height, scrollX, scrollY]);
    if (target === node && previous === signature) { diagnostic.settled = true; return point; }
    target = node; previous = signature;
  }
  throw failure();
}

// Extra rendered evidence for an early edit that leaves through Saved before
// the actual entry module is released. Existing startup snapshots stay intact.
export function directoryStartupSavedSnapshot(base) {
  const pick = selector => document.querySelector(selector);
  const active = document.activeElement, rect = active?.getBoundingClientRect();
  const inputRect = pick('[data-directory-query]')?.getBoundingClientRect();
  const headerRect = pick('.legal-header')?.getBoundingClientRect();
  const style = active ? getComputedStyle(active) : null;
  const useful = Boolean(active?.matches('[data-directory-query], [data-directory-country], [data-directory-need], [data-directory-category], [data-directory-clear], .directory-global-result, .directory-records h2 a'));
  const visible = useful && rect.width > 0 && rect.height > 0 && rect.top >= (pick('.legal-header')?.getBoundingClientRect().bottom || 0) + 6
    && rect.bottom <= innerHeight - 6 && rect.left >= 0 && rect.right <= innerWidth && style.display !== 'none'
    && !['hidden', 'collapse'].includes(style.visibility) && style.opacity !== '0';
  const hit = visible ? document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) : null;
  return { ...base,
    saved: Boolean(pick('.directory-shell.has-saved-view')),
    panelVisible: Boolean(pick('[data-saved-services]')?.getBoundingClientRect().height),
    menuOpen: Boolean(pick('.rwn-page-menu[open]')),
    focusedId: active?.id || '',
    meaningfulFocus: Boolean(visible && hit && (hit === active || active.contains(hit))),
    focusBox: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
    inputBox: inputRect ? { x: inputRect.x, y: inputRect.y, width: inputRect.width, height: inputRect.height } : null,
    headerGeometry: globalThis.__rwnSavedHeaderGeometryQA || null,
    documentReadyState: document.readyState || '', bodyPresent: Boolean(document.body),
    documentHeight: document.documentElement?.scrollHeight ?? null,
    staticCount: [...(document.querySelectorAll?.('.directory-records > .directory-record') || [])].length,
    headerBox: headerRect ? { x: headerRect.x, y: headerRect.y, width: headerRect.width, height: headerRect.height } : null
  };
}

// A correct query and caret are insufficient if a pending native reload/focus
// scroll carries the active editor behind the sticky header. Observe the first
// result frame and subsequent motion; never wait for an obscured input to recover.
export async function verifyDirectoryStartupEditingViewport({ sample, query, caret,
  wait = sleep, now = () => performance.now(), durationMs = 500 }) {
  const started = now(), trace = [];
  do {
    const state = await sample();
    trace.push({ elapsedMs: now() - started, scroll: state.scroll, inputBox: state.inputBox,
      headerBox: state.headerBox, focusedInput: state.focusedInput, meaningfulFocus: state.meaningfulFocus });
    assert(state.focusedInput && state.meaningfulFocus && state.query === query
      && JSON.stringify(state.selection) === JSON.stringify([caret, caret]),
    'Early directory edit lost its visible focused input', { state, trace });
    if (now() - started >= durationMs) return trace;
    await wait(50);
  } while (true);
}

export async function directoryStartupSavedHeaderPoint(selector, prepare) {
  const point = await prepare(selector), node = document.querySelector(selector);
  globalThis.__rwnEarlySavedHeaderQA?.stop();
  const events = [], types = ['mousedown', 'mouseup', 'click'];
  const record = event => events.push({ type: event.type, trusted: event.isTrusted, scroll: globalThis.scrollY ?? null,
    expected: Boolean(node && (event.target === node || node.contains(event.target))) });
  for (const type of types) document.addEventListener(type, record, true);
  globalThis.__rwnEarlySavedHeaderQA = { selector, point, events, stop: () => {
    for (const type of types) document.removeEventListener(type, record, true);
  } };
  return point;
}

export const directoryStartupReloadSourceReady = s => Boolean(s.documentPresent && s.bodyPresent && s.ready
  && s.pathname === '/directory' && !s.saved && !s.panelVisible && !s.menuOpen && s.query === 'WIC'
  && s.country === 'United States' && s.category === 'Food' && s.rows.length === 120 && !s.resultsHidden
  && s.history?.path === '/directory' && s.history.query === 'WIC' && s.history.country === 'United States'
  && s.history.category === 'food' && s.history.shown === 120 && s.history.scroll === s.scroll && s.scroll > 200);

export const directoryStartupReloadDestinationReady = (s, source, timeOrigin) => Boolean(
  s.documentPresent && s.bodyPresent && ['interactive', 'complete'].includes(s.documentReadyState)
  && Number.isFinite(s.timeOrigin) && s.timeOrigin === timeOrigin && s.timeOrigin !== source.timeOrigin
  && s.pathname === '/directory' && s.href === source.href && !s.ready && s.moduleHeld > 0 && s.catalogHeld === 0
  && !s.saved && !s.panelVisible && !s.menuOpen && s.countryDisabled && s.country === '' && s.rows.length === 0
  && s.probe?.inputs.length === 0 && s.probe.catalogReads === 0 && s.probe.catalogSettled === 0
  && Number.isFinite(source.scroll) && source.scroll > 200 && s.scroll === source.scroll
  && Number.isFinite(s.documentHeight) && s.documentHeight - s.viewport.height >= source.scroll && s.staticCount === 60
);

// The native reload can restore scroll after the editable form first appears.
// Observe that real restoration before interacting with the new document.
// A quiet initial zero plateau is insufficient for this seeded nonzero entry.
export async function waitForDirectoryStartupReloadGeometry({ sample, source = null, timeOrigin,
  wait = sleep, now = () => performance.now(), timeoutMs = 8000 }) {
  const started = now(), trace = [], phase = source ? 'destination' : 'source';
  let latest, anchor, since = started, count = 0;
  const failure = () => new Error(`Native reload ${phase} geometry did not settle within ${timeoutMs}ms: ${JSON.stringify({ expectedScroll: source?.scroll, latest, trace })}`);
  while (now() - started < timeoutMs) {
    let deadline;
    try {
      latest = await Promise.race([sample(), new Promise((_, reject) => {
        deadline = setTimeout(() => reject(failure()), Math.max(1, timeoutMs - (now() - started)));
      })]);
    } catch (error) { if (!isDirectoryStartupNavigationError(error)) throw error; latest = { documentPresent: false }; }
    finally { clearTimeout(deadline); }
    const geometry = [latest.scroll, latest.documentHeight, latest.viewport?.width, latest.viewport?.height,
      ...['inputBox', 'headerBox'].flatMap(box => ['x', 'y', 'width', 'height'].map(key => latest[box]?.[key]))];
    const valid = Boolean((source ? directoryStartupReloadDestinationReady(latest, source, timeOrigin) : directoryStartupReloadSourceReady(latest)) && geometry.every(Number.isFinite));
    const signature = JSON.stringify([latest.href, latest.timeOrigin, latest.documentReadyState, latest.query, latest.country,
      latest.history, latest.probe?.inputs, latest.staticCount, geometry]);
    if (!valid || signature !== anchor) { anchor = valid ? signature : null; since = now(); count = valid ? 1 : 0; }
    else count++;
    trace.push({ elapsedMs: now() - started, valid, expectedScroll: source?.scroll, scroll: latest.scroll,
      documentReadyState: latest.documentReadyState, documentHeight: latest.documentHeight, staticCount: latest.staticCount,
      inputBox: latest.inputBox, headerBox: latest.headerBox, moduleHeld: latest.moduleHeld, ready: latest.ready, inputs: latest.probe?.inputs.length });
    if (trace.length > 40) trace.shift();
    if (now() - started < timeoutMs && count >= 6 && now() - since >= 500) return { state: latest, durationMs: now() - started, samples: count, trace };
    await wait(50);
  }
  throw failure();
}

export const directoryStartupSavedBaselineReady = (s, { query, inputCount, timeOrigin }) => Boolean(
  s.documentPresent && Number.isFinite(s.timeOrigin) && s.timeOrigin === timeOrigin && s.pathname === '/directory'
  && !s.ready && s.moduleHeld > 0 && s.catalogHeld === 0 && !s.saved && !s.panelVisible && !s.menuOpen
  && s.query === query && s.country === '' && s.countryDisabled && s.focusedInput && s.meaningfulFocus
  && s.probe?.catalogReads === 0 && s.probe.catalogSettled === 0 && s.probe.inputs.length === inputCount
  && s.probe.inputs.every(input => input.trusted && !input.runtime) && s.probe.inputs.at(-1)?.value === query && s.rows.length === 0
);

export async function waitForDirectoryStartupSavedBaseline({ sample, query, inputCount, timeOrigin,
  wait = sleep, now = () => performance.now(), timeoutMs = 8000 }) {
  const started = now(), trace = [];
  let latest, anchor, since = started, count = 0;
  const failure = () => new Error(`Pre-Saved directory baseline did not settle within ${timeoutMs}ms: ${JSON.stringify({ latest, trace })}`);
  while (now() - started < timeoutMs) {
    let deadline;
    try {
      latest = await Promise.race([sample(), new Promise((_, reject) => {
        deadline = setTimeout(() => reject(failure()), Math.max(1, timeoutMs - (now() - started)));
      })]);
    } catch (error) { if (!isDirectoryStartupNavigationError(error)) throw error; latest = { documentPresent: false }; }
    finally { clearTimeout(deadline); }
    const geometry = [latest.scroll, ...['x', 'y', 'width', 'height'].map(key => latest.inputBox?.[key])];
    const signature = JSON.stringify([latest.href, latest.timeOrigin, latest.query, latest.country, latest.selection, latest.viewport, geometry]);
    const valid = directoryStartupSavedBaselineReady(latest, { query, inputCount, timeOrigin }) && geometry.every(Number.isFinite);
    if (!valid || signature !== anchor) { anchor = valid ? signature : null; since = now(); count = valid ? 1 : 0; }
    else count++;
    trace.push({ elapsedMs: now() - started, valid, scroll: latest.scroll, inputBox: latest.inputBox,
      focusedInput: latest.focusedInput, meaningfulFocus: latest.meaningfulFocus, moduleHeld: latest.moduleHeld, ready: latest.ready });
    if (trace.length > 40) trace.shift();
    if (now() - started < timeoutMs && count >= 6 && now() - since >= 500) return { state: latest, durationMs: now() - started, samples: count, trace };
    await wait(50);
  }
  throw failure();
}

export const directoryStartupSavedBaselinePreserved = (current, baseline) => Boolean(
  current.timeOrigin === baseline.timeOrigin && !current.ready && current.moduleHeld > 0 && current.catalogHeld === 0
  && current.query === baseline.query && current.country === baseline.country && current.countryDisabled
  && current.scroll === baseline.scroll && JSON.stringify(current.inputBox) === JSON.stringify(baseline.inputBox)
  && JSON.stringify(current.viewport) === JSON.stringify(baseline.viewport)
  && JSON.stringify(current.probe?.inputs) === JSON.stringify(baseline.probe?.inputs) && current.probe?.catalogReads === 0
);

export const directoryStartupSavedReturnReady = (s, query) => Boolean(s.documentPresent && s.ready
  && s.pathname === '/directory' && new URL(s.href).hash === '#directory-results' && !s.saved && !s.panelVisible && !s.menuOpen
  && s.meaningfulFocus && s.query === query && s.country === '' && s.category === 'All help'
  && s.history?.path === '/directory' && s.history.query === query && s.history.country === '' && s.history.category === ''
  && s.history.shown <= 60 && (query
    ? s.rows.length === 1 && s.rows[0].href === FINDER && s.rows[0].text.includes('Help finder or referral · check coverage') && s.count === '1 matching listing' && !s.resultsHidden
    : s.rows.length === 0 && s.resultsHidden && s.clearHidden && /listings on this page/.test(s.count)));

export async function waitForDirectoryStartupSavedReturn({ sample, query, wait = sleep, now = () => performance.now(), timeoutMs = 8000 }) {
  const started = now();
  let latest, anchor, since = started, count = 0;
  const failure = () => new Error(`Early Saved Browse did not settle within ${timeoutMs}ms with useful visible focus: ${JSON.stringify(latest)}`);
  while (now() - started < timeoutMs) {
    let deadline;
    try {
      latest = await Promise.race([sample(), new Promise((_, reject) => {
        deadline = setTimeout(() => reject(failure()), Math.max(1, timeoutMs - (now() - started)));
      })]);
    } catch (error) { if (!isDirectoryStartupNavigationError(error)) throw error; latest = { documentPresent: false }; }
    finally { clearTimeout(deadline); }
    const geometry = [latest.scroll, latest.focusBox?.x, latest.focusBox?.y, latest.focusBox?.width, latest.focusBox?.height];
    const signature = JSON.stringify([latest.query, latest.country, latest.category, latest.rows, latest.focusedInput, latest.focusedHref, latest.focusedId]);
    const valid = directoryStartupSavedReturnReady(latest, query) && geometry.every(Number.isFinite);
    const same = valid && anchor?.signature === signature && geometry.every((value, index) => Math.abs(value - anchor.geometry[index]) <= .5);
    if (!same) { anchor = valid ? { signature, geometry } : null; since = now(); count = valid ? 1 : 0; }
    else count++;
    if (now() - started < timeoutMs && count >= 6 && now() - since >= 500) return latest;
    await wait(50);
  }
  throw failure();
}

export async function verifyDirectoryStartup({ client, host, navigate, evaluate, capture }) {
  const origin = new URL(host).origin;
  const held = { module: [], catalog: [] };
  const hold = { module: false, catalog: false };
  const requests = [], errors = [], evidence = [];
  let interceptionError, instrumentation;
  let viewportWidth = null, scenario = 'setup', baselineEvidence = null, initialReloadEvidence = null;
  const continueRequest = requestId => client.call('Fetch.continueRequest', { requestId });
  // This runner's small CDP client exposes its WebSocket but has no event API.
  // Subscribe here so the runner itself only needs an import and invocation.
  const onMessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request);
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(arg => arg.value || arg.description || '').join(' '));
    if (message.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = message.params;
    const url = new URL(request.url);
    const kind = url.origin !== origin ? null
      : /^\/directory(?:\.[a-f0-9]+)?\.js$/.test(url.pathname) ? 'module'
      : url.pathname === '/data/search-index.json' ? 'catalog' : null;
    if (kind && hold[kind]) held[kind].push(requestId);
    else continueRequest(requestId).catch(error => { interceptionError = error; });
  };
  const state = () => evaluate(client, `(${directoryStartupSnapshot.toString()})()`);
  const wait = async (predicate, label) => {
    let latest;
    for (let attempt = 0; attempt < 160; attempt++) {
      if (interceptionError) throw interceptionError;
      try { latest = await state(); }
      catch (error) {
        // A reload can replace the default context between the CDP request and
        // evaluation. Retry only that navigation condition, never app failures.
        if (!isDirectoryStartupNavigationError(error)) throw error;
        await sleep(50); continue;
      }
      if (predicate(latest)) return latest;
      await sleep(50);
    }
    throw new Error(`${label}: ${JSON.stringify({ ...latest, held })}`);
  };
  const frames = () => evaluate(client, 'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const release = async kind => {
    assert(held[kind].length > 0, `No ${kind} request was held`, held);
    hold[kind] = false;
    await Promise.all(held[kind].splice(0).map(continueRequest));
  };
  const start = async ({ reload = false, catalog = true, beforeReload } = {}) => {
    if (!reload) await navigate(client, 'about:blank');
    const previous = await state();
    assert(!held.module.length && !held.catalog.length, 'A previous request gate remained open', held);
    hold.module = true; hold.catalog = catalog;
    if (reload) { beforeReload?.(previous); await client.call('Page.reload', { ignoreCache: true }); }
    else await client.call('Page.navigate', { url: `${host}/directory` });
    const early = await wait(s => directoryStartupStaticReady(s, previous.timeOrigin, held.module.length), 'Static directory form did not become editable before its module');
    assert(!early.ready && !early.disabled && early.countryDisabled && early.rows.length === 0 && early.probe.catalogReads === 0, 'Entry-module gate did not establish the pre-handler window', early);
    // An early edit intentionally honors the visible controls. Make this Chrome
    // fixture assumption explicit rather than silently resetting its selector.
    assert(early.country === '', 'Startup fixture requires the static country default; browser restored a visible country choice', { country: early.country, countryDisabled: early.countryDisabled, reload, history: early.history });
    return early;
  };
  const type = async text => {
    await evaluate(client, `(() => { const input = document.querySelector('[data-directory-query]'); input.focus(); input.select(); })()`);
    await client.call('Input.insertText', { text });
  };
  const erase = async () => {
    await evaluate(client, `(() => { const input = document.querySelector('[data-directory-query]'); input.focus(); input.select(); })()`);
    await client.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
    await client.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  };
  const click = async selector => {
    const point = await evaluate(client, `(${directoryStartupClickPoint.toString()})(${JSON.stringify(selector)})`);
    let activation;
    try {
      await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    } finally {
      activation = await evaluate(client, `(() => { const evidence = globalThis.__rwnDirectoryClickQA; evidence?.stop(); if (!evidence) return null; const { stop, ...detail } = evidence; return detail; })()`);
    }
    assert(directoryStartupClickWasDelivered(activation), 'Native click did not reach the intended control', activation);
  };
  const assertPrivate = (before, after) => {
    const url = new URL(after.href);
    assert(!url.search && !url.hash && JSON.stringify(before.storage) === JSON.stringify(after.storage), 'Startup filters escaped history-entry state into the URL or web storage', { before: before.storage, after: after.storage, href: after.href });
    assert(after.documentPresent && after.title && !after.overlay && Number.isFinite(after.overflow) && after.overflow <= 1, 'Startup page identity or layout failed', after);
  };
  const assertInputs = (snapshot, { count, early = count } = {}) => {
    const inputs = snapshot.probe.inputs;
    assert(inputs.length === count && inputs.every(input => input.trusted) && inputs.slice(0, early).every(input => !input.runtime) && inputs.slice(early).every(input => input.runtime), 'Expected trusted input in the precise startup phase', inputs);
  };
  const pendingStartup = async () => {
    await release('module');
    return wait(s => s.ready && held.catalog.length > 0 && /Searching/.test(s.count), 'Early query did not start its initial catalog request');
  };
  const london = async (before, { inputCount = 1, early = inputCount, caret = 9 } = {}) => {
    const found = await wait(s => s.ready && s.query === QUERY && s.rows.some(row => row.href === FINDER) && s.probe?.catalogSettled === 1, 'Early London query did not render without another input');
    await frames();
    const settled = await state();
    assert(settled.rows.length === 1 && settled.rows[0].href === FINDER && settled.rows[0].text.includes('Help finder or referral · check coverage') && settled.count === '1 matching listing' && settled.country === '' && settled.category === 'All help', 'Startup finder result or filter precedence failed', settled);
    assert(settled.focusedInput && JSON.stringify(settled.selection) === JSON.stringify([caret, caret]) && settled.history?.query === QUERY && settled.history?.focus === '', 'Startup overwrote editing focus, caret or current history', settled);
    assertInputs(settled, { count: inputCount, early });
    assertPrivate(before, settled);
    await verifyDirectoryStartupEditingViewport({ sample: savedState, query: QUERY, caret });
    return found;
  };
  const seedStaleHistory = async () => {
    await type('WIC');
    await evaluate(client, `(() => { const country = document.querySelector('[data-directory-country]'); country.value = 'United States'; country.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    // Country change starts an async search. Let its exact UI/history commit
    // before preparing a native category click against the resulting layout.
    const committed = (s, category) => s.ready && s.query === 'WIC' && s.country === 'United States' && s.category === (category || 'All help')
      && s.rows.length === 60 && !s.resultsHidden && /^\d[\d,]* matching listings$/.test(s.count || '')
      && s.history?.path === '/directory' && s.history.query === 'WIC' && s.history.country === 'United States'
      && s.history.category === category.toLowerCase() && s.history.shown === 60;
    await wait(s => committed(s, ''), 'Stale-history WIC and country search did not commit before selecting Food');
    await selectDirectoryNeed({ client, evaluate, click }, "Food");
    await wait(s => committed(s, 'Food'), 'Stale-history setup did not find WIC');
    await click('[data-directory-more]');
    const stale = await wait(s => s.rows.length === 120 && s.history?.shown === 120 && s.history?.focus === s.rows[60].href && s.scroll > 200, 'Stale-history setup did not remember listing focus and pagination');
    return stale;
  };


  const savedState = async () => ({ ...(await evaluate(client, `(${directoryStartupSavedSnapshot.toString()})((${directoryStartupSnapshot.toString()})())`)), moduleHeld: held.module.length, catalogHeld: held.catalog.length });
  const clickEarlySavedHeader = async (selector, baseline = null) => {
    const point = await evaluate(client, `(${directoryStartupSavedHeaderPoint.toString()})(${JSON.stringify(selector)}, (${directorySavedBrowseHeaderPoint.toString()}))`);
    if (baseline) {
      const current = await savedState();
      assert(directoryStartupSavedBaselinePreserved(current, baseline), 'Menu/Saved preparation moved the settled directory baseline', { baseline, current });
    }
    let activation;
    try {
      await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
      await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    } finally {
      activation = await evaluate(client, `(() => { const probe = globalThis.__rwnEarlySavedHeaderQA; probe?.stop(); if (!probe) return null; const { stop, ...detail } = probe; return detail; })()`);
    }
    assert(directoryStartupClickWasDelivered(activation), 'Early Saved header did not receive exactly one trusted native click', activation);
    if (baseline) assert(activation.events.every(event => event.scroll === baseline.scroll), 'Menu/Saved native input moved the settled directory baseline', { baselineScroll: baseline.scroll, activation });
  };
  const earlySavedBrowse = async (width, { clear = false, browseBeforeRuntime = false } = {}) => {
    scenario = `${clear ? 'early clear' : 'early input'} through native Saved and Browse ${browseBeforeRuntime ? 'before' : 'after'} runtime`;
    baselineEvidence = null; initialReloadEvidence = null;
    if (clear) {
      await seedStaleHistory();
      initialReloadEvidence = { source: await waitForDirectoryStartupReloadGeometry({ sample: savedState }) };
    }
    const before = await start({ reload: clear, beforeReload: current => {
      const stable = initialReloadEvidence.source.state;
      const captured = { ...stable, ...current };
      assert(directoryStartupReloadSourceReady(captured) && captured.timeOrigin === stable.timeOrigin && captured.scroll === stable.scroll,
        'Seeded source moved before native reload', { stable, captured });
      initialReloadEvidence.captured = captured;
    } });
    if (clear) {
      assert(before.history?.query === 'WIC' && before.history.country === 'United States' && before.history.category === 'food' && before.history.shown === 120, 'Early Saved clear requires a real stale WIC entry', before.history);
      initialReloadEvidence.destination = await waitForDirectoryStartupReloadGeometry({ sample: savedState, source: initialReloadEvidence.captured, timeOrigin: before.timeOrigin });
    }
    await type(clear ? 'WIC' : QUERY);
    if (clear) await erase();
    const query = clear ? '' : QUERY, inputCount = clear ? 2 : 1;
    await evaluate(client, `document.querySelector('[data-directory-query]').scrollIntoView({ block: 'center', behavior: 'instant' })`);
    baselineEvidence = await waitForDirectoryStartupSavedBaseline({ sample: savedState, query, inputCount, timeOrigin: before.timeOrigin });
    const preSaved = baselineEvidence.state;
    if (width < 900) await clickEarlySavedHeader('.rwn-page-menu > summary', preSaved);
    await clickEarlySavedHeader(`${width < 900 ? '.rwn-page-menu' : '.rwn-page-nav'} a[href="/directory#saved"]`, preSaved);
    const early = await wait(s => new URL(s.href).hash === '#saved' && !s.ready && held.module.length > 0 && s.query === query, 'Native Saved did not occur while the real directory module remained held');
    assert(early.probe.catalogReads === 0 && !held.catalog.length, 'Early Saved searched the private input before runtime', early);
    assertInputs(early, { count: inputCount });
    let opened = await savedState();
    if (browseBeforeRuntime) {
      // :target exposes the genuine static panel even while its deferred
      // modules are held. Native details can close its still-uninitialized menu.
      if (opened.menuOpen) await clickEarlySavedHeader('.rwn-page-menu > summary');
      opened = await savedState();
      assert(!opened.ready && opened.panelVisible && held.module.length > 0, 'Static Saved panel was not available before module release', opened);
      await click('[data-saved-services] a[href="#directory-results"]');
      const departed = await wait(s => new URL(s.href).hash === '#directory-results' && !s.ready && held.module.length > 0 && s.query === query, 'Native Browse did not precede the held entry module');
      assert(departed.probe.catalogReads === 0 && !held.catalog.length, 'Browse before runtime unexpectedly searched the input', departed);
      assertInputs(departed, { count: inputCount });
      await release('module');
    } else {
      await release('module');
      await wait(s => s.ready && new URL(s.href).hash === '#saved' && s.query === query, 'Directory did not initialize behind the native Saved view');
      for (let attempt = 0; attempt < 160; attempt++) {
        opened = await savedState();
        if (opened.saved && opened.panelVisible && !opened.menuOpen && opened.focusedId === 'saved-services-heading') break;
        await sleep(50);
      }
      assert(opened.saved && opened.panelVisible && !opened.menuOpen && opened.focusedId === 'saved-services-heading', 'Saved did not own focus after early runtime release', opened);
      await sleep(550); await frames(); opened = await savedState();
      assert(opened.saved && opened.panelVisible && !opened.menuOpen && opened.focusedId === 'saved-services-heading'
        && opened.query === query && opened.rows.length === 0 && opened.resultsHidden && opened.probe.catalogReads === 0 && !held.catalog.length,
      'Early runtime searched or stole focus before the visitor clicked Browse', opened);
      await click('[data-saved-services] a[href="#directory-results"]');
    }
    // Existing privacy assertions stay strict; only the two public navigation
    // fragments are explicitly permitted for this additional Saved scenario.
    const assertSavedPrivate = snapshot => {
      const url = new URL(snapshot.href);
      assert(['#saved', '#directory-results'].includes(url.hash), 'Unexpected early Saved navigation fragment', snapshot.href);
      url.hash = '';
      assertPrivate(before, { ...snapshot, href: url.href });
    };
    assertSavedPrivate(opened);
    if (!clear) {
      await wait(s => s.ready && new URL(s.href).hash === '#directory-results' && s.query === QUERY && held.catalog.length > 0 && /Searching/.test(s.count), 'Browse did not start the retained early query');
      await release('catalog');
      await wait(s => s.probe.catalogSettled === 1 && s.rows.length === 1 && s.rows[0].href === FINDER, 'Early Saved Browse did not render its sole finder');
    } else {
      await wait(s => s.ready && new URL(s.href).hash === '#directory-results' && s.query === '' && s.resultsHidden && s.history?.query === '', 'Early Saved blank clear resurrected stale filters');
      // Returning focus to the real search field may warm the catalog. That
      // permitted post-Browse read must settle without searching old WIC text.
      await sleep(160);
      if (held.catalog.length) await release('catalog');
      else hold.catalog = false;
      await wait(s => s.probe.catalogSettled === s.probe.catalogReads, 'Post-Browse empty-field warmup did not finish');
    }
    const returned = await waitForDirectoryStartupSavedReturn({ sample: savedState, query });
    assertInputs(returned, { count: inputCount });
    assertSavedPrivate(returned);
    if (browseBeforeRuntime) assert(Math.abs(returned.scroll - preSaved.scroll) < 5, 'Early native Browse failed to restore the pre-Saved directory scroll', { before: preSaved.scroll, after: returned.scroll, query });
    assert(returned.probe.catalogReads === (clear ? returned.probe.catalogSettled : 1) && returned.probe.catalogReads <= 1, 'Early Saved Browse repeated its catalog request', returned.probe);
    await capture(client, `directory-startup-${clear ? 'clear' : 'input'}-browse-${browseBeforeRuntime ? 'before' : 'after'}-runtime-${width}.png`);
    return { clear, browseBeforeRuntime, inputs: returned.probe.inputs, query: returned.query, country: returned.country, category: returned.category,
      rows: returned.rows.map(row => row.href), meaningfulFocus: returned.meaningfulFocus, focusedHref: returned.focusedHref, focusedInput: returned.focusedInput,
      initialReload: initialReloadEvidence ? { expectedScroll: initialReloadEvidence.captured.scroll, observedScroll: initialReloadEvidence.destination.state.scroll,
        sourceQuietMs: initialReloadEvidence.source.durationMs, destinationQuietMs: initialReloadEvidence.destination.durationMs, trace: initialReloadEvidence.destination.trace } : null,
      preSavedScroll: preSaved.scroll, baselineQuiet: { durationMs: baselineEvidence.durationMs, samples: baselineEvidence.samples, trace: baselineEvidence.trace }, finalScroll: returned.scroll, staticSavedVisibleBeforeRelease: browseBeforeRuntime ? opened.panelVisible : null,
      catalogReadsWhileSaved: opened.probe.catalogReads, catalogReadsAfterBrowse: returned.probe.catalogReads, href: returned.href };
  };

  client.ws.addEventListener('message', onMessage);
  try {
    await client.call('Network.enable');
    await client.call('Network.setBypassServiceWorker', { bypass: true });
    await client.call('Network.setCacheDisabled', { cacheDisabled: true });
    instrumentation = await client.call('Page.addScriptToEvaluateOnNewDocument', { source: `(${observeStartup.toString()})(${JSON.stringify(origin)});` });
    await client.call('Fetch.enable', { patterns: [
      { urlPattern: `${origin}/directory*.js*`, requestStage: 'Request' },
      { urlPattern: `${origin}/data/search-index.json*`, requestStage: 'Request' }
    ] });

    for (const width of [1440, 390]) {
      await client.call('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 600 });
      viewportWidth = width; scenario = 'empty startup and post-init control';
      let compositionEvidence = null;
      // Untouched fresh startup stays cheap; normal post-init typing is the control.
      let before = await start();
      assert(!before.history, 'Fresh entry unexpectedly carried directory history', before.history);
      await release('module');
      let current = await wait(s => s.ready && s.query === '' && s.resultsHidden, 'Empty startup did not leave ordinary browsing ready');
      assert(current.probe.catalogReads === 0, 'Untouched empty startup fetched the catalog', current);
      await type(QUERY);
      await wait(s => held.catalog.length > 0, 'Post-init control did not request catalog');
      await release('catalog');
      current = await wait(s => s.rows.some(row => row.href === FINDER), 'Ordinary post-init control failed');
      assertInputs(current, { count: 1, early: 0 });
      await click('[data-directory-clear]');
      current = await wait(s => s.query === '' && s.resultsHidden && s.focusedInput && s.clearHidden, 'Clear did not return focus and ordinary browsing');
      assert(current.history?.query === '', 'Clear did not replace saved query', current);
      scenario = 'cleared reload';
      before = await start({ reload: true });
      await release('module');
      current = await wait(s => s.ready && s.query === '' && s.resultsHidden, 'Cleared query reappeared after reload');
      assert(current.probe.catalogReads === 0, 'Cleared reload needlessly fetched catalog', current);
      assertPrivate(before, current);

      // This is the original defect: one trusted input before listeners exist.
      scenario = 'fresh early input';
      before = await start();
      await type(QUERY);
      await evaluate(client, "document.querySelector('[data-directory-query]').setSelectionRange(9, 9)");
      assertInputs(await state(), { count: 1 });
      await capture(client, `directory-startup-before-${width}.png`);
      await pendingStartup();
      await release('catalog');
      await london(before);
      await capture(client, `directory-startup-found-${width}.png`);

      // A reload has a valid old entry. A real edit wins over its query, filters,
      // pagination and listing focus; unedited restoration is covered separately.
      scenario = 'stale-history reload edited to London';
      const stale = await seedStaleHistory();
      before = await start({ reload: true });
      assert(before.history?.query === 'WIC' && before.history?.country === 'United States' && before.history?.shown === 120, 'Reload did not carry the stale history fixture', before.history);
      await type(QUERY);
      await evaluate(client, "document.querySelector('[data-directory-query]').setSelectionRange(9, 9)");
      await pendingStartup();
      await release('catalog');
      await london(before);

      // Empty text is also an intentional edit, even after focus moves away.
      scenario = 'early clear after blur';
      await seedStaleHistory();
      before = await start({ reload: true });
      await type('WIC'); await erase();
      const blurTarget = await evaluate(client, `(${focusDirectoryStartupBlurTarget.toString()})()`);
      const blurred = await state();
      assert(!blurred.ready && held.module.length > 0 && !blurred.focusedInput && blurred.focusedBrand && blurred.focusedHref === blurTarget.href, 'Pre-start blur was not established before releasing the module', { width, scenario, blurTarget, blurred });
      await release('module');
      current = await wait(s => s.ready && s.query === '' && s.country === '' && s.category === 'All help' && s.resultsHidden && s.history?.query === '', 'Pre-start clear resurrected stale query or filters');
      await frames(); current = await state();
      assert(current.probe.catalogReads === 0 && !current.focusedInput && current.focusedBrand && current.focusedHref === blurTarget.href && current.rows.length === 0 && current.clearHidden, 'Pre-start clear fetched stale results or stole focus after blur', current);
      assertInputs(current, { count: 2 }); assertPrivate(before, current);

      // Tab can focus a query while its native smooth reveal is still moving
      // up from the bottom of the static page. Early typing must not cancel
      // that useful motion and strand the editor outside the viewport.
      scenario = 'early typing preserves native focus reveal';
      before = await start();
      const scrollingStyle = () => evaluate(client, `(() => {
        const style = getComputedStyle(document.documentElement);
        return { behavior: style.scrollBehavior, padding: parseFloat(style.scrollPaddingTop), scroll: scrollY };
      })()`);
      const ordinaryScrolling = await scrollingStyle();
      assert(ordinaryScrolling.behavior === 'smooth', 'Native reveal fixture must exercise ordinary smooth scrolling', ordinaryScrolling);
      await evaluate(client, `(() => {
        const input = document.querySelector('[data-directory-query]');
        const previous = [...document.querySelectorAll('a[href]')].filter(link =>
          link.getBoundingClientRect().height > 0 && (link.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING)).at(-1);
        if (!previous) throw new Error('Missing native Tab predecessor for directory input');
        previous.focus({ preventScroll: true });
        window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
      })()`);
      await client.call('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      await client.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
      const revealing = await savedState();
      assert(revealing.focusedInput && !revealing.meaningfulFocus && revealing.scroll > 200,
        'Native Tab did not establish a pending offscreen query reveal', revealing);
      await client.call('Input.insertText', { text: QUERY });
      let revealed;
      for (let attempt = 0; attempt < 160; attempt++) {
        revealed = await savedState();
        if (revealed.focusedInput && revealed.meaningfulFocus) break;
        await sleep(50);
      }
      assert(revealed.focusedInput && revealed.meaningfulFocus && revealed.scroll < revealing.scroll,
        'Early typing interrupted necessary native focus reveal', { revealing, revealed });
      await pendingStartup(); await release('catalog');
      await london(before, { caret: QUERY.length });
      await capture(client, `directory-startup-native-focus-reveal-${width}.png`);
      const focusedScrolling = await scrollingStyle();
      assert(focusedScrolling.behavior === ordinaryScrolling.behavior && focusedScrolling.padding > ordinaryScrolling.padding,
        'Focused query did not retain smooth motion and field clearance', { ordinaryScrolling, focusedScrolling });
      await evaluate(client, `(${focusDirectoryStartupBlurTarget.toString()})()`);
      const blurredScrolling = await scrollingStyle();
      assert(blurredScrolling.behavior === ordinaryScrolling.behavior && blurredScrolling.padding === ordinaryScrolling.padding
        && blurredScrolling.scroll === focusedScrolling.scroll, 'Blur did not restore ordinary scroll clearance without moving the page', { ordinaryScrolling, focusedScrolling, blurredScrolling });

      // Newer input invalidates the original async search while its real catalog
      // request is held. Releasing it must never resurrect the London query.
      scenario = 'newer input while startup catalog is pending';
      before = await start(); await type(QUERY); await pendingStartup();
      await type('WIC');
      await release('catalog');
      current = await wait(s => s.query === 'WIC' && s.rows.length === 60 && s.probe?.catalogSettled === 1 && s.history?.query === 'WIC', 'Newer input lost to pending startup search');
      await frames(); current = await state();
      assert(current.rows.every(row => /\bWIC\b/i.test(row.text) && row.href !== FINDER) && current.focusedInput && JSON.stringify(current.selection) === '[3,3]', 'Stale startup results or caret replaced newer input', current);
      assertInputs(current, { count: 2, early: 1 }); assertPrivate(before, current);

      scenario = 'clear while startup catalog is pending';
      before = await start(); await type(QUERY); await pendingStartup();
      await click('[data-directory-clear]');
      await wait(s => s.query === '' && s.resultsHidden && s.focusedInput && s.history?.query === '', 'Clear did not cancel pending startup state');
      await release('catalog');
      await wait(s => s.probe?.catalogSettled === 1, 'Held catalog was not read after clear');
      await frames(); current = await state();
      assert(current.query === '' && current.rows.length === 0 && current.resultsHidden && current.clearHidden && current.focusedInput && current.history?.query === '' && /listings on this page/.test(current.count), 'Completed stale catalog resurrected a cleared startup query', current);
      assertInputs(current, { count: 1 }); assertPrivate(before, current);
      await capture(client, `directory-startup-cleared-${width}.png`);
      if (width === 390) {
        scenario = 'native IME composition across startup';
        // Chromium's own inspector-protocol/input/imeSetComposition-01.js uses
        // this native pair: imeSetComposition starts a candidate; insertText
        // commits it. Do not synthesize composition events or a second input.
        before = await start();
        assert(before.query === '', 'IME fixture requires an empty fresh input', before);
        const candidate = IME_CANDIDATE;
        await evaluate(client, "document.querySelector('[data-directory-query]').focus()");
        await client.call('Input.imeSetComposition', { text: candidate, selectionStart: candidate.length, selectionEnd: candidate.length });
        current = await state();
        assertInputs(current, { count: 1 });
        const starts = current.probe.compositions.filter(event => event.type === 'compositionstart');
        assert(current.probe.inputs[0].composing && starts.length === 1 && starts[0].trusted && !starts[0].runtime
          && current.probe.compositions.some(event => event.type === 'compositionupdate' && event.trusted && !event.runtime && event.data === candidate)
          && !current.probe.compositions.some(event => event.type === 'compositionend'), 'Native composition did not begin before directory handlers', current.probe);
        await release('module');
        await wait(s => s.ready, 'Directory did not initialize during composition');
        // Observe beyond the 80ms input debounce: partial candidate text must
        // remain editable without fetching or rendering an uncommitted search.
        await sleep(160); await frames(); current = await state();
        assert(current.query === candidate && current.focusedInput && JSON.stringify(current.selection) === JSON.stringify([candidate.length, candidate.length]) && current.probe.catalogReads === 0 && !held.catalog.length && current.resultsHidden && !current.rows.length, 'Startup altered or searched an in-progress IME candidate', current);
        await client.call('Input.insertText', { text: QUERY });
        await wait(s => held.catalog.length > 0 && s.query === QUERY, 'Committed composition did not request its final query');
        await release('catalog');
        await london(before, { inputCount: 2, early: 1, caret: QUERY.length });
        current = await state();
        const ends = current.probe.compositions.filter(event => event.type === 'compositionend');
        // As in qa-search-editing.mjs, Chromium dispatches compositionend through
        // DispatchScopedEvent. Same-run CI evidence records isTrusted=false for
        // that event even though CDP owns the composition. Keep trusted start,
        // updates and both input events; verify and record the final lifecycle.
        assert(current.probe.catalogReads === 1 && current.probe.compositions.filter(event => event.type === 'compositionstart').length === 1
          && current.probe.compositions.filter(event => event.type === 'compositionupdate').every(event => event.trusted)
          && ends.length === 1 && ends[0].runtime && ends[0].data === QUERY && ends[0].value === QUERY, 'Composition did not commit once across startup', current.probe);
        compositionEvidence = { browser: await client.call('Browser.getVersion'), physicalImeExercised: false, events: current.probe.compositions, inputs: current.probe.inputs };
        await capture(client, 'directory-startup-ime-390.png');
      }
      // Keep every original startup/IME scenario above, then exercise actual
      // Saved and Browse anchors across the real held entry-module boundary.
      const earlySaved = await earlySavedBrowse(width);
      const earlySavedClear = await earlySavedBrowse(width, { clear: true });
      const earlySavedBeforeRuntime = await earlySavedBrowse(width, { browseBeforeRuntime: true });
      const earlySavedClearBeforeRuntime = await earlySavedBrowse(width, { clear: true, browseBeforeRuntime: true });
      evidence.push({ width, earlySaved, earlySavedClear, earlySavedBeforeRuntime, earlySavedClearBeforeRuntime });
      console.log(`PASS directory startup scenarios at ${width}px`);
      evidence.push({ width, earlyInput: true, staleReload: true, earlyClearAfterBlur: true, nativeFocusReveal: { start: revealing.scroll, end: revealed.scroll, inputBox: revealed.inputBox, ordinaryScrolling, focusedScrolling, blurredScrolling }, pendingInput: true, pendingClear: true, caret: true, ime: compositionEvidence, staleShown: stale.history.shown });
    }
    scenario = 'cross-scenario privacy and console';
    const leaked = requests.filter(directoryStartupRequestLeaksQuery).map(request => ({ url: request.url, postData: request.postData }));
    assert(leaked.length === 0, 'Startup query leaked into a network request or referrer', leaked);
    assert(errors.length === 0, 'Browser errors during directory startup QA', errors);
    console.log(`PASS directory startup: ${JSON.stringify(evidence)}; trusted pre-handler typing, complete stale-response settlement and URL/storage/network privacy`);
  } catch (error) {
    // Capture a bounded diagnostic before releasing gates or leaving the failed
    // document. A stalled browser must not stall the error path indefinitely.
    const bounded = async operation => {
      let timer;
      try { return await Promise.race([operation().catch(cause => ({ error: cause.message })), new Promise(resolve => { timer = setTimeout(() => resolve({ error: 'Diagnostic timed out' }), 1500); })]); }
      finally { clearTimeout(timer); }
    };
    const failed = await bounded(savedState);
    await bounded(() => capture(client, `directory-startup-failure-${viewportWidth ?? 'unset'}.png`));
    await mkdir('qa-screenshots', { recursive: true });
    await writeFile('qa-screenshots/directory-startup-failure.json', JSON.stringify({ width: viewportWidth, scenario, error: error.message, held, initialReloadEvidence, baselineEvidence, state: failed }, null, 2));
    throw new Error(`Directory startup QA (${viewportWidth ?? 'unset'}px, ${scenario}): ${error.message}`, { cause: error });
  } finally {
    hold.module = false; hold.catalog = false;
    await Promise.all([...held.module.splice(0), ...held.catalog.splice(0)].map(id => continueRequest(id).catch(() => {})));
    await client.call('Fetch.disable');
    if (instrumentation?.identifier) await client.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: instrumentation.identifier });
    await client.call('Network.setBypassServiceWorker', { bypass: false });
    await client.call('Network.setCacheDisabled', { cacheDisabled: false });
    client.ws.removeEventListener('message', onMessage);
  }
}
