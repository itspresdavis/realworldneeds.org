// CI-only regression: hold the real entry module at the network boundary, type
// into the static form, then release it without synthesizing another input.
// No application delay, replacement module, or browser launch belongs here.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const QUERY = 'Drinking fountains for London';
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
  for (const type of ['compositionstart', 'compositionend']) document.addEventListener(type, event => {
    if (event.target.matches?.('[data-directory-query]')) probe.compositions.push({ type, trusted: event.isTrusted, runtime: Boolean(document.querySelector('.directory-global-results')) });
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

export async function verifyDirectoryStartup({ client, host, navigate, evaluate, capture }) {
  const origin = new URL(host).origin;
  const held = { module: [], catalog: [] };
  const hold = { module: false, catalog: false };
  const requests = [], errors = [], evidence = [];
  let interceptionError, instrumentation;
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
  const state = () => evaluate(client, `(() => {
    const input = document.querySelector('[data-directory-query]');
    const results = document.querySelector('.directory-global-results');
    const snapshot = storage => Object.fromEntries(Object.keys(storage).sort().map(key => [key, storage.getItem(key)]));
    return {
      href: location.href, title: document.title, timeOrigin: performance.timeOrigin,
      ready: Boolean(results && document.querySelector('[data-directory-category][aria-pressed="true"]')),
      query: input?.value, disabled: input?.disabled, countryDisabled: document.querySelector('[data-directory-country]')?.disabled,
      inputVisible: Boolean(input?.getBoundingClientRect().width && input.getBoundingClientRect().height),
      focusedInput: document.activeElement === input, focusedHref: document.activeElement?.getAttribute('href'),
      selection: input ? [input.selectionStart, input.selectionEnd] : null,
      country: document.querySelector('[data-directory-country]')?.value,
      category: document.querySelector('[data-directory-category][aria-pressed="true"]')?.textContent,
      rows: [...document.querySelectorAll('.directory-global-result')].map(row => ({ href: row.getAttribute('href'), text: row.textContent })),
      resultsHidden: results?.hidden, clearHidden: document.querySelector('[data-directory-clear]')?.hidden,
      count: document.querySelector('[data-directory-count]')?.textContent,
      history: history.state?.rwnDirectory, scroll: scrollY,
      probe: window.__rwnDirectoryStartupQA,
      storage: input ? { local: snapshot(localStorage), session: snapshot(sessionStorage) } : null,
      overflow: document.documentElement.scrollWidth - innerWidth,
      overlay: Boolean(document.querySelector('vite-error-overlay, nextjs-portal, #webpack-dev-server-client-overlay'))
    };
  })()`);
  const wait = async (predicate, label) => {
    let latest;
    for (let attempt = 0; attempt < 160; attempt++) {
      if (interceptionError) throw interceptionError;
      try { latest = await state(); }
      catch (error) {
        // A reload can replace the default context between the CDP request and
        // evaluation. Retry only that navigation condition, never app failures.
        if (!/Execution context was destroyed|Cannot find (?:default execution )?context|No execution context|Inspected target navigated/i.test(error.message)) throw error;
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
    const early = await wait(s => s.timeOrigin !== previous.timeOrigin && new URL(s.href).pathname === '/directory' && s.inputVisible && held.module.length > 0, 'Static directory form did not become editable before its module');
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
    const point = await evaluate(client, `(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node || node.hidden || node.disabled) throw new Error('Missing enabled control: ' + ${JSON.stringify(selector)});
      node.scrollIntoView({ block: 'center', behavior: 'instant' });
      const rect = node.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  };
  const assertPrivate = (before, after) => {
    const url = new URL(after.href);
    assert(!url.search && !url.hash && JSON.stringify(before.storage) === JSON.stringify(after.storage), 'Startup filters escaped history-entry state into the URL or web storage', { before: before.storage, after: after.storage, href: after.href });
    assert(after.title && !after.overlay && after.overflow <= 1, 'Startup page identity or layout failed', after);
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
    const found = await wait(s => s.ready && s.query === QUERY && s.rows.some(row => row.href === FINDER) && s.probe.catalogSettled === 1, 'Early London query did not render without another input');
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
    await click('[data-directory-category="Food"]');
    await wait(s => s.query === 'WIC' && s.country === 'United States' && s.category === 'Food' && s.rows.length === 60, 'Stale-history setup did not find WIC');
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
      before = await start({ reload: true });
      await release('module');
      current = await wait(s => s.ready && s.query === '' && s.resultsHidden, 'Cleared query reappeared after reload');
      assert(current.probe.catalogReads === 0, 'Cleared reload needlessly fetched catalog', current);
      assertPrivate(before, current);

      // This is the original defect: one trusted input before listeners exist.
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
      const stale = await seedStaleHistory();
      before = await start({ reload: true });
      assert(before.history?.query === 'WIC' && before.history?.country === 'United States' && before.history?.shown === 120, 'Reload did not carry the stale history fixture', before.history);
      await type(QUERY);
      await evaluate(client, "document.querySelector('[data-directory-query]').setSelectionRange(9, 9)");
      await pendingStartup();
      await release('catalog');
      await london(before);

      // Empty text is also an intentional edit, even after focus moves away.
      await seedStaleHistory();
      before = await start({ reload: true });
      await type('WIC'); await erase();
      const blurTarget = await evaluate(client, `(() => { const link = document.querySelector('.legal-header a[href="/directory"]'); if (!link) throw new Error('Directory header link missing'); link.focus(); return link.getAttribute('href'); })()`);
      await release('module');
      current = await wait(s => s.ready && s.query === '' && s.country === '' && s.category === 'All help' && s.resultsHidden && s.history?.query === '', 'Pre-start clear resurrected stale query or filters');
      await frames(); current = await state();
      assert(current.probe.catalogReads === 0 && current.focusedHref === blurTarget && current.rows.length === 0 && current.clearHidden, 'Pre-start clear fetched stale results or stole focus after blur', current);
      assertInputs(current, { count: 2 }); assertPrivate(before, current);

      // Newer input invalidates the original async search while its real catalog
      // request is held. Releasing it must never resurrect the London query.
      before = await start(); await type(QUERY); await pendingStartup();
      await type('WIC');
      await release('catalog');
      current = await wait(s => s.query === 'WIC' && s.rows.length === 60 && s.probe.catalogSettled === 1 && s.history?.query === 'WIC', 'Newer input lost to pending startup search');
      await frames(); current = await state();
      assert(current.rows.every(row => /\bWIC\b/i.test(row.text) && row.href !== FINDER) && current.focusedInput && JSON.stringify(current.selection) === '[3,3]', 'Stale startup results or caret replaced newer input', current);
      assertInputs(current, { count: 2, early: 1 }); assertPrivate(before, current);

      before = await start(); await type(QUERY); await pendingStartup();
      await click('[data-directory-clear]');
      await wait(s => s.query === '' && s.resultsHidden && s.focusedInput && s.history?.query === '', 'Clear did not cancel pending startup state');
      await release('catalog');
      await wait(s => s.probe.catalogSettled === 1, 'Held catalog was not read after clear');
      await frames(); current = await state();
      assert(current.query === '' && current.rows.length === 0 && current.resultsHidden && current.clearHidden && current.focusedInput && current.history?.query === '' && /listings on this page/.test(current.count), 'Completed stale catalog resurrected a cleared startup query', current);
      assertInputs(current, { count: 1 }); assertPrivate(before, current);
      await capture(client, `directory-startup-cleared-${width}.png`);
      if (width === 390) {
        // Chromium's own inspector-protocol/input/imeSetComposition-01.js uses
        // this native pair: imeSetComposition starts a candidate; insertText
        // commits it. Do not synthesize composition events or a second input.
        before = await start();
        const candidate = 'Drinking fountains for Lon';
        await evaluate(client, "document.querySelector('[data-directory-query]').focus()");
        await client.call('Input.imeSetComposition', { text: candidate, selectionStart: candidate.length, selectionEnd: candidate.length });
        current = await state();
        assertInputs(current, { count: 1 });
        assert(current.probe.inputs[0].composing && current.probe.compositions.length === 1 && current.probe.compositions[0].type === 'compositionstart' && current.probe.compositions[0].trusted && !current.probe.compositions[0].runtime, 'Native composition did not begin before directory handlers', current.probe);
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
        assert(current.probe.catalogReads === 1 && current.probe.compositions.length === 2 && current.probe.compositions[1].type === 'compositionend' && current.probe.compositions[1].trusted && current.probe.compositions[1].runtime, 'Composition did not commit once across startup', current.probe);
        await capture(client, 'directory-startup-ime-390.png');
      }
      evidence.push({ width, earlyInput: true, staleReload: true, earlyClearAfterBlur: true, pendingInput: true, pendingClear: true, caret: true, ime: width === 390, staleShown: stale.history.shown });
    }
    const leaked = requests.filter(request => {
      const url = new URL(request.url);
      const raw = `${request.url} ${request.postData || ''} ${request.headers?.Referer || request.headers?.referer || ''}`;
      let value = raw;
      try { value = decodeURIComponent(raw); } catch { /* A literal percent is allowed in a body. */ }
      return value.includes(QUERY) || /\bWIC\b/.test(value) || [...url.searchParams.keys()].some(key => /^(q|query|search|search_term)$/i.test(key));
    }).map(request => ({ url: request.url, postData: request.postData }));
    assert(leaked.length === 0, 'Startup query leaked into a network request or referrer', leaked);
    assert(errors.length === 0, 'Browser errors during directory startup QA', errors);
    console.log(`PASS directory startup: ${JSON.stringify(evidence)}; trusted pre-handler typing, complete stale-response settlement and URL/storage/network privacy`);
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
