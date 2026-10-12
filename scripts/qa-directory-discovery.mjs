import { selectDirectoryNeed } from "./qa-directory-need.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { directoryWicFixture } from "./qa-catalog-expectations.mjs";
import { isDirectoryStartupNavigationError, directoryStartupClickPoint, directoryStartupClickWasDelivered, directorySavedBrowseHeaderPoint } from "./qa-directory-startup.mjs";
export { directorySavedBrowseHeaderPoint } from "./qa-directory-startup.mjs";

// Real browser regression for need + country, refresh and uncached history return.
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export function directoryDiscoverySnapshot() {
  const document = globalThis.document;
  const pick = selector => document?.querySelector(selector);
  return {
    documentPresent: Boolean(document?.documentElement && document.body),
    ready: Boolean(document?.documentElement && document.body && pick('.directory-global-results') && pick('[data-directory-category][aria-pressed="true"]')),
    query: pick('[data-directory-query]')?.value,
    country: pick('[data-directory-country]')?.value,
    category: pick('[data-directory-category][aria-pressed="true"]')?.textContent,
    rows: [...(document?.querySelectorAll('.directory-global-result') || [])].map(row => ({ href: row.getAttribute('href'), text: row.textContent })),
    more: Boolean(pick('[data-directory-more]') && !pick('[data-directory-more]').hidden),
    count: pick('[data-directory-count]')?.textContent,
    focus: document?.activeElement?.getAttribute('href'), scroll: globalThis.scrollY ?? null,
    focusedId: document?.activeElement?.id,
    focusVisible: (() => { const rect = document?.activeElement?.getBoundingClientRect(); return rect?.height > 0 && rect.top >= (pick('.legal-header')?.getBoundingClientRect().bottom || 0) + 6 && rect.bottom <= innerHeight - 6; })(),
    saved: pick('.directory-shell')?.classList.contains('has-saved-view'),
    menuOpen: Boolean(pick('.rwn-page-menu[open]')),
    path: globalThis.location?.pathname || '', href: globalThis.location?.href || '', history: globalThis.history?.state?.rwnDirectory,
    heading: pick('h1')?.textContent, timeOrigin: globalThis.performance?.timeOrigin ?? null,
    overflow: document?.documentElement ? document.documentElement.scrollWidth > globalThis.innerWidth + 1 : null,
    empty: pick('.directory-global-empty')?.textContent
  };
}

export async function verifyDirectoryDiscovery({ client, host, navigate, evaluate, capture }) {
  const state = () => evaluate(client, `(${directoryDiscoverySnapshot.toString()})()`);
  const wait = async (condition, label) => {
    let latest;
    for (let i = 0; i < 120; i++) {
      try { latest = await state(); }
      catch (error) {
        if (!error?.message?.startsWith("Runtime.evaluate: ") || !isDirectoryStartupNavigationError(error)) throw error;
        await sleep(50); continue;
      }
      if (latest.documentPresent && Number.isFinite(latest.timeOrigin) && condition(latest)) return latest;
      await sleep(50);
    }
    throw new Error(`${label}: ${JSON.stringify(latest)}`);
  };
  const click = async selector => {
    const point = await evaluate(client, `(() => {
      const node = [...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.getBoundingClientRect().height && node.getBoundingClientRect().width);
      if (!node) throw new Error('Control missing');
      let r = node.getBoundingClientRect();
      const edge = node.closest('.legal-header') ? 0 : (document.querySelector('.legal-header')?.getBoundingClientRect().bottom || 0);
      if (r.top < edge || r.bottom > innerHeight) { node.scrollIntoView({ block: 'center', behavior: 'instant' }); r = node.getBoundingClientRect(); }
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`);
    await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
  };
  const type = async text => {
    await evaluate(client, `(() => { const input = document.querySelector('[data-directory-query]'); input.focus(); input.select(); })()`);
    await client.call('Input.insertText', { text });
  };
  const goEntry = async id => {
    await client.call('Page.navigateToHistoryEntry', { entryId: id });
    await sleep(300);
  };
  const evidence = [];

  for (const width of [1440, 390]) {
    await client.call('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 600 });
    await navigate(client, 'about:blank');
    await navigate(client, `${host}/directory`);
    await wait(s => s.path === '/directory' && s.ready, 'Initial directory controls did not initialize on the destination page');
    await capture(client, `directory-discovery-start-${width}.png`);
    await evaluate(client, `(() => {
      const input = document.querySelector('[data-directory-query]'); window.__directoryInputs = [];
      input.addEventListener('input', event => __directoryInputs.push(event.isTrusted));
      const country = document.querySelector('[data-directory-country]');
      country.value = 'United States'; country.dispatchEvent(new Event('change', { bubbles: true }));
    })()`);
    await type('WIC');
    await wait(s => s.query === 'WIC' && s.rows.length === 60 && s.country === 'United States', 'Country and program search did not settle');
    if (!(await evaluate(client, 'window.__directoryInputs.length > 0 && window.__directoryInputs.every(Boolean)'))) throw new Error('Search was not entered through native browser input');
    await selectDirectoryNeed({ client, evaluate, click }, "Food");
    await wait(s => s.category === 'Food' && s.rows.length === 60, 'Need filter did not settle');
    await click('[data-directory-more]');
    const before = await wait(s => s.rows.length === 120 && s.focus === s.rows[60].href, 'Second result batch did not focus its first listing');
    if (before.overflow || before.rows.some(row => !row.text.includes('United States') || !row.text.includes('Source checked'))) throw new Error('Country reach, source metadata or layout failed');
    const directoryHistory = await client.call('Page.getNavigationHistory');
    const directoryId = directoryHistory.entries[directoryHistory.currentIndex].id;
    const target = before.rows[60].href;
    await click(`.directory-global-result[href="${target}"]`);
    await wait(s => s.path === target && Boolean(s.heading), 'Native listing navigation failed');
    const serviceHistory = await client.call('Page.getNavigationHistory');
    const serviceId = serviceHistory.entries[serviceHistory.currentIndex].id;
    await goEntry(directoryId);
    // Rows arrive before the separate animation frame that restores the view.
    // Keep the bounded wait on the complete outcome, including visible focus.
    const returned = await wait(s => s.query === 'WIC' && s.country === 'United States' && s.category === 'Food' && s.rows.length === 120 && s.scroll > 200 && s.focus === target && s.focusVisible, 'Back lost query, country, need, loaded rows or visible return position');
    await client.call('Page.reload', { ignoreCache: true });
    const reloaded = await wait(s => s.timeOrigin !== returned.timeOrigin && s.query === 'WIC' && s.country === 'United States' && s.category === 'Food' && s.rows.length === 120, 'Reload lost directory state');
    await wait(s => s.focus === target && s.scroll > 200, 'Reload did not restore listing focus and scroll');
    if (new URL(reloaded.href).search || new URL(reloaded.href).hash) throw new Error('Private filters leaked into the URL');
    await capture(client, `directory-discovery-return-${width}.png`);
    await goEntry(serviceId); await wait(s => s.path === target && Boolean(s.heading), 'Forward did not return to the listing');
    await goEntry(directoryId); await wait(s => s.rows.length === 120 && s.country === 'United States', 'Repeated Back lost filters');

    await client.call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: width / 2, y: 400, deltaY: 500, deltaX: 0 });
    await sleep(200);
    const savedFrom = await state();
    if (width < 900) await click('.rwn-page-menu > summary');
    await click('.legal-header a[href="/directory#saved"]');
    await wait(s => s.saved && !s.menuOpen && s.focusedId === 'saved-services-heading', 'Saved did not close its navigation overlay and own focus');
    await sleep(250);
    if (!(await state()).saved || (await state()).focusedId !== 'saved-services-heading') throw new Error('Pending directory restoration stole Saved focus');
    await capture(client, `directory-discovery-saved-${width}.png`);
    await goEntry(directoryId);
    await wait(s => !s.saved && !s.menuOpen && s.query === 'WIC' && s.country === 'United States' && s.rows.length === 120 && s.focusVisible && s.focus?.startsWith('/service/') && Math.abs(s.scroll - savedFrom.scroll) < 5, 'Saved Back did not restore the latest scroll with an unobscured return target');

    await client.call('Input.dispatchKeyEvent', { type: 'keyDown', key: '/', code: 'Slash', windowsVirtualKeyCode: 191 });
    await client.call('Input.dispatchKeyEvent', { type: 'keyUp', key: '/', code: 'Slash', windowsVirtualKeyCode: 191 });
    await wait(s => s.focusVisible && s.scroll < 500, 'Search shortcut left the editable field offscreen after Saved Back');

    await type('zzzz-no-service-here');
    await wait(s => s.empty?.includes('does not mean help is unavailable'), 'No-match coverage explanation missing');
    if (await evaluate(client, `Boolean(document.querySelector('.directory-global-empty a[href="/directory"]'))`)) throw new Error('Global empty results offer a self-restoring full-directory link');
    await capture(client, `directory-discovery-empty-${width}.png`);
    await click('[data-fewer-words]');
    await wait(s => s.query === '' && s.country === 'United States' && s.category === 'Food' && s.rows.length === 60, 'Fewer words erased country or need');
    await click('[data-directory-clear]');
    const cleared = await wait(s => s.query === '' && s.country === '' && s.category === 'All help' && s.rows.length === 0, 'Clear filters did not restore ordinary browsing');
    await client.call('Page.reload', { ignoreCache: true });
    await wait(s => s.timeOrigin !== cleared.timeOrigin && s.query === '' && s.country === '' && s.rows.length === 0, 'Cleared filters reappeared on reload');
    evidence.push({ width, back: true, refresh: true, forward: true, secondBatch: true, recovery: true });
  }

  // Country-scoped pages have no redundant location dropdown. Their search
  // cannot silently widen to other countries; a sparse result offers alternatives.
  await navigate(client, `${host}/directory/france`);
  await wait(s => s.path === '/directory/france' && s.ready, 'France directory controls did not initialize on the destination page');
  await type('zzzz-no-service-here');
  await wait(s => s.country === undefined && s.empty?.includes('browse global resource finders'), 'Scoped fallback is missing');
  await capture(client, 'directory-discovery-scoped-empty.png');
  await click('.directory-global-empty a[href="/directory"]');
  await wait(s => s.path === '/directory' && s.ready && s.query === '' && s.rows.length === 0, 'Scoped full-directory recovery retained the failed search');
  await navigate(client, `${host}/directory/global`);
  await wait(s => s.path === '/directory/global' && s.ready, 'Global directory controls did not initialize on the destination page');
  await type('zzzz-no-service-here');
  await wait(s => Boolean(s.empty), 'Global scoped empty state is missing');
  if (await evaluate(client, `Boolean(document.querySelector('.directory-global-empty a[href="/directory/global"]'))`)) throw new Error('Global resource directory offers a self-restoring link');
  await click('.directory-global-empty a[href="/directory"]');
  await wait(s => s.path === '/directory' && s.ready && s.query === '' && s.country === '', 'Global scoped recovery did not broaden to the directory');
  await type('Drinking fountains for London');
  const finder = await wait(s => s.rows.length > 0, 'Finder example did not match');
  if (!finder.rows.some(row => row.text.includes('Help finder or referral · check coverage'))) throw new Error('A coverage finder appears to be a service location');
  await capture(client, 'directory-discovery-finder-reach.png');
  await verifyDirectorySavedBrowse({ client, host, navigate, evaluate, capture });
  console.log(`PASS directory discovery: ${JSON.stringify(evidence)}; scoped recovery and source/reach metadata`);
}

// This is separate from the original detail/Back and Saved/Back suite above.
// Only real trusted anchor clicks create the Saved and Browse history entries.
export function directorySavedBrowseSnapshot(base) {
  const document = globalThis.document;
  const pick = selector => document?.querySelector(selector);
  const all = selector => [...(document?.querySelectorAll(selector) || [])];
  const active = document?.activeElement;
  const visible = node => {
    if (!node) return false;
    const rect = node.getBoundingClientRect(), style = getComputedStyle(node);
    const edge = pick('.legal-header')?.getBoundingClientRect().bottom || 0;
    if (!(rect.width > 0 && rect.height > 0 && rect.top >= edge + 6 && rect.bottom <= innerHeight - 6
      && rect.left >= 0 && rect.right <= innerWidth) || style.display === 'none'
      || ['hidden', 'collapse'].includes(style.visibility) || style.opacity === '0') return false;
    const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
    return Boolean(hit && (hit === node || node.contains(hit)));
  };
  const service = Boolean(active?.matches('.directory-global-result, .directory-records h2 a'));
  const control = Boolean(active?.matches('[data-directory-query], [data-directory-country], [data-directory-need], [data-directory-category], [data-directory-clear], [data-fewer-words], [data-clear-all]'));
  const rect = active?.getBoundingClientRect();
  const storage = value => Object.fromEntries(Object.keys(value).sort().map(key => [key, value.getItem(key)]));
  return {
    ...base,
    summary: pick('[data-global-summary]')?.textContent,
    panelVisible: Boolean(pick('[data-saved-services]')?.getBoundingClientRect().height),
    meaningfulFocus: (service || control) && visible(active),
    focusKind: service ? 'service' : control ? 'control' : 'other',
    focusName: active?.getAttribute('aria-label') || active?.textContent?.trim().slice(0, 120) || '',
    focusBox: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
    staticHrefs: all('.directory-records h2 a').map(link => link.getAttribute('href')),
    visibleServices: all('.directory-global-result, .directory-records h2 a').filter(visible).map(link => link.getAttribute('href')),
    storage: pick('[data-directory-query]') ? { local: storage(localStorage), session: storage(sessionStorage) } : null
  };
}

export const directorySavedBrowseStateMatches = (actual, expected) => Boolean(actual.ready
  && actual.path === expected.path && actual.query === expected.query && actual.country === expected.country
  && actual.category === expected.category && actual.count === expected.count && actual.summary === expected.summary
  && actual.more === expected.more && JSON.stringify(actual.rows) === JSON.stringify(expected.rows)
  && JSON.stringify(actual.staticHrefs) === JSON.stringify(expected.staticHrefs));

export function directorySavedBrowseNavigationWasNative(events, href) {
  let url;
  try { url = new URL(href); } catch { return false; }
  return Boolean(url.hash === '#directory-results' && events?.length === 2
    && events[0].type === 'popstate' && events[0].trusted && events[0].nullState
    && events[1].type === 'hashchange' && events[1].trusted
    && events.every(event => event.href === href));
}

// One animation frame or an early correct scroll is not a return-position proof.
// The complete outcome, including visible useful focus, must stay unchanged for
// a quiet interval after Saved has hidden and the browser fragment scroll ends.
export async function waitForDirectorySavedBrowseSettled({ sample, predicate, wait = sleep,
  now = () => performance.now(), timeoutMs = 8000, quietMs = 500, minSamples = 6, label = 'Saved Browse return' }) {
  const started = now();
  let anchor, since = started, count = 0, latest;
  const trace = [];
  const failure = () => new Error(`${label} did not settle: ${JSON.stringify({ latest, trace })}`);
  while (now() - started < timeoutMs) {
    let deadline;
    try {
      latest = await Promise.race([sample(), new Promise((_, reject) => {
        deadline = setTimeout(() => reject(failure()), Math.max(1, timeoutMs - (now() - started)));
      })]);
    } catch (error) {
      if (!isDirectoryStartupNavigationError(error)) throw error;
      // A native cross-document Back/reload can replace the default context.
      // Discard that sample and restart the quiet interval, never app errors.
      latest = { documentPresent: false, timeOrigin: null };
    } finally { clearTimeout(deadline); }
    const at = now();
    const box = latest.focusBox;
    const geometry = [latest.scroll, box?.x, box?.y, box?.width, box?.height];
    const signature = JSON.stringify([latest.path, latest.query, latest.country, latest.category, latest.count,
      latest.summary, latest.rows, latest.focus, latest.focusedId, latest.focusKind, latest.focusName]);
    const valid = latest.documentPresent && Number.isFinite(latest.timeOrigin) && !latest.saved && !latest.panelVisible
      && !latest.menuOpen && !latest.overflow && latest.meaningfulFocus && geometry.every(Number.isFinite) && predicate(latest);
    const same = valid && anchor && anchor.signature === signature
      && geometry.every((value, index) => Math.abs(value - anchor.geometry[index]) <= .5);
    if (!same) { anchor = valid ? { signature, geometry } : null; since = at; count = valid ? 1 : 0; }
    else count++;
    trace.push({ at: at - started, valid: Boolean(valid), scroll: latest.scroll, focus: latest.focus,
      focusedId: latest.focusedId, focusKind: latest.focusKind, meaningfulFocus: latest.meaningfulFocus, saved: latest.saved });
    if (trace.length > 30) trace.shift();
    if (at - started < timeoutMs && count >= minSamples && at - since >= quietMs) return { state: latest, durationMs: at - started, samples: count, trace };
    await wait(50);
  }
  throw failure();
}

export function directorySavedBrowseRequestLeaks(request) {
  const url = new URL(request.url);
  const referrer = request.headers?.Referer || request.headers?.referer || '';
  const fields = [request.url, request.postData || '', referrer, ...url.searchParams.values(), ...new URLSearchParams(request.postData || '').values()];
  return [...url.searchParams.keys()].some(key => /^(q|query|search|search_term|country|category)$/i.test(key))
    || fields.some(raw => {
      let value = raw;
      try { value = decodeURIComponent(raw.replaceAll('+', ' ')); } catch { /* Still inspect malformed literal values. */ }
      return /\b(?:WIC|library|Food)\b|zzzz-saved-browse-private|United States/i.test(value);
    });
}

function observeDirectorySavedBrowse(origin, binding) {
  if (location.origin !== origin) return;
  const report = value => { if (typeof globalThis[binding] === 'function') globalThis[binding](JSON.stringify(value)); };
  for (const type of ['mousedown', 'mouseup', 'click']) document.addEventListener(type, event => {
    const selector = globalThis.__rwnSavedBrowseExpectedClick;
    if (!selector) return;
    const node = document.querySelector(selector);
    report({ kind: 'click', type, trusted: event.isTrusted, expected: Boolean(node && (node === event.target || node.contains(event.target))),
      selector, href: event.target.closest?.('a')?.getAttribute('href') || null, x: event.clientX, y: event.clientY });
  }, true);
  document.addEventListener('input', event => {
    if (event.target.matches?.('[data-directory-query]')) report({ kind: 'input', trusted: event.isTrusted, value: event.target.value });
  }, true);
  for (const type of ['popstate', 'hashchange']) addEventListener(type, event => report({
    kind: 'navigation', type, trusted: event.isTrusted, href: location.href, nullState: history.state === null,
    saved: Boolean(document.querySelector('.directory-shell.has-saved-view'))
  }), true);
}

export async function verifyDirectorySavedBrowse({ client, host, navigate, evaluate, capture }) {
  const assert = (ok, label, detail) => { if (!ok) throw new Error(`${label}: ${JSON.stringify(detail)}`); };
  const events = [], requests = [], evidence = [];
  const binding = '__rwnDirectorySavedBrowseQAEvent';
  let instrumentation, width, scenario = 'setup';
  const onMessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request);
    if (message.method === 'Runtime.bindingCalled' && message.params.name === binding) events.push(JSON.parse(message.params.payload));
  };
  const state = () => evaluate(client, `(${directorySavedBrowseSnapshot.toString()})((${directoryDiscoverySnapshot.toString()})())`);
  const wait = async (predicate, label) => {
    let latest;
    for (let attempt = 0; attempt < 160; attempt++) {
      try { latest = await state(); }
      catch (error) { if (!isDirectoryStartupNavigationError(error)) throw error; await sleep(50); continue; }
      if (latest.documentPresent && Number.isFinite(latest.timeOrigin) && predicate(latest)) return latest;
      await sleep(50);
    }
    throw new Error(`${label}: ${JSON.stringify(latest)}`);
  };
  const settle = (predicate, label) => waitForDirectorySavedBrowseSettled({ sample: state, predicate, label });
  const entry = async () => { const history = await client.call('Page.getNavigationHistory'); return history.entries[history.currentIndex].id; };
  const click = async (selector, header = false) => {
    await evaluate(client, `globalThis.__rwnSavedBrowseExpectedClick = ${JSON.stringify(selector)}`);
    const point = await evaluate(client, `(${(header ? directorySavedBrowseHeaderPoint : directoryStartupClickPoint).toString()})(${JSON.stringify(selector)})`);
    const from = events.length;
    await client.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', clickCount: 1 });
    await client.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', clickCount: 1 });
    // A cross-document Saved link destroys its old probe. Runtime binding
    // records the trusted capture-phase sequence before that document unloads.
    let activation;
    for (let delivery = 0; delivery < 20; delivery++) {
      activation = { selector, events: events.slice(from).filter(event => event.kind === 'click') };
      if (activation.events.length >= 3) break;
      await sleep(25);
    }
    assert(directoryStartupClickWasDelivered(activation), 'Saved/Browse native click did not reach the intended control exactly once', activation);
    return activation;
  };
  const type = async query => {
    await click('[data-directory-query]');
    await evaluate(client, `document.querySelector('[data-directory-query]').select()`);
    const from = events.length;
    await client.call('Input.insertText', { text: query });
    let inputs;
    for (let delivery = 0; delivery < 20; delivery++) {
      inputs = events.slice(from).filter(event => event.kind === 'input');
      if (inputs.length) break;
      await sleep(25);
    }
    assert(inputs.length === 1 && inputs[0].trusted && inputs[0].value === query, 'Saved Browse setup requires genuine query input', inputs);
  };
  const committed = (s, fixture) => {
    const { query, category = 'All help', rows, count, summary, path = '/directory' } = fixture;
    const country = Object.hasOwn(fixture, 'country') ? fixture.country : '';
    return Boolean(s.ready && s.path === path && s.query === query && s.country === country && s.category === category && s.rows.length === rows
      && s.history?.path === path && s.history.query === query && s.history.country === (country || '') && s.history.category === (category === 'All help' ? '' : category.toLowerCase())
      && !/Searching|unavailable/i.test(s.count || '') && (count === undefined || s.count === count) && (summary === undefined || s.summary === summary));
  };
  const wic = directoryWicFixture;
  const privateState = (before, after) => {
    const url = new URL(after.href);
    assert(!url.search && ['', '#saved', '#directory-results'].includes(url.hash), 'Saved Browse leaked filters in its URL', after.href);
    assert(JSON.stringify(before.storage) === JSON.stringify(after.storage), 'Saved Browse wrote private filters to browser storage', { before: before.storage, after: after.storage });
    assert(!after.overflow, 'Saved Browse introduced horizontal overflow', { width, path: after.path });
  };
  const open = async path => {
    await navigate(client, 'about:blank');
    await navigate(client, `${host}${path}`);
    return wait(s => s.ready && s.path === path && s.query === '' && s.rows.length === 0 && !s.saved, 'Fresh Saved Browse fixture did not initialize');
  };
  const position = async selector => {
    await evaluate(client, `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) throw new Error('Missing return fixture'); node.scrollIntoView({ block: 'center', behavior: 'instant' }); node.focus({ preventScroll: true }); })()`);
    return (await settle(() => true, 'Pre-Saved visible directory context')).state;
  };
  const saved = async before => {
    if (width < 900) await click('.rwn-page-menu > summary', true);
    const atClick = await state();
    assert(Math.abs(atClick.scroll - before.scroll) < 5, 'Opening the responsive Saved menu moved the directory return baseline', { before: before.scroll, actual: atClick.scroll });
    await click(`${width < 900 ? '.rwn-page-menu' : '.rwn-page-nav'} a[href="/directory#saved"]`, true);
    const opened = await wait(s => s.path === '/directory' && s.saved && s.panelVisible && !s.menuOpen && s.focusedId === 'saved-services-heading', 'Saved did not own its panel and focus');
    await sleep(550);
    const held = await state();
    assert(held.saved && held.panelVisible && !held.menuOpen && held.focusedId === 'saved-services-heading', 'Pending directory work stole Saved focus', held);
    return opened;
  };
  const browse = async (before, label) => {
    scenario = label;
    const fromEntry = await entry();
    const opened = await saved(before);
    const savedEntry = await entry(), eventStart = events.length;
    const activation = await click('[data-saved-services] a[href="#directory-results"]');
    const settled = await settle(s => directorySavedBrowseStateMatches(s, before) && Math.abs(s.scroll - before.scroll) < 5, label);
    const after = settled.state, browseEntry = await entry();
    const navigation = events.slice(eventStart).filter(event => event.kind === 'navigation');
    assert(browseEntry !== savedEntry && savedEntry !== fromEntry && after.timeOrigin === before.timeOrigin
      && new URL(after.href).hash === '#directory-results', 'Browse must create a native same-document fragment history entry', { fromEntry, savedEntry, browseEntry, before: before.href, after: after.href });
    assert(directorySavedBrowseNavigationWasNative(navigation, after.href), 'Browse did not witness ordered trusted null-state popstate then hashchange', navigation);
    if (before.rows.length) assert(after.focusKind === 'service' && after.visibleServices.includes(after.focus), 'Browse must return to a visible result title', after);
    privateState(before, opened); privateState(before, after);
    await capture(client, `directory-saved-browse-${label}-${width}.png`);
    evidence.push({ width, label, fromEntry, savedEntry, browseEntry, query: after.query, country: after.country, category: after.category,
      count: after.count, summary: after.summary, rows: after.rows.map(row => row.href), beforeScroll: before.scroll, finalScroll: after.scroll,
      focus: after.focus, focusKind: after.focusKind, meaningfulFocus: after.meaningfulFocus, quietMs: settled.durationMs, samples: settled.samples, navigation, activation });
    return { before, after, fromEntry, savedEntry, browseEntry };
  };
  const traverse = async (id, expected, label) => {
    await client.call('Page.navigateToHistoryEntry', { entryId: id });
    const result = await settle(s => directorySavedBrowseStateMatches(s, expected) && Math.abs(s.scroll - expected.scroll) < 5, label);
    privateState(expected, result.state);
    evidence.push({ width, label, entry: id, rows: result.state.rows.length, query: result.state.query, scroll: result.state.scroll, focus: result.state.focus, samples: result.samples });
    return result.state;
  };
  client.ws.addEventListener('message', onMessage);
  try {
    await client.call('Network.enable');
    await client.call('Runtime.addBinding', { name: binding });
    instrumentation = await client.call('Page.addScriptToEvaluateOnNewDocument', { source: `(${observeDirectorySavedBrowse.toString()})(${JSON.stringify(new URL(host).origin)}, ${JSON.stringify(binding)})` });
    for (width of [1440, 390]) {
      await client.call('Emulation.setDeviceMetricsOverride', { width, height: width < 600 ? 844 : 900, deviceScaleFactor: 1, mobile: width < 600, screenWidth: width, screenHeight: width < 600 ? 844 : 900 });
      const initial = await open('/directory');
      const defaults = await position('[data-directory-query]');
      await browse(defaults, 'default');
      await type('WIC');
      await evaluate(client, `(() => { const country = document.querySelector('[data-directory-country]'); country.value = 'United States'; country.dispatchEvent(new Event('change', { bubbles: true })); })()`);
      await wait(s => committed(s, wic(60, 'All help')), 'WIC and US history must commit before selecting Food');
      await selectDirectoryNeed({ client, evaluate, click }, "Food");
      const first = await wait(s => committed(s, wic(60)) && s.history.shown === 60, 'WIC/US/Food first batch must commit before Saved');
      assert(new Set(first.rows.map(row => row.href)).size === 60 && first.rows.every(row => row.text.includes('United States') && row.text.includes('Source checked')), 'First WIC batch identities or source metadata failed', first);
      const sixty = await browse(await position(`.directory-global-result[href="${first.rows[12].href}"]`), 'wic-60');
      await click('[data-directory-more]');
      const second = await wait(s => committed(s, wic(120)) && s.history.shown === 120 && s.focus === s.rows[60].href && s.meaningfulFocus, 'Expanded WIC batch must commit and own visible focus before Saved');
      assert(new Set(second.rows.map(row => row.href)).size === 120 && JSON.stringify(second.rows.slice(0, 60)) === JSON.stringify(first.rows), 'Second WIC batch changed or duplicated the original 60 rows', second);
      const expanded = await browse(await position(`.directory-global-result[href="${second.rows[72].href}"]`), 'wic-120');
      // The retained most-recent snapshot is 120 rows. Back must prefer the
      // original valid 60-row entry; Forward must prefer the different 120 entry.
      await traverse(sixty.fromEntry, sixty.before, 'back-prefers-60-entry');
      await traverse(expanded.browseEntry, expanded.after, 'forward-prefers-120-entry');
      const repeated = await browse((await settle(s => directorySavedBrowseStateMatches(s, expanded.after), 'Repeated Saved baseline')).state, 'repeated-120');
      await client.call('Page.reload', { ignoreCache: true });
      const refreshed = await wait(s => s.timeOrigin !== repeated.after.timeOrigin && directorySavedBrowseStateMatches(s, repeated.after), 'Browse entry reload lost exact WIC state');
      const reloaded = await settle(s => s.timeOrigin === refreshed.timeOrigin && directorySavedBrowseStateMatches(s, repeated.after) && Math.abs(s.scroll - repeated.after.scroll) < 5, 'Browse entry reload visible focus');
      privateState(initial, reloaded.state);
      evidence.push({ width, label: 'reload-browse-120', rows: reloaded.state.rows.length, focus: reloaded.state.focus, scroll: reloaded.state.scroll, samples: reloaded.samples });
      await click('[data-directory-clear]');
      await wait(s => committed(s, { query: '', rows: 0 }), 'Clear did not commit default browsing');
      await browse(await position('[data-directory-query]'), 'cleared');
      await type('zzzz-saved-browse-private');
      await wait(s => committed(s, { query: 'zzzz-saved-browse-private', rows: 0, count: 'No matching listings' }) && s.empty?.includes('does not mean help is unavailable'), 'Saved Browse no-match fixture did not settle');
      await browse(await position('[data-directory-query]'), 'no-match');
      await click('[data-directory-clear]');
      const blank = await wait(s => committed(s, { query: '', rows: 0 }), 'No-match clear did not commit');
      await client.call('Page.reload', { ignoreCache: true });
      const blankReload = await wait(s => s.timeOrigin !== blank.timeOrigin && committed(s, { query: '', rows: 0 }), 'Cleared Browse entry revived private search on reload');
      privateState(initial, blankReload);

      // Public scoped headers deliberately open the global Saved page. Test
      // those actual links, never manufacture a scope-local Saved anchor.
      for (const fixture of [
        { ...wic(60), path: '/directory/united-states', country: undefined },
        { path: '/directory/local/united-states/new-york/help/referral', query: 'library', category: 'All help', count: '1 matching listing', rows: 1 }
      ]) {
        scenario = `scope-${fixture.path}`;
        const scopeInitial = await open(fixture.path);
        assert(scopeInitial.country === undefined, 'Single-country/local scope unexpectedly has a country picker', scopeInitial);
        await type(fixture.query);
        await wait(s => committed(s, { ...fixture, category: 'All help', country: undefined }), 'Scoped query must commit before its category');
        if (fixture.category === 'Food') await selectDirectoryNeed({ client, evaluate, click }, "Food");
        const filtered = await wait(s => committed(s, { ...fixture, country: undefined }), 'Scoped Saved fixture did not settle');
        if (fixture.query === 'library') assert(filtered.rows[0].href === '/service/new-york-public-library-access', 'Local library scope returned the wrong identity', filtered);
        const before = await position(`.directory-global-result[href="${filtered.rows[Math.min(12, filtered.rows.length - 1)].href}"]`);
        const scopeEntry = await entry();
        await saved(before);
        await click('[data-saved-services] a[href="#directory-results"]');
        const global = await wait(s => s.ready && s.path === '/directory' && !s.saved && !s.panelVisible && s.query === '' && s.country === '' && s.category === 'All help' && s.rows.length === 0 && new URL(s.href).hash === '#directory-results', 'Scoped Saved Browse imported stale scoped filters into the global directory');
        privateState(scopeInitial, global);
        const returned = await traverse(scopeEntry, before, 'scoped-saved-back');
        await client.call('Page.reload', { ignoreCache: true });
        await wait(s => s.timeOrigin !== returned.timeOrigin && directorySavedBrowseStateMatches(s, before), 'Scoped Saved Back reload lost its own entry state');
        const scopedReload = await settle(s => directorySavedBrowseStateMatches(s, before) && Math.abs(s.scroll - before.scroll) < 5, 'Scoped Saved Back reload visible return');
        privateState(scopeInitial, scopedReload.state);
        evidence.push({ width, label: 'scoped-global-browse-back-reload', path: fixture.path, query: fixture.query, rows: filtered.rows.map(row => row.href), globalHref: global.href, focus: scopedReload.state.focus });
      }
    }
    const leaks = requests.filter(directorySavedBrowseRequestLeaks);
    assert(!leaks.length, 'Saved Browse sent private filters in a request URL/body/referrer', leaks);
    evidence.push({ label: 'privacy', requestCount: requests.length, leaks: 0, storageUnchanged: true });
  } catch (error) {
    evidence.push({ width, scenario, error: error.message, state: await state().catch(() => null) });
    await capture(client, `directory-saved-browse-failure-${width}.png`).catch(() => {});
    throw error;
  } finally {
    client.ws.removeEventListener('message', onMessage);
    if (instrumentation?.identifier) await client.call('Page.removeScriptToEvaluateOnNewDocument', { identifier: instrumentation.identifier });
    await client.call('Runtime.removeBinding', { name: binding });
    await mkdir('qa-screenshots', { recursive: true });
    await writeFile('qa-screenshots/directory-saved-browse.json', JSON.stringify(evidence, null, 2));
  }
  console.log(`PASS Saved Browse: ${evidence.length} exact-state cases, trusted native fragments, settled visible focus, 60/120-entry precedence, reload, scope and privacy.`);
}
