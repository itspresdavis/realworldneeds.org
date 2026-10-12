import { selectDirectoryNeed } from "./qa-directory-need.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import { isDirectoryStartupNavigationError } from "./qa-directory-startup.mjs";

// Keep the oracle independent of the scope builder and search matcher: these
// published catalog facts must agree with both static cards and live results.
const assert = (ok, label, detail) => {
  if (!ok) throw new Error(`${label}: ${JSON.stringify(detail)}`);
};
const ids = records => records.map(record => record.id).sort();
const sameIds = (actual, expected) => JSON.stringify([...actual].sort()) === JSON.stringify(expected);
const referralPath = "/directory/local/united-states/new-york/help/referral";
const cityPath = "/directory/local/united-states/new-york";
const bostonPath = "/directory/local/united-states/boston";

export function localDirectorySnapshot() {
  const document = globalThis.document;
  const pick = selector => document?.querySelector(selector);
  const all = selector => [...(document?.querySelectorAll(selector) || [])];
  const visible = node => { const rect = node?.getBoundingClientRect(); return !!rect?.width && !!rect?.height && getComputedStyle(node).visibility !== 'hidden'; };
  const input = pick('[data-directory-query]');
  const active = document?.activeElement, rect = active?.getBoundingClientRect();
  const recordId = link => decodeURIComponent(new URL(link.href).pathname.split('/').pop());
  return {
    documentPresent: Boolean(document?.documentElement && document.body), ready: Boolean(document?.documentElement && document.body && pick('.directory-global-results') && pick('[data-directory-category][aria-pressed="true"]')),
    path: globalThis.location?.pathname || '', href: globalThis.location?.href || '', timeOrigin: globalThis.performance?.timeOrigin ?? null,
    query: input?.value, category: pick('[data-directory-category][aria-pressed="true"]')?.dataset.directoryCategory,
    history: globalThis.history?.state?.rwnDirectory, filtered: !!pick('.directory-shell.has-global-search'),
    country: !!pick('[data-directory-country]'), count: pick('[data-directory-count]')?.textContent,
    staticIds: all('.directory-records > .directory-record h2 a').map(recordId),
    staticVisible: visible(pick('.directory-records > .directory-record')),
    rows: all('.directory-global-result').map(link => ({ id: recordId(link), href: link.getAttribute('href'), visible: visible(link), text: link.textContent })),
    more: visible(pick('[data-directory-more]')),
    empty: pick('.directory-global-empty')?.textContent,
    fewer: visible(pick('.directory-global-empty [data-fewer-words]')),
    clearAll: visible(pick('.directory-global-empty [data-clear-all]')),
    focused: active?.getAttribute('href'), inputFocused: Boolean(input && active === input),
    focusVisible: !!rect?.height && rect.top >= (pick('.legal-header')?.getBoundingClientRect().bottom || 0) + 6 && rect.bottom <= innerHeight - 6,
    scroll: globalThis.scrollY ?? null, heading: pick('h1')?.textContent,
    overflow: document?.documentElement ? document.documentElement.scrollWidth - globalThis.innerWidth : null
  };
}

export async function verifyLocalDirectorySearch({ client, host, payload, navigate, evaluate, capture }) {
  const newYork = payload.resources.filter(record => record.country === "United States" && record.city === "New York");
  const referral = newYork.filter(record => [record.category, ...(record.secondaryCategories || [])].includes("referral"));
  const wic = ids(newYork.filter(record => record.id.startsWith("ny-wic-")));
  const library = ["new-york-public-library-access"];
  const boston = payload.resources.filter(record => record.country === "United States" && record.city === "Boston");
  assert(newYork.length === 16 && referral.length === 15 && wic.length === 14 && referral.some(record => record.id === library[0]), "New York catalog fixtures changed", { newYork: ids(newYork), referral: ids(referral), wic });
  assert(boston.some(record => record.id === "boston-homeless-services" && record.kind === "locator"), "Boston locator fixture missing", ids(boston));

  const snapshot = () => evaluate(client, `(${localDirectorySnapshot.toString()})()`);
  const wait = async (predicate, label) => {
    let state;
    for (let attempt = 0; attempt < 160; attempt++) {
      try { state = await snapshot(); }
      catch (error) {
        if (!error?.message?.startsWith("Runtime.evaluate: ") || !isDirectoryStartupNavigationError(error)) throw error;
        await new Promise(resolve => setTimeout(resolve, 50)); continue;
      }
      if (state.documentPresent && Number.isFinite(state.timeOrigin) && predicate(state)) return state;
      // Retry cadence only. Every success requires the complete committed UI,
      // including result IDs or restored focus; elapsed time never proves it.
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw new Error(`${label}: ${JSON.stringify(state)}`);
  };
  const click = async selector => {
    const point = await evaluate(client, `(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      if (!node || node.hidden || node.disabled) throw new Error('Missing local-search control: ' + ${JSON.stringify(selector)});
      node.scrollIntoView({ block: 'center', behavior: 'instant' });
      const rect = node.getBoundingClientRect();
      if (!rect.width || !rect.height) throw new Error('Hidden local-search control');
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    })()`);
    await client.call("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  };
  const type = async text => {
    await click("[data-directory-query]");
    await evaluate(client, `(() => { window.__localSearchInputs = []; document.querySelector('[data-directory-query]').addEventListener('input', event => window.__localSearchInputs.push(event.isTrusted), { once: true }); })()`);
    await client.call("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
    await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
    await client.call("Input.insertText", { text });
    assert(await evaluate(client, "window.__localSearchInputs.length === 1 && window.__localSearchInputs[0]"), "Local search must use trusted input", text);
  };
  const committed = (state, path, query, category) => state.ready && state.path === path && state.query === query && state.category === category && state.history?.path === path && state.history.query === query && state.history.category === category.toLowerCase() && !/searching|unavailable/i.test(state.count || "");
  const check = (state, allowed) => {
    const url = new URL(state.href);
    assert(!url.search && !url.hash && !state.country && Number.isFinite(state.overflow) && state.overflow <= 1, "Local scope, private URL or layout failed", state);
    assert(state.rows.every(row => row.visible && allowed.includes(row.id)), "Hidden or out-of-scope local result", state);
  };
  const filtered = async (path, query, category, expected, allowed) => {
    const state = await wait(state => committed(state, path, query, category) && state.filtered && !state.more && sameIds(state.rows.map(row => row.id), expected) && state.count === `${expected.length} matching ${expected.length === 1 ? "listing" : "listings"}`, `Local results failed (${path}, ${query || "empty query"}, ${category || "All help"})`);
    check(state, allowed);
    return state;
  };
  const clear = async (path, expected, selector = "[data-directory-clear]") => {
    await click(selector);
    const state = await wait(state => committed(state, path, "", "") && !state.filtered && state.rows.length === 0 && state.staticVisible && sameIds(state.staticIds, expected) && state.inputFocused, "Clear did not restore scoped browsing and input focus");
    check(state, expected);
    return state;
  };
  const open = async (path, expected) => {
    await navigate(client, "about:blank");
    await navigate(client, `${host}${path}`);
    const state = await wait(state => state.ready && state.path === path && state.query === "" && !state.filtered && state.staticVisible && sameIds(state.staticIds, expected), "Local static cards disagree with catalog facts");
    check(state, expected);
  };
  const evidence = [];
  let width;
  try {
    for (width of [1440, 390]) {
      const height = width < 600 ? 844 : 900;
      await client.call("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600, screenWidth: width, screenHeight: height });
      const scopeIds = ids(referral);
      await open(referralPath, scopeIds);
      await type("WIC");
      await filtered(referralPath, "WIC", "", wic, scopeIds);
      await capture(client, `local-search-referral-wic-${width}.png`);
      await type("library");
      await filtered(referralPath, "library", "", library, scopeIds);
      await capture(client, `local-search-referral-library-${width}.png`);
      await clear(referralPath, scopeIds);
      await selectDirectoryNeed({ client, evaluate, click }, "Food");
      await filtered(referralPath, "", "Food", wic, scopeIds);
      await type("WIC");
      const searched = await filtered(referralPath, "WIC", "Food", wic, scopeIds);
      const history = await client.call("Page.getNavigationHistory");
      const entryId = history.entries[history.currentIndex].id;
      const target = searched.rows[Math.floor(searched.rows.length / 2)].href;
      await click(`.directory-global-result[href="${target}"]`);
      await wait(state => state.path === target && !!state.heading, "Native local listing navigation failed");
      await client.call("Page.navigateToHistoryEntry", { entryId });
      const returned = await wait(state => committed(state, referralPath, "WIC", "Food") && sameIds(state.rows.map(row => row.id), wic) && state.focused === target && state.focusVisible && state.scroll > 0, "Back lost scoped query, need or visible target focus");
      check(returned, scopeIds);
      await client.call("Page.reload", { ignoreCache: true });
      const reloaded = await wait(state => state.timeOrigin !== returned.timeOrigin && committed(state, referralPath, "WIC", "Food") && sameIds(state.rows.map(row => row.id), wic) && state.focused === target && state.focusVisible && state.scroll > 0, "Reload lost scoped query, need or visible target focus");
      check(reloaded, scopeIds);
      await capture(client, `local-search-referral-return-${width}.png`);

      const noMatch = async () => {
        await type("zzzz-no-local-service-here");
        const state = await wait(state => committed(state, referralPath, "zzzz-no-local-service-here", "Food") && state.filtered && state.rows.length === 0 && state.empty?.includes("does not mean help is unavailable") && state.fewer && state.clearAll, "Local no-match explanation or recovery controls missing");
        check(state, scopeIds);
      };
      await noMatch();
      await capture(client, `local-search-referral-empty-${width}.png`);
      await click(".directory-global-empty [data-fewer-words]");
      const fewer = await filtered(referralPath, "", "Food", wic, scopeIds);
      assert(fewer.inputFocused, "Fewer words must focus the query and preserve the need", fewer);
      await noMatch();
      const cleared = await clear(referralPath, scopeIds, ".directory-global-empty [data-clear-all]");
      await client.call("Page.reload", { ignoreCache: true });
      const fresh = await wait(state => state.timeOrigin !== cleared.timeOrigin && committed(state, referralPath, "", "") && !state.filtered && state.rows.length === 0 && state.staticVisible, "Cleared local filters returned after reload");
      check(fresh, scopeIds);
      evidence.push({ width, path: referralPath, staticIds: scopeIds, wic, library, emptyQueryFood: wic, back: true, reload: true, target, fewerWords: true, clear: true, privateUrl: true, overflow: reloaded.overflow });

      await open(cityPath, ids(newYork));
      await type("library");
      await filtered(cityPath, "library", "", library, ids(newYork));
      await type("WIC");
      await filtered(cityPath, "WIC", "", wic, ids(newYork));
      await capture(client, `local-search-city-wic-${width}.png`);
      evidence.push({ width, path: cityPath, staticIds: ids(newYork), library, wic });

      await open(bostonPath, ids(boston));
      await type("homeless");
      const homeless = await wait(state => committed(state, bostonPath, "homeless", "") && state.filtered && !state.more && state.rows.some(row => row.id === "boston-homeless-services"), "Boston search omitted its local locator");
      check(homeless, ids(boston));
      await capture(client, `local-search-boston-homeless-${width}.png`);
      evidence.push({ width, path: bostonPath, staticIds: ids(boston), query: "homeless", resultIds: homeless.rows.map(row => row.id), locator: "boston-homeless-services", overflow: homeless.overflow });
    }
  } catch (error) {
    const state = await snapshot().catch(() => null);
    evidence.push({ width, error: error.message, state });
    await capture(client, `local-search-failure-${width}.png`).catch(() => {});
    throw error;
  } finally {
    await mkdir("qa-screenshots", { recursive: true });
    await writeFile("qa-screenshots/local-search.json", JSON.stringify(evidence, null, 2));
  }
  console.log(`PASS local search: ${evidence.length} desktop/mobile scope cases, exact New York WIC/library IDs, Boston locator, private Back/reload state, visible return focus and no-match recovery.`);
}
