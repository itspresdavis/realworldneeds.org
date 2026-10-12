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

export async function verifyDirectoryStartup({ client, host, navigate, evaluate, capture }) {
  const origin = new URL(host).origin;
  const held = { module: [], catalog: [] };
  const hold = { module: false, catalog: false };
  const requests = [], errors = [], evidence = [];
  let interceptionError, instrumentation;
  let viewportWidth = null, scenario = 'setup';
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
  const start = async ({ reload = false, catalog = true } = {}) => {
    if (!reload) await navigate(client, 'about:blank');
    const previous = await state();
    assert(!held.module.length && !held.catalog.length, 'A previous request gate remained open', held);
    hold.module = true; hold.catalog = catalog;
    if (reload) await client.call('Page.reload', { ignoreCache: true });
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
    await click('[data-directory-category="Food"]');
    await wait(s => committed(s, 'Food'), 'Stale-history setup did not find WIC');
    await click('[data-directory-more]');
    const stale = await wait(s => s.rows.length === 120 && s.history?.shown === 120 && s.history?.focus === s.rows[60].href && s.scroll > 200, 'Stale-history setup did not remember listing focus and pagination');
    return stale;
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
      console.log(`PASS directory startup scenarios at ${width}px`);
      evidence.push({ width, earlyInput: true, staleReload: true, earlyClearAfterBlur: true, pendingInput: true, pendingClear: true, caret: true, ime: compositionEvidence, staleShown: stale.history.shown });
    }
    scenario = 'cross-scenario privacy and console';
    const leaked = requests.filter(directoryStartupRequestLeaksQuery).map(request => ({ url: request.url, postData: request.postData }));
    assert(leaked.length === 0, 'Startup query leaked into a network request or referrer', leaked);
    assert(errors.length === 0, 'Browser errors during directory startup QA', errors);
    console.log(`PASS directory startup: ${JSON.stringify(evidence)}; trusted pre-handler typing, complete stale-response settlement and URL/storage/network privacy`);
  } catch (error) {
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
