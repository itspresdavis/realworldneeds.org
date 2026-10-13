import { mkdir, readFile, writeFile } from "node:fs/promises";

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (condition, message, detail) => {
  if (!condition) throw new Error(`${message}: ${JSON.stringify(detail)}`);
};

// Appended only to the generated module during this sequential CI verifier.
// Exposes primitive observations, never a state reference or a setter.
export const countryStateProbeSource = `
if (window.__rwnLiveCountQA) Object.defineProperty(window.__rwnLiveCountQA, "countryState", {
  get: () => Object.freeze({
    coarseFeatures: state.countryFeatures.length,
    detailFeatures: state.detailCountryFeatures.length,
    detailGeometryReady: state.detailGeometryReady,
    userCountry: state.userCountry
  })
});
`;

export async function withCountryStateProbe(run, appPath = new URL("../dist/src/app.js", import.meta.url)) {
  const original = await readFile(appPath);
  const source = original.toString("utf8");
  if (!source.includes("const state = {") || source.includes("__rwnLiveCountQA")) throw new Error("Expected the uninstrumented generated app module");
  try {
    await writeFile(appPath, source + countryStateProbeSource);
    return await run();
  } finally {
    await writeFile(appPath, original);
  }
}

// CI-only response fixture. Never queries a device location or the live source.
// Serialized into the temporary QA page; it does not ship with the application.
export function installLiveSourceCountFixture(origin) {
  if (location.origin !== origin) return;
  const nativeFetch = window.fetch.bind(window);
  const pending = [], pendingBodies = [];
  let finishDetail;
  const probe = window.__rwnLiveCountQA = { requests: [], clicks: [], geometryLoads: [], detailReleased: false, locationCalls: 0, position: { latitude: 40, longitude: -75 }, scenario: { count: 0, nearby: 0 } };
  probe.releaseDetail = () => { probe.detailReleased = true; finishDetail?.(); };
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: {
    getCurrentPosition(success) {
      probe.locationCalls += 1;
      const position = { ...probe.position, accuracy: 1000 };
      queueMicrotask(() => success({ coords: position }));
    },
  } });
  const features = scenario => Array.from({ length: scenario.nearby || 0 }, (_, index) => ({
    attributes: { FID: `qa-${index}`, Site_Name: `Synthetic QA meal site ${index + 1}`, Site_City: "Synthetic QA", Site_State: "PA", Site_Address1: "Fictional example only" },
    geometry: { x: -75, y: 40 },
  }));
  window.fetch = (input, options = {}) => {
    const url = new URL(input instanceof Request ? input.url : input, location.href);
    const isUsda = url.origin === "https://services1.arcgis.com" && url.pathname.includes("Summer_Meals_Site_Finder_2026_") && url.pathname.endsWith("/FeatureServer/0/query");
    if (!isUsda) {
      // Preserve both complete map responses byte-for-byte. Hold detail until
      // coarse-country evidence is captured, then let the real loader apply it.
      if (url.origin === origin && ["/data/countries.geojson", "/data/countries-detail.geojson"].includes(url.pathname)) {
        return nativeFetch(input, options).then(async response => {
          if (!response.ok) return response;
          const data = await response.clone().json();
          probe.geometryLoads.push({ path: url.pathname, features: data.features.length });
          if (url.pathname === "/data/countries-detail.geojson" && !probe.detailReleased) await new Promise(resolve => { finishDetail = resolve; });
          return response;
        });
      }
      if (url.origin !== origin) return Promise.reject(new Error("External request blocked in synthetic USDA QA"));
      return nativeFetch(input, options);
    }
    const kind = url.searchParams.get("returnCountOnly") === "true" ? "count" : "nearby";
    // Pin scenario data to the request, so replacement searches cannot rewrite
    // old responses waiting for headers or body completion.
    const scenario = { ...probe.scenario };
    const request = { id: probe.requests.length, kind, geometry: url.searchParams.get("geometry"), headersReleased: false, bodyPending: false, bodyReleased: false, aborted: false, bodyCanceled: false, bodyReleaseAttempts: 0 };
    probe.requests.push(request);
    return new Promise((resolve, reject) => {
      let finished = false, bodyController;
      const cleanup = () => options.signal?.removeEventListener("abort", abort);
      const abort = () => {
        if (finished) return;
        finished = true;
        request.aborted = true;
        request.bodyPending = false;
        cleanup();
        const error = new DOMException("Aborted", "AbortError");
        if (bodyController) bodyController.error(error);
        else reject(error);
      };
      if (options.signal?.aborted) return abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      const releaseHeaders = () => {
        if (finished || request.headersReleased) return;
        request.headersReleased = true;
        const failed = scenario[`${kind}Failed`];
        const payload = failed ? { error: { code: 400 } } : kind === "count" ? { count: scenario.count } : { features: features(scenario), ...(scenario.nearbyTruncated ? { exceededTransferLimit: true } : {}) };
        const json = JSON.stringify(payload), split = Math.max(1, Math.floor(json.length / 2));
        const encoder = new TextEncoder();
        const releaseBody = () => {
          request.bodyReleaseAttempts += 1;
          if (finished) return;
          finished = true;
          request.bodyPending = false;
          request.bodyReleased = true;
          cleanup();
          bodyController.enqueue(encoder.encode(json.slice(split)));
          bodyController.close();
        };
        const body = new ReadableStream({
          start(controller) {
            bodyController = controller;
            controller.enqueue(encoder.encode(json.slice(0, split)));
            if (scenario[`${kind}BodyPending`]) {
              request.bodyPending = true;
              pendingBodies.push({ request, finish: releaseBody });
            } else releaseBody();
          },
          cancel() {
            finished = true;
            request.bodyPending = false;
            request.bodyCanceled = true;
            cleanup();
          },
        });
        resolve(new Response(body, { status: failed ? 400 : 200, headers: { "Content-Type": "application/json" } }));
      };
      if (scenario.autoHeaders) queueMicrotask(releaseHeaders);
      else pending.push({ request, finish: releaseHeaders });
    });
  };
  const release = (queue, ids) => {
    for (const entry of queue.splice(0)) {
      if (!ids || ids.includes(entry.request.id)) entry.finish();
      else queue.push(entry);
    }
  };
  probe.release = ids => release(pending, ids);
  probe.releaseBodies = ids => release(pendingBodies, ids);
  document.addEventListener("click", event => {
    const control = event.target.closest?.("button, summary");
    const id = control?.matches(".finder-location-notes summary") ? "about" : control?.id;
    if (["locateMe", "clearLocation", "about"].includes(id)) probe.clicks.push({ id, trusted: event.isTrusted });
  }, true);
  document.addEventListener("DOMContentLoaded", () => {
    const banner = document.createElement("aside");
    banner.textContent = "SYNTHETIC QA: test USDA responses and locations with the complete unchanged world maps. Do not contact examples.";
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
    locationStatus: document.getElementById("locationStatus")?.textContent,
    finder: {
      query: document.getElementById("resourceSearch")?.value,
      filterSummary: document.getElementById("filterSummary")?.textContent,
      resultCount: document.getElementById("resultCount")?.textContent,
      filters: [...document.querySelectorAll("[data-type], [data-access], #toggleSaved")].map(control => ({ key: control.dataset.type || control.dataset.access || control.id, pressed: control.getAttribute("aria-pressed") })),
      selection: document.querySelector(".resource-card.is-selected [data-resource-id]")?.dataset.resourceId || null,
      inspector: document.getElementById("resourcePanelHeading")?.textContent,
      historySelection: history.state?.rwnFinder?.selectedId || null,
      activeControl: document.activeElement?.id || document.activeElement?.tagName,
      notification: document.getElementById("statusToast")?.textContent,
    },
    probe: window.__rwnLiveCountQA && { requests: window.__rwnLiveCountQA.requests, clicks: window.__rwnLiveCountQA.clicks, locationCalls: window.__rwnLiveCountQA.locationCalls, geometryLoads: window.__rwnLiveCountQA.geometryLoads, detailReleased: window.__rwnLiveCountQA.detailReleased, countryState: window.__rwnLiveCountQA.countryState },
  };
}

// Runs in the existing GitHub browser suite. No browser is launched here.
export async function verifyLiveSourceCounts(options) {
  return withCountryStateProbe(() => verifyLiveSourceCountsInFixture(options));
}

async function verifyLiveSourceCountsInFixture({ client, host, navigate, evaluate, capture, qaDir = "qa-screenshots" }) {
  const evidence = [];
  let currentCase = "setup";
  const wait = async (expression, label, attempts = 100) => {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
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
      await wait("window.__rwnLiveCountQA.countryState?.coarseFeatures > 1", "complete coarse geometry applied");
      const initial = await snapshot();
      check(initial.href === `${host}/` && initial.title && initial.reach === undefined && !initial.disclosureOpen && !initial.statusVisible, "Enhanced finder must retain its collapsed disclosure and removed base reach strip", initial);
      check(initial.probe.countryState.detailGeometryReady === false && initial.probe.countryState.userCountry === null, "The first location must start with coarse geometry and no country", initial);
      evidence.push({ label: `initial-${width}`, ...initial });
      for (const scenario of [
        { label: "zero", count: 0, nearby: 0 },
        { label: "positive", count: 100, nearby: 1 },
        { label: "national-unavailable", countFailed: true, nearby: 0 },
        { label: "nearby-unavailable", count: 200, nearbyFailed: true },
        { label: "malformed-national", count: null, nearby: 1 },
        { label: "truncated-nearby", count: 201, nearby: 1, nearbyTruncated: true },
      ]) {
        currentCase = `${scenario.label}-${width}`;
        await evaluate(client, `window.__rwnLiveCountQA.scenario=${JSON.stringify(scenario)}`);
        const before = await snapshot();
        await activate("locateMe");
        await wait(`window.__rwnLiveCountQA.requests.length === ${before.probe.requests.length + 2}`, "both synthetic requests");
        const loading = await snapshot();
        check(loading.probe.countryState.userCountry === "United States" && loading.probe.countryState.detailGeometryReady === (scenario.label !== "zero"), "Full-world country lookup changed before/after detailed geometry", loading);
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
        check(settled.probe.countryState.userCountry === "United States" && /Resource finders for United States appear/.test(settled.locationStatus), "The rendered location status must retain the detected U.S. country", settled);
        check(settled.role === "status" && settled.live === "polite" && settled.atomic === "true", "Count status lacks polite live-region markup (screen-reader delivery is not asserted)", settled);
        check(settled.statusVisible && settled.disclosureOpen && settled.statusBox?.width > 0 && settled.statusBox.height > 0 && settled.overflow <= 1 && !settled.external.length, "Count fixture has hidden content, overflow, or an external request", settled);
        if (scenario.label === "zero") check(/No current USDA meal sites were returned/.test(settled.status) && /USDA lists 0 meal sites as active nationally today/.test(settled.status), "Zero count was not rendered truthfully", settled);
        if (scenario.label === "positive") check(/Loaded 1 current USDA meal site nearby/.test(settled.status) && /USDA lists 100 meal sites as active nationally today/.test(settled.status), "Loaded nearby and national counts were conflated", settled);
        if (scenario.label === "national-unavailable") check(/No current USDA meal sites were returned/.test(settled.status) && /National count unavailable/.test(settled.status), "Unknown national count became a zero or old count", settled);
        if (scenario.label === "nearby-unavailable") check(/could not be loaded/.test(settled.status) && /USDA lists 200 meal sites as active nationally today/.test(settled.status), "Nearby failure hid an independent national success", settled);
        if (scenario.label === "malformed-national") check(/Loaded 1 current USDA meal site nearby/.test(settled.status) && /National count unavailable/.test(settled.status) && !/USDA lists 0/.test(settled.status), "Malformed count must remain unavailable while valid nearby records survive", settled);
        if (scenario.label === "truncated-nearby") check(/could not be loaded/.test(settled.status) && /USDA lists 201 meal sites as active nationally today/.test(settled.status) && !/Loaded 1 current/.test(settled.status), "Truncated nearby response must not claim completeness or hide the independent count", settled);
        evidence.push({ label: `${scenario.label}-${width}`, loading, settled });
        await evaluate(client, "document.getElementById('liveSourceStatus').scrollIntoView({block:'center'})");
        await capture(client, `live-counts-${scenario.label}-${width}.png`);
        await activate("clearLocation");
        const cleared = await snapshot();
        check(/In the United States, location search/.test(cleared.status) && !/active nationally today/.test(cleared.status), "Clear retained a current-count claim", cleared);
        evidence.push({ label: `clear-${scenario.label}-${width}`, ...cleared });
        if (scenario.label === "zero") {
          await evaluate(client, "window.__rwnLiveCountQA.releaseDetail(); document.querySelector('.globe-stage').scrollIntoView({block:'center'})");
          await wait("window.__rwnLiveCountQA.countryState?.detailGeometryReady === true", "real detailed geometry applied before repeated Use", 200);
          const detailed = await snapshot();
          check(detailed.probe.countryState.detailFeatures > 1 && detailed.probe.geometryLoads.some(entry => entry.path === "/data/countries-detail.geojson" && entry.features === detailed.probe.countryState.detailFeatures), "Detailed readiness must correspond to the complete observed map response", detailed);
          evidence.push({ label: `detail-applied-${width}`, ...detailed });
        }
      }
      // Use only the same trusted Use/Clear controls. Use is intentionally inert
      // while busy, so a replacement search is Clear followed by Use.
      const unchangedAfterLateResponse = (before, after, label) => {
        for (const key of ["status", "locationStatus", "locateBusy", "href", "finder"]) {
          check(JSON.stringify(before[key]) === JSON.stringify(after[key]), `${label}: late response changed ${key}`, { before: before[key], after: after[key] });
        }
        check(before.probe.countryState.userCountry === after.probe.countryState.userCountry, `${label}: late response changed country`, after);
      };
      for (const phase of ["headers", "body"]) {
        for (const replace of [false, true]) {
          currentCase = `${replace ? "replace" : "clear"}-pending-${phase}-${width}`;
          await evaluate(client, `window.__rwnLiveCountQA.scenario=${JSON.stringify({ count: 31337, nearby: 2, countBodyPending: true, nearbyBodyPending: true })}`);
          const before = await snapshot(), firstId = before.probe.requests.length;
          const oldIds = [firstId, firstId + 1];
          await activate("locateMe");
          await wait(`window.__rwnLiveCountQA.requests.length === ${firstId + 2}`, "interrupted request pair started");
          if (phase === "body") {
            await evaluate(client, `window.__rwnLiveCountQA.release(${JSON.stringify(oldIds)})`);
            await wait(`window.__rwnLiveCountQA.requests.slice(${firstId}).every(request => request.headersReleased && request.bodyPending)`, "both real response bodies are pending");
          }
          const pending = await snapshot();
          check(pending.locateBusy && /Checking USDA/.test(pending.status) && !/active nationally today/.test(pending.status), "Pending response must still render loading", pending);
          await activate("clearLocation");
          await wait(`window.__rwnLiveCountQA.requests.slice(${firstId}, ${firstId + 2}).every(request => request.aborted)`, "Clear aborted both transports");
          const cleared = await snapshot();
          check(!cleared.locateBusy && /In the United States, location search/.test(cleared.status) && !/active nationally today/.test(cleared.status) && cleared.probe.countryState.userCountry === null, "Clear did not immediately restore idle", cleared);
          let expected = cleared;
          if (replace) {
            await evaluate(client, 'window.__rwnLiveCountQA.scenario={count:202,nearby:1}');
            await activate("locateMe");
            await wait(`window.__rwnLiveCountQA.requests.length === ${firstId + 4}`, "replacement request pair started");
            await evaluate(client, `window.__rwnLiveCountQA.release(${JSON.stringify([firstId + 2, firstId + 3])})`);
            await wait("!document.getElementById('locateMe').classList.contains('is-loading')", "replacement source settled");
            expected = await snapshot();
            check(/Loaded 1 current USDA meal site nearby/.test(expected.status) && /USDA lists 202 meal sites as active nationally today/.test(expected.status), "Replacement did not settle with its own payload", expected);
          }
          await evaluate(client, `window.__rwnLiveCountQA.release(${JSON.stringify(oldIds)}); window.__rwnLiveCountQA.releaseBodies(${JSON.stringify(oldIds)})`);
          await pause(100);
          const late = await snapshot();
          unchangedAfterLateResponse(expected, late, currentCase);
          check(!/31337|31,337/.test(late.status) && !late.external.length, "An old response claimed success or reached the network", late);
          evidence.push({ label: currentCase, pending, cleared, ...(replace ? { replacement: expected } : {}), late });
          if (replace) await activate("clearLocation");
        }
      }
      if (width === 1440) {
        // One complete 3 × 7 s body-timeout path plus 250/750 ms backoff.
        // Retry headers auto-release; each real body remains open until aborted.
        currentCase = `body-timeout-${width}`;
        const before = await snapshot(), firstId = before.probe.requests.length;
        await evaluate(client, 'window.__rwnLiveCountQA.scenario={count:999,nearby:1,countBodyPending:true,autoHeaders:true}');
        const started = Date.now();
        await activate("locateMe");
        await wait(`window.__rwnLiveCountQA.requests.slice(${firstId}).some(request => request.kind === 'count' && request.headersReleased && request.bodyPending)`, "count headers arrived with real body pending");
        const loading = await snapshot();
        check(loading.locateBusy && /Checking USDA/.test(loading.status), "A pending count body stopped loading too early", loading);
        await wait("!document.getElementById('locateMe').classList.contains('is-loading')", "bounded three-attempt body timeout", 540);
        const settled = await snapshot(), elapsedMs = Date.now() - started;
        const countAttempts = settled.probe.requests.slice(firstId).filter(request => request.kind === "count");
        check(countAttempts.length === 3 && countAttempts.every(request => request.headersReleased && request.aborted && !request.bodyReleased && !request.bodyPending), "Timeout did not abort all three real body attempts", countAttempts);
        check(elapsedMs >= 21500 && elapsedMs <= 28000, "Body timeout exceeded the 22-second logical budget plus CI scheduling allowance", { elapsedMs });
        check(/Loaded 1 current USDA meal site nearby/.test(settled.status) && /National count unavailable/.test(settled.status) && !settled.external.length, "Count body timeout discarded an independent nearby success", settled);
        evidence.push({ label: currentCase, elapsedMs, loading, settled });
        await evaluate(client, "document.getElementById('liveSourceStatus').scrollIntoView({block:'center'})");
        await capture(client, `live-counts-body-timeout-${width}.png`);
        await activate("clearLocation");
        await evaluate(client, 'window.__rwnLiveCountQA.scenario={count:203,nearby:1,autoHeaders:true}');
        await activate("locateMe");
        await wait("!document.getElementById('locateMe').classList.contains('is-loading')", "valid request recovered after body timeout");
        const recovered = await snapshot();
        check(/Loaded 1 current USDA meal site nearby/.test(recovered.status) && /USDA lists 203 meal sites as active nationally today/.test(recovered.status), "A valid search did not recover after timeout", recovered);
        await evaluate(client, `window.__rwnLiveCountQA.releaseBodies(${JSON.stringify(countAttempts.map(request => request.id))})`);
        await pause(100);
        const late = await snapshot();
        unchangedAfterLateResponse(recovered, late, "timed-out body after recovery");
        evidence.push({ label: `body-timeout-recovery-${width}`, recovered, late });
        await activate("clearLocation");
      }
      const beforeNonUs = await snapshot();
      await evaluate(client, "window.__rwnLiveCountQA.position = { latitude: 51.5, longitude: -0.12 }");
      await activate("locateMe");
      await wait(`window.__rwnLiveCountQA.locationCalls === ${beforeNonUs.probe.locationCalls + 1} && !document.getElementById('locateMe').classList.contains('is-loading')`, "synthetic non-U.S. location settled");
      const nonUs = await snapshot();
      check(nonUs.probe.countryState.userCountry === "United Kingdom" && /Resource finders for United Kingdom appear/.test(nonUs.locationStatus), "Known non-U.S. control must detect the United Kingdom", nonUs);
      check(nonUs.probe.requests.length === beforeNonUs.probe.requests.length && /USDA meal-site information covers the United States/.test(nonUs.status) && !nonUs.external.length, "Non-U.S. country lookup must not request USDA or keep an old national count", nonUs);
      evidence.push({ label: `non-us-no-source-request-${width}`, ...nonUs });
      await evaluate(client, "document.getElementById('liveSourceStatus').scrollIntoView({block:'center'})");
      await capture(client, `live-counts-non-us-${width}.png`);
      await activate("clearLocation");
      const final = await snapshot();
      check(final.probe.geometryLoads.length >= 2 && final.probe.geometryLoads.every(entry => entry.features > 1), "The complete coarse and detailed world maps must be used", final);
      evidence.push({ label: `full-world-geometry-${width}`, geometryLoads: final.probe.geometryLoads, countryState: final.probe.countryState });
      console.log(`USDA count presentation and country routing passed at ${width}px: full-world coarse/detail U.S. lookup, non-U.S. no-query control, zero, positive, independent failures, malformed count, truncated nearby, interrupted headers/bodies, timeout/recovery (desktop), loading, Clear, trusted keyboard, open/closed disclosure and no external source requests.`);
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
