import { mkdir, writeFile } from "node:fs/promises";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition, message, detail) => {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(detail)}`);
};

// CI-only response fixture. Never queries a device location or the live source.
// Serialized into the temporary QA page; it does not ship with the application.
export function installLiveSourceCountFixture(origin) {
  if (location.origin !== origin) return;
  const nativeFetch = window.fetch.bind(window);
  const pending = [];
  const probe = window.__rwnLiveCountQA = { requests: [], clicks: [], geometryFilters: [], locationCalls: 0, scenario: { count: 0, nearby: 0 } };
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
    getCurrentPosition(success) {
      probe.locationCalls += 1;
      queueMicrotask(() => success({ coords: { latitude: 40, longitude: -75, accuracy: 1000 } }));
    },
  } });
  const features = () => Array.from({ length: probe.scenario.nearby || 0 }, (_, index) => ({
    attributes: { FID: `qa-${index}`, Site_Name: `Synthetic QA meal site ${index + 1}`, Site_City: "Synthetic QA", Site_State: "PA", Site_Address1: "Fictional example only" },
    geometry: { x: -75, y: 40 },
  }));
  window.fetch = (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    const isUsda = url.origin === "https://services1.arcgis.com" && url.pathname.includes("Summer_Meals_Site_Finder_2026_") && url.pathname.endsWith("/FeatureServer/0/query");
    if (!isUsda) {
      // Isolate count lifecycle from the separately tracked world-ring containment
      // defect. Keep the exact real U.S. feature in both geometry datasets; do not
      // change its coordinates, country lookup, or any production map code.
      if (url.origin === origin && ["/data/countries.geojson", "/data/countries-detail.geojson"].includes(url.pathname)) {
        return nativeFetch(input, options).then(async response => {
          if (!response.ok) return response;
          const data = await response.json();
          const features = data.features.filter(feature => feature.properties?.NAME === "United States of America");
          if (features.length !== 1) throw new Error("Count fixture requires exactly one unchanged U.S. geometry feature");
          probe.geometryFilters.push({ path: url.pathname, originalFeatures: data.features.length, retainedFeatures: features.length });
          return new Response(JSON.stringify({ ...data, features }), { headers: { "Content-Type": "application/geo+json" } });
        });
      }
      if (url.origin !== origin) return Promise.reject(new Error("External request blocked in synthetic USDA QA"));
      return nativeFetch(input, options);
    }
    const kind = url.searchParams.get("returnCountOnly") === "true" ? "count" : "nearby";
    probe.requests.push({ kind, geometry: url.searchParams.get("geometry") });
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException("Aborted", "AbortError"));
      if (options.signal?.aborted) return abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      pending.push(() => {
        options.signal?.removeEventListener("abort", abort);
        const failed = probe.scenario[`${kind}Failed`];
        resolve(new Response(JSON.stringify(failed ? { error: { code: 400 } } : kind === "count" ? { count: probe.scenario.count } : { features: features() }), { status: failed ? 400 : 200, headers: { "Content-Type": "application/json" } }));
      });
    });
  };
  probe.release = () => { for (const finish of pending.splice(0)) finish(); };
  document.addEventListener("click", event => {
    const control = event.target.closest?.("button, summary");
    const id = control?.matches(".finder-location-notes summary") ? "about" : control?.id;
    if (["locateMe", "clearLocation", "about"].includes(id)) probe.clicks.push({ id, trusted: event.isTrusted });
  }, true);
  document.addEventListener("DOMContentLoaded", () => {
    const banner = document.createElement("aside");
    banner.textContent = "SYNTHETIC QA: test USDA responses/location and a U.S.-only map fixture. World country detection is not tested. Do not contact examples.";
    banner.style.cssText = "padding:12px;background:#fff1b8;color:#241a00;font:600 14px/1.4 system-ui";
    document.body.prepend(banner);
  }, { once: true });
}

export function liveSourceCountSnapshot() {
  const status = document.getElementById("liveSourceStatus"), reach = document.getElementById("catalogReach");
  const box = element => { const rect = element?.getBoundingClientRect(); return rect ? { width: rect.width, height: rect.height } : null; };
  return {
    href: location.href, title: document.title,
    status: status?.textContent, reach: reach?.textContent,
    role: status?.getAttribute("role"), live: status?.getAttribute("aria-live"), atomic: status?.getAttribute("aria-atomic"),
    statusBox: box(status), reachBox: box(reach),
    disclosureOpen: document.querySelector(".finder-location-notes")?.open,
    statusVisible: Boolean(status && status.checkVisibility()),
    locateBusy: document.getElementById("locateMe")?.classList.contains("is-loading"),
    overflow: document.documentElement.scrollWidth - innerWidth,
    external: performance.getEntriesByType("resource").map(entry => entry.name).filter(url => /^https?:/.test(url) && new URL(url).origin !== location.origin),
    probe: window.__rwnLiveCountQA && { requests: window.__rwnLiveCountQA.requests, clicks: window.__rwnLiveCountQA.clicks, locationCalls: window.__rwnLiveCountQA.locationCalls, geometryFilters: window.__rwnLiveCountQA.geometryFilters },
  };
}

// Runs in the existing GitHub browser suite. No browser is launched here.
export async function verifyLiveSourceCounts({ client, host, navigate, evaluate, capture, qaDir = "qa-screenshots" }) {
  const evidence = [];
  let currentCase = "setup";
  const wait = async (expression, label) => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await evaluate(client, expression)) return;
      await pause(50);
    }
    throw new Error(`USDA count fixture did not settle: ${label}`);
  };
  const snapshot = () => evaluate(client, `(${liveSourceCountSnapshot})()`);
  const activate = async id => {
    const ready = await evaluate(client, `(() => {
      const button = ${JSON.stringify(id)} === "about" ? document.querySelector(".finder-location-notes summary") : document.getElementById(${JSON.stringify(id)});
      button?.scrollIntoView({ block: 'center' }); button?.focus({ preventScroll: true });
      return Boolean(button && !button.hidden && !button.disabled && document.activeElement === button);
    })()`);
    check(ready, "USDA fixture control is not keyboard-ready", id);
    await client.call("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, text: "\r", unmodifiedText: "\r" });
    await client.call("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    const result = await snapshot();
    check(result.probe.clicks.at(-1)?.id === id && result.probe.clicks.at(-1)?.trusted, "Trusted keyboard input did not activate the count fixture control", result);
  };
  const installed = await client.call("Page.addScriptToEvaluateOnNewDocument", { source: `(${installLiveSourceCountFixture})(${JSON.stringify(host)})` });
  try {
    await client.call("Network.setBypassServiceWorker", { bypass: true });
    for (const width of [1440, 390]) {
      currentCase = `initial-${width}`;
      await client.call("Emulation.setDeviceMetricsOverride", { width, height: 1000, deviceScaleFactor: 1, mobile: width < 600 });
      await navigate(client, `${host}/`);
      await wait("document.querySelector('.finder-location-notes') && !document.getElementById('locateMe')?.disabled", "finder ready");
      const initial = await snapshot();
      check(initial.href === `${host}/` && initial.title && initial.reach === undefined && !initial.disclosureOpen && !initial.statusVisible, "Enhanced finder must retain its collapsed disclosure and removed base reach strip", initial);
      evidence.push({ label: `initial-${width}`, ...initial });
      for (const scenario of [
        { label: "zero", count: 0, nearby: 0 },
        { label: "positive", count: 100, nearby: 1 },
        { label: "national-unavailable", countFailed: true, nearby: 0 },
        { label: "nearby-unavailable", count: 200, nearbyFailed: true },
      ]) {
        currentCase = `${scenario.label}-${width}`;
        await evaluate(client, `window.__rwnLiveCountQA.scenario=${JSON.stringify(scenario)}`);
        const before = await snapshot();
        await activate("locateMe");
        await wait(`window.__rwnLiveCountQA.requests.length === ${before.probe.requests.length + 2}`, "both synthetic requests");
        const loading = await snapshot();
        check(/Checking USDA/.test(loading.status) && !/active nationally today/.test(loading.status), "Loading presented an old current count", loading);
        await evaluate(client, "window.__rwnLiveCountQA.release()");
        await wait("!document.getElementById('locateMe').classList.contains('is-loading')", "source settled");
        if (scenario.label === "zero") {
          const closed = await snapshot();
          check(!closed.disclosureOpen && !closed.statusVisible, "Source settlement unexpectedly opened the disclosure", closed);
          evidence.push({ label: `zero-collapsed-${width}`, ...closed });
          await activate("about");
        }
        const settled = await snapshot();
        check(settled.role === "status" && settled.live === "polite" && settled.atomic === "true", "Count status lacks polite live-region markup (screen-reader delivery is not asserted)", settled);
        check(settled.statusVisible && settled.disclosureOpen && settled.statusBox?.width > 0 && settled.statusBox.height > 0 && settled.overflow <= 1 && !settled.external.length, "Count fixture has hidden content, overflow, or an external request", settled);
        if (scenario.label === "zero") check(/No current USDA meal sites were returned/.test(settled.status) && /USDA lists 0 meal sites as active nationally today/.test(settled.status), "Zero count was not rendered truthfully", settled);
        if (scenario.label === "positive") check(/Loaded 1 current USDA meal site nearby/.test(settled.status) && /USDA lists 100 meal sites as active nationally today/.test(settled.status), "Loaded nearby and national counts were conflated", settled);
        if (scenario.label === "national-unavailable") check(/No current USDA meal sites were returned/.test(settled.status) && /National count unavailable/.test(settled.status), "Unknown national count became a zero or old count", settled);
        if (scenario.label === "nearby-unavailable") check(/could not be loaded/.test(settled.status) && /USDA lists 200 meal sites as active nationally today/.test(settled.status), "Nearby failure hid an independent national success", settled);
        evidence.push({ label: `${scenario.label}-${width}`, loading, settled });
        await evaluate(client, "document.getElementById('liveSourceStatus').scrollIntoView({block:'center'})");
        await capture(client, `live-counts-${scenario.label}-${width}.png`);
        await activate("clearLocation");
        const cleared = await snapshot();
        check(/In the United States, location search/.test(cleared.status) && !/active nationally today/.test(cleared.status), "Clear retained a current-count claim", cleared);
        evidence.push({ label: `clear-${scenario.label}-${width}`, ...cleared });
      }
      const final = await snapshot();
      check(final.probe.geometryFilters.length >= 1 && final.probe.geometryFilters.every(entry => entry.originalFeatures > 1 && entry.retainedFeatures === 1), "Count fixture must retain only the original U.S. feature", final);
      evidence.push({ label: `isolated-geometry-${width}`, geometryFilters: final.probe.geometryFilters, limitation: "Original U.S. geometry only. Full-world country correctness is a separate regression." });
      console.log(`USDA count presentation passed at ${width}px: zero, positive, national/nearby failure, loading, Clear, trusted keyboard, open/closed disclosure and no external source requests. Single-country U.S. geometry fixture; world country accuracy is not asserted.`);
    }
  } catch (error) {
    const failed = { label: `failed-${currentCase}`, error: error.message, ...await snapshot() };
    evidence.push(failed);
    console.error("USDA count fixture failure:", JSON.stringify(failed));
    await capture(client, "live-counts-failure.png");
    throw error;
  } finally {
    await client.call("Page.removeScriptToEvaluateOnNewDocument", { identifier: installed.identifier });
    await client.call("Network.setBypassServiceWorker", { bypass: false });
    // Destroy the current synthetic document so its location/fetch overrides do
    // not affect any later verifier, even after an assertion fails.
    await navigate(client, "about:blank");
    await mkdir(qaDir, { recursive: true });
    await writeFile(`${qaDir}/live-source-counts.json`, JSON.stringify(evidence, null, 2));
  }
}
