import { mkdir, writeFile } from "node:fs/promises";

// Exercise rendered results with trusted keyboard input. Keep the oracle based
// on published catalog facts, rather than importing the matcher being tested.
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (condition, message, detail) => {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(detail)}`);
};
const surfaces = {
  finder: { route: "/", input: "#resourceSearch", rows: ".result-row-link", count: "#resultCount", more: "#showMoreResults", clear: "#clearSearch", category: '[data-quick-type="food"]', all: '[data-quick-type="all"]', results: "#results" },
  directory: { route: "/directory", input: "[data-directory-query]", rows: ".directory-global-result", count: "[data-directory-count]", more: "[data-directory-more]", clear: "[data-directory-clear]", category: '[data-directory-category="Food"]', all: '[data-directory-category=""]', results: "[data-directory-search]" }
};

async function press(client, key) {
  const code = key === "Enter" ? 13 : key === "Escape" ? 27 : 0;
  await client.call("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  await client.call("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
}

async function waitForUI(context, expression, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await context.evaluate(context.client, expression)) return;
    await sleep(50);
  }
  throw new Error(`Search UI did not settle: ${expression}`);
}

async function view(context, surface) {
  return context.evaluate(context.client, `(() => {
    const selectors = ${JSON.stringify(surface)};
    const rows = [...document.querySelectorAll(selectors.rows)].map((link) => {
      const rect = link.getBoundingClientRect(), style = getComputedStyle(link);
      return { id: decodeURIComponent(new URL(link.href).pathname.split('/').pop()), text: link.innerText, rendered: rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' };
    });
    const more = document.querySelector(selectors.more);
    return { query: document.querySelector(selectors.input)?.value, committedQuery: history.state?.rwnFinder?.query, count: document.querySelector(selectors.count)?.textContent, rows, more: Boolean(more && !more.hidden), href: location.href, overflow: document.documentElement.scrollWidth - innerWidth };
  })()`);
}

async function insertQuery(context, surface, query) {
  await context.evaluate(context.client, `(() => { const input = document.querySelector(${JSON.stringify(surface.input)}); input.focus(); input.select(); })()`);
  await context.client.call("Input.insertText", { text: query });
}

async function typeQuery(context, surface, query, { enter = true } = {}) {
  await insertQuery(context, surface, query);
  if (enter) await press(context.client, "Enter");
  // Both interfaces debounce input. Require a stable rendered result after that
  // interval, so a slow catalog request cannot accidentally test the old rows.
  await sleep(180);
  let last = "";
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await view(context, surface);
    const signature = JSON.stringify([result.query, result.count, result.rows]);
    const committed = surface !== surfaces.finder || !enter || result.committedQuery === query;
    if (committed && result.query === query && !/searching|temporarily unavailable/i.test(result.count || "") && signature === last) {
      const url = new URL(result.href);
      assert(!url.search && !decodeURIComponent(url.hash).toLowerCase().includes(query.toLowerCase()), "Typed searches must stay out of the visible URL", { query, href: result.href });
      return result;
    }
    last = signature;
    await sleep(50);
  }
  throw new Error(`Search rendering did not settle for ${JSON.stringify(query)}`);
}

async function activate(context, selector) {
  await context.evaluate(context.client, `(() => { const button = document.querySelector(${JSON.stringify(selector)}); if (!button || button.hidden) throw new Error('Missing visible control: ' + ${JSON.stringify(selector)}); button.focus(); })()`);
  await press(context.client, "Enter");
}

async function allResults(context, surface, maximum) {
  let result = await view(context, surface);
  for (let page = 0; result.more && page < maximum; page += 1) {
    const before = result.rows.length;
    await activate(context, surface.more);
    await waitForUI(context, `document.querySelectorAll(${JSON.stringify(surface.rows)}).length > ${before}`);
    result = await view(context, surface);
  }
  assert(!result.more && result.rows.length <= maximum, "Search pagination failed to terminate", result);
  assert(result.rows.every((row) => row.rendered) && result.overflow <= 1, "Search results must be rendered without overflow", result);
  return result;
}

function assertLondon(result, records, label) {
  const exact = new Set(records.filter((record) => record.city === "London").map((record) => record.id));
  const ids = result.rows.map((row) => row.id);
  assert(exact.size > 0 && [...exact].every((id) => ids.includes(id)), `${label}: exact London listings disappeared`, result);
  assert(result.rows.slice(0, exact.size).every((row) => exact.has(row.id)), `${label}: London city must precede incidental London mentions`, result.rows.slice(0, exact.size + 2));
}

function assertWic(result, records, label) {
  const names = (record) => [record.name, record.summary, record.sourceName, ...(record.services || [])].join(" ");
  const explicit = records.filter((record) => /\bwic\b/i.test(names(record)));
  const falsePositives = records.filter((record) => /Norwich Foodbank|^3rd Space$/i.test(record.name));
  const ids = new Set(result.rows.map((row) => row.id));
  assert(explicit.length > 60 && explicit.every((record) => ids.has(record.id)), `${label}: explicit WIC providers must survive all result pages`, { missing: explicit.filter((record) => !ids.has(record.id)).map((record) => record.name), count: result.rows.length });
  assert(falsePositives.length > 0 && falsePositives.every((record) => !ids.has(record.id)), `${label}: WIC matched word interiors such as Norwich or Brunswick`, result.rows.filter((row) => falsePositives.some((record) => record.id === row.id)));
  const explicitIds = new Set(explicit.map((record) => record.id));
  assert(result.rows.slice(0, explicit.length).every((row) => explicitIds.has(row.id)), `${label}: exact WIC providers must precede partial-word matches`, result.rows.slice(-4));
  assert(result.rows.some((row) => /Norwich WIC/.test(row.text)), `${label}: legitimate Norwich WIC must remain`, result.count);
}

async function verifySurface(context, kind, records, width) {
  const surface = surfaces[kind];
  await context.client.call("Emulation.setDeviceMetricsOverride", { width, height: width < 600 ? 844 : 1000, deviceScaleFactor: 1, mobile: width < 600, screenWidth: width, screenHeight: width < 600 ? 844 : 1000 });
  await context.navigate(context.client, `${context.host}${surface.route}`);
  await waitForUI(context, `Boolean(document.querySelector(${JSON.stringify(surface.input)})) && Boolean(document.querySelector(${JSON.stringify(surface.more)}))`);

  await typeQuery(context, surface, "London");
  assertLondon(await allResults(context, surface, records.length), records, `${kind} ${width}px`);
  await context.evaluate(context.client, `document.querySelector(${JSON.stringify(surface.results)}).scrollIntoView({ block: 'start' })`);
  await context.capture(context.client, `search-${kind}-london-${width}.png`);

  if (kind === "finder") {
    // Use the actual browser history entry created by Enter, not synthetic
    // popstate events or a manually manufactured rwnFinder snapshot.
    await typeQuery(context, surface, "WIC");
    const history = await context.client.call("Page.getNavigationHistory");
    // Leave a new query inside the debounce window, then use Back immediately.
    await insertQuery(context, surface, "London Road");
    assert(history.currentIndex > 0, "Committed search must create browser history", history);
    await context.client.call("Page.navigateToHistoryEntry", { entryId: history.entries[history.currentIndex - 1].id });
    await waitForUI(context, `document.querySelector('#resourceSearch')?.value === 'London'`);
    await sleep(800);
    const restored = await view(context, surface);
    assert(restored.query === "London" && restored.rows.length > 0 && records.find((record) => record.id === restored.rows[0].id)?.city === "London", "Browser Back must restore the prior query and ordering", restored);
  }

  await typeQuery(context, surface, "WIC");
  const wic = await allResults(context, surface, records.length);
  assertWic(wic, records, `${kind} ${width}px`);
  await context.evaluate(context.client, `document.querySelector(${JSON.stringify(surface.results)}).scrollIntoView({ block: 'start' })`);
  await context.capture(context.client, `search-${kind}-wic-${width}.png`);

  await typeQuery(context, surface, "London Road");
  const street = await allResults(context, surface, records.length);
  const streetRecords = records.filter((record) => /\blondon road\b/i.test(record.address));
  assert(streetRecords.some((record) => record.city !== "London") && streetRecords.every((record) => street.rows.some((row) => row.id === record.id)), `${kind} ${width}px: legitimate street-address searches disappeared`, street);

  const provider = await typeQuery(context, surface, "Whitechapel Mission");
  assert(provider.rows[0]?.id === "whitechapel-mission" && provider.rows[0].rendered, `${kind} ${width}px: exact provider lookup failed`, provider);
  await activate(context, surface.category);
  await sleep(180);
  const filtered = await view(context, surface);
  const categoryActive = await context.evaluate(context.client, `document.querySelector(${JSON.stringify(surface.category)}).getAttribute('aria-pressed') === 'true'`);
  assert(categoryActive && filtered.query === "Whitechapel Mission" && filtered.rows[0]?.id === "whitechapel-mission", `${kind} ${width}px: category filter lost the search`, filtered);
  await activate(context, surface.clear);
  await sleep(180);
  const cleared = await context.evaluate(context.client, `({ value: document.querySelector(${JSON.stringify(surface.input)}).value, focused: document.activeElement === document.querySelector(${JSON.stringify(surface.input)}), all: document.querySelector(${JSON.stringify(surface.all)}).getAttribute('aria-pressed') === 'true' })`);
  assert(cleared.value === "" && cleared.focused && (kind === "finder" || cleared.all), `${kind} ${width}px: clear must restore the query input and directory categories`, cleared);
  if (kind === "finder") await activate(context, surface.all);
  await insertQuery(context, surface, "London");
  await press(context.client, "Escape");
  await waitForUI(context, `document.querySelector(${JSON.stringify(surface.input)}).value === ''`);
  await sleep(800);
  assert((await view(context, surface)).query === "", `${kind} ${width}px: deferred input returned after Escape`, await view(context, surface));
  console.log(`Search relevance QA passed for ${kind} at ${width}px: London city first, ${wic.rows.length} WIC results, legitimate street/provider searches, keyboard/category/clear${kind === "finder" ? ", and real browser Back" : ""}.`);
}


async function measureFinderTyping(context) {
  const { client, evaluate } = context;
  let instrumentation;
  await client.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await client.call("Emulation.setCPUThrottlingRate", { rate: 4 });
  try {
    instrumentation = await client.call("Page.addScriptToEvaluateOnNewDocument", { source: `
      window.__rwnSearchTiming = { inputs: [], paints: [], slices: [], pending: 0, longTasks: [] };
      const originalIdleCallback = requestIdleCallback;
      requestIdleCallback = (callback, options) => {
        __rwnSearchTiming.pending++;
        return originalIdleCallback((deadline) => {
          const start = performance.now(); __rwnSearchTiming.pending--;
          callback(deadline);
          __rwnSearchTiming.slices.push({ start, duration: performance.now() - start });
        }, options);
      };
      new PerformanceObserver((list) => __rwnSearchTiming.longTasks.push(...list.getEntries().map((entry) => ({ start: entry.startTime, duration: entry.duration })))).observe({ type: 'longtask', buffered: true });
      document.addEventListener('input', (event) => {
        if (event.target.id !== 'resourceSearch') return;
        const entry = { value: event.target.value, start: performance.now(), trusted: event.isTrusted, disabled: event.target.disabled, pendingIdle: __rwnSearchTiming.pending };
        __rwnSearchTiming.inputs.push(entry);
        requestAnimationFrame(() => requestAnimationFrame(() => __rwnSearchTiming.paints.push({ value: entry.value, delay: performance.now() - entry.start })));
      }, true);
    ` });
    // Skip the normal navigation settling delay to type while natural idle
    // preparation can still be pending. Do not artificially delay its callbacks.
    await client.call("Page.navigate", { url: `${context.host}/` });
    await waitForUI(context, "Boolean(document.querySelector('#resourceSearch')) && Boolean(document.querySelector('.result-row-link'))", 600);
    await evaluate(client, "document.querySelector('#resourceSearch').focus(); document.querySelector('#resourceSearch').select()");
    for (const text of ["L", "o", "ndon"]) await client.call("Input.insertText", { text });
    const editable = await evaluate(client, "({ value: document.querySelector('#resourceSearch').value, disabled: document.querySelector('#resourceSearch').disabled, pendingIdle: __rwnSearchTiming.pending })");
    await press(client, "Enter");
    await waitForUI(context, "history.state?.rwnFinder?.query === 'London' && document.querySelector('.resource-row__place')?.innerText.startsWith('London')", 600);
    const coldReady = await evaluate(client, "performance.now()");
    await sleep(100);
    const cold = await evaluate(client, `({ settled: ${coldReady}, ...__rwnSearchTiming })`);
    await insertQuery(context, surfaces.finder, "WIC");
    await press(client, "Enter");
    await waitForUI(context, "history.state?.rwnFinder?.query === 'WIC' && document.querySelector('.result-row-link')?.innerText.includes('WIC')", 600);
    const warmReady = await evaluate(client, "performance.now()");
    await sleep(100);
    const warm = await evaluate(client, `({ settled: ${warmReady}, ...__rwnSearchTiming })`);
    const summarize = (snapshot, value) => {
      const last = snapshot.inputs.filter((entry) => entry.value === value).at(-1);
      const first = value === "London" ? snapshot.inputs[0] : last;
      const slices = snapshot.slices.filter((entry) => entry.start >= first.start);
      return {
        input: last,
        resultReadinessMs: Math.round(snapshot.settled - last.start),
        nextPaintMs: snapshot.paints.filter((entry) => value === "London" ? ["L", "Lo", "London"].includes(entry.value) : entry.value === value),
        idleSlicesAfterInput: slices.length,
        maximumIdleSliceMs: Math.max(0, ...slices.map((entry) => entry.duration)),
        longTasksAfterInputMs: snapshot.longTasks.filter((entry) => entry.start >= first.start).map((entry) => entry.duration)
      };
    };
    const measurement = { viewport: 390, cpuThrottle: 4, timingNote: "Diagnostic values include browser polling/paint overhead; no hardware-dependent latency budget is asserted.", editable, cold: summarize(cold, "London"), warm: summarize(warm, "WIC") };
    assert(editable.value === "London" && !editable.disabled && warm.inputs.every((entry) => entry.trusted && !entry.disabled), "Input must remain editable through cold preparation", measurement);
    await mkdir("qa-screenshots", { recursive: true });
    await writeFile("qa-screenshots/search-typing-timing.json", `${JSON.stringify(measurement, null, 2)}\n`);
    console.log(`Search typing diagnostics (390px, 4× CPU): ${JSON.stringify(measurement)}`);
  } finally {
    await client.call("Emulation.setCPUThrottlingRate", { rate: 1 });
    if (instrumentation?.identifier) await client.call("Page.removeScriptToEvaluateOnNewDocument", { identifier: instrumentation.identifier });
  }
}

export async function verifyFinderSearchRelevance(context) {
  const records = (await (await fetch(`${context.host}/data/resources.json`)).json()).resources;
  const requests = [];
  await context.client.call("Network.enable");
  const unsubscribe = context.client.on("Network.requestWillBeSent", ({ request }) => requests.push(request));
  try {
    await measureFinderTyping(context);
    for (const width of [1440, 390]) await verifySurface(context, "finder", records, width);
    const marker = "rwn-private-query-8675309";
    const empty = await typeQuery(context, surfaces.finder, marker);
    assert(empty.rows.length === 0, "Private no-match query must render an empty state", empty);
    await sleep(750);
    const privacy = await context.evaluate(context.client, `({ href: location.href, stateQuery: history.state?.rwnFinder?.query, reset: Boolean(document.querySelector('#clearFinderFilters')) })`);
    const leaked = requests.filter((request) => {
      const url = new URL(request.url);
      const payload = `${url.search} ${url.hash} ${request.postData || ""} ${request.headers?.Referer || request.headers?.referer || ""}`;
      return request.url.includes(marker) || /London|Whitechapel|\bWIC\b|rwn-private-query-8675309/i.test(payload) || [...url.searchParams.keys()].some((key) => /^(q|query|search|search_term)$/i.test(key));
    }).map(({ url, postData }) => ({ url, postData }));
    assert(!new URL(privacy.href).search && !/London|WIC|Whitechapel|rwn-private-query/i.test(privacy.href) && privacy.stateQuery === marker && privacy.reset && leaked.length === 0, "Finder queries must remain in browser history state and out of URLs/requests", { privacy, leaked });
    await activate(context, "#clearFinderFilters");
    await waitForUI(context, "document.querySelector('#resourceSearch').value === '' && document.querySelectorAll('.result-row-link').length > 0");
    await activate(context, surfaces.finder.all);
    await sleep(800);
    const resetAfterBlur = await view(context, surfaces.finder);
    assert(resetAfterBlur.query === "" && resetAfterBlur.rows.length > 0, "Empty-state clear must not restore a stale query on blur", resetAfterBlur);
    console.log("Search privacy QA passed: typed/committed queries stay out of URLs and network request query strings, bodies, and referrers.");
  } finally {
    unsubscribe();
  }
}

export async function verifyDirectorySearchRelevance(context) {
  const records = (await (await fetch(`${context.host}/data/resources.json`)).json()).resources;
  for (const width of [1440, 390]) await verifySurface(context, "directory", records, width);

  // Verify that the shipped offline module/index pair keeps the same matcher.
  // The broader offline suite separately covers reconnect and cache upgrades.
  await waitForUI(context, "Boolean(navigator.serviceWorker?.controller)");
  await context.client.call("Network.enable");
  await context.client.call("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0, connectionType: "none" });
  try {
    await context.navigate(context.client, `${context.host}/directory`);
    await waitForUI(context, "Boolean(document.querySelector('[data-directory-query]')) && navigator.onLine === false");
    await typeQuery(context, surfaces.directory, "WIC");
    const offline = await allResults(context, surfaces.directory, records.length);
    assertWic(offline, records, "offline directory");
    assert(/offline copy/.test(offline.count) && offline.rows.every((row) => /reconnect for full details/.test(row.text)), "Offline search must retain availability cautions", offline);
    await typeQuery(context, surfaces.directory, "London Road");
    const street = await allResults(context, surfaces.directory, records.length);
    assert(street.rows.some((row) => records.some((record) => record.id === row.id && record.city !== "London" && /\blondon road\b/i.test(record.address))), "Offline street-address lookup failed", street);
    console.log("Offline search relevance QA passed: WIC excludes Norwich Foodbanks, legitimate WIC and street matches remain, and reconnect cautions are visible.");
  } finally {
    await context.client.call("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1, connectionType: "wifi" });
  }
}
