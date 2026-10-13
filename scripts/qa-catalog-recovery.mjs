import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { SAVED_RESOURCES_KEY } from "../src/utils/privacy.js";
import { createContactFixtureApp } from "./qa-contact-fixture-app.mjs";
import { directoryStartupClickPoint } from "./qa-directory-startup.mjs";
import { pressConnectivityRecoveryKey } from "./qa-connectivity-recovery.mjs";

const check = (value, message, detail) => { if (!value) throw new Error(`${message}: ${JSON.stringify(detail)}`); };

export function catalogRecoverySnapshot(view, savedKey) {
  const visible = node => Boolean(node?.getClientRects().length && !node.hidden && getComputedStyle(node).visibility !== "hidden");
  const retry = document.querySelector(view === "saved" ? "[data-saved-retry]" : "[data-directory-retry]");
  const focus = document.activeElement;
  return {
    href: location.href, timeOrigin: performance.timeOrigin, controller: navigator.serviceWorker.controller?.scriptURL,
    saved: localStorage.getItem(savedKey), query: document.querySelector("[data-directory-query]")?.value,
    help: document.querySelector("[data-directory-need]")?.value,
    message: document.querySelector(view === "saved" ? "[data-saved-summary]" : "[data-directory-count]")?.textContent,
    retry: { visible: visible(retry), busy: retry?.getAttribute("aria-disabled") === "true" },
    focus: { retry: focus === retry, visible: visible(focus), body: focus === document.body,
      restored: view === "saved" ? focus === document.querySelector("[data-saved-services] h2") : focus === document.querySelector("[data-directory-query]") },
    rows: [...document.querySelectorAll(view === "saved" ? "[data-saved-list] .saved-service-row" : ".directory-global-results .directory-global-result-wrap")].map(row => row.dataset.savedId || row.querySelector('a[href^="/service/"]')?.getAttribute("href")),
    workerRequests: performance.getEntriesByType("resource").filter(entry => new URL(entry.name).pathname === "/data/search-index.json").map(entry => ({ workerStart: entry.workerStart, duration: entry.duration })),
    clicks: [...(globalThis.__rwnCatalogQA || [])]
  };
}

export function assertCatalogFailure(state) {
  check(Boolean(state.controller), "Catalog case did not use an active service worker", state);
  check(state.retry.visible && !state.retry.busy && /unavailable|could not load/.test(state.message), "Stalled catalog never reached its failure/Retry state", state);
  check(!state.rows.length, "Failed request retained stale dynamic listings", state);
}

export function assertCatalogRecovered(before, after, count) {
  for (const key of ["href", "timeOrigin", "controller", "saved", "query", "help"]) check(before[key] === after[key], `Recovery changed ${key}`, { before, after });
  check(after.rows.length === count && !after.retry.visible && after.focus.restored && after.focus.visible && !after.focus.body, "Recovery lost results or keyboard focus", after);
  check(after.workerRequests.some(entry => entry.workerStart > 0), "Recovery bypassed the active worker", after);
  check(after.clicks.length >= 2 && after.clicks.every(event => event.trusted), "Retry did not receive native repeated activations", after);
}

// CI-only native browser coverage. The isolated server stalls real HTTP headers
// or body bytes; page fetch, service worker, cache, and deadlines are unchanged.
export async function verifyCatalogRecovery({ client, navigate, evaluate, capture, qaDir = "qa-screenshots" }) {
  const catalogControl = { mode: "healthy", requests: [] };
  const app = await createContactFixtureApp({ catalogControl });
  const evidence = [];
  let label = "startup";
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (expression, message, duration = 12_000) => {
    const end = Date.now() + duration;
    do { if (await evaluate(client, expression)) return; await pause(75); } while (Date.now() < end);
    throw new Error(message);
  };
  const click = async selector => {
    const point = await evaluate(client, `(async()=>{const point=await (${directoryStartupClickPoint})(${JSON.stringify(selector)});globalThis.__rwnDirectoryClickQA.stop();return point;})()`);
    await client.call("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", clickCount: 1 });
    await client.call("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", clickCount: 1 });
  };
  const snapshot = view => evaluate(client, `(${catalogRecoverySnapshot})(${JSON.stringify(view)},${JSON.stringify(SAVED_RESOURCES_KEY)})`);
  try {
    await client.call("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
    await client.call("Network.enable");
    await client.call("Network.setBypassServiceWorker", { bypass: false });
    await client.call("Network.setBlockedURLs", { urls: [] });
    for (const view of ["search", "saved"]) for (const mode of ["hung-headers", "hung-body"]) {
      label = `${view}-${mode}`;
      catalogControl.mode = "healthy";
      // A fresh document resets module caches; keep its URL identical to the
      // real Saved anchor so opening Saved remains same-document navigation.
      await navigate(client, "about:blank");
      await navigate(client, `${app.host}/directory`);
      await wait("Boolean(navigator.serviceWorker.controller) && document.querySelector('[data-directory-need]')?.disabled === false", "Fixture worker did not activate");
      // Reset only the synthetic origin's catalog cache, never any production
      // data. The worker remains active and its real fetch handler is exercised.
      await evaluate(client, `(async()=>{for(const name of await caches.keys()){const cache=await caches.open(name);await cache.delete('/data/search-index.json');}localStorage.setItem(${JSON.stringify(SAVED_RESOURCES_KEY)},${JSON.stringify(JSON.stringify(app.resources.slice(0, 2).map(record => record.id)))});})()`);
      const start = catalogControl.requests.length;
      catalogControl.mode = mode;
      if (view === "saved") await click('a[href="/directory#saved"]');
      else {
        await click("[data-directory-query]");
        await client.call("Input.insertText", { text: "Synthetic" });
      }
      await evaluate(client, "(()=>{globalThis.__rwnCatalogQA=[];document.addEventListener('click',event=>{if(event.target.closest('[data-directory-retry],[data-saved-retry]'))globalThis.__rwnCatalogQA.push({trusted:event.isTrusted});},true);})()");
      const retry = view === "saved" ? "[data-saved-retry]" : "[data-directory-retry]";
      await wait(`!document.querySelector(${JSON.stringify(retry)})?.hidden && document.querySelector(${JSON.stringify(retry)})?.getAttribute('aria-disabled') !== 'true'`, "Stalled catalog never offered Retry");
      const before = await snapshot(view);
      assertCatalogFailure(before);
      const initial = catalogControl.requests.slice(start);
      check(initial.length === 1 && initial[0].mode === mode, "Concurrent initial catalog requests were not coalesced", initial);
      await capture(client, `catalog-recovery-${label}-failed.png`);
      catalogControl.mode = "held-success";
      await click(retry);
      await wait(`document.querySelector(${JSON.stringify(retry)})?.getAttribute('aria-disabled') === 'true'`, "Retry did not expose its pending state");
      await pressConnectivityRecoveryKey(client, "Enter", 13);
      const pending = await snapshot(view);
      check(pending.retry.visible && pending.retry.busy && pending.focus.retry && pending.focus.visible && !pending.focus.body, "Pending retry lost its keyboard focus", pending);
      // The server withholds the successful response until repeated native
      // activation has been checked; this never changes a production timeout.
      await wait(`(${catalogRecoverySnapshot})(${JSON.stringify(view)},${JSON.stringify(SAVED_RESOURCES_KEY)}).clicks.length >= 2`, "Repeated native Retry was not delivered");
      const receivedBy = Date.now() + 2000;
      while (catalogControl.requests.length < start + 2 && Date.now() < receivedBy) await pause(25);
      check(catalogControl.requests.length === start + 2, "Repeated retry started multiple catalog requests", catalogControl.requests.slice(start));
      await catalogControl.release();
      await wait(`document.querySelector(${JSON.stringify(retry)})?.hidden && document.querySelectorAll(${JSON.stringify(view === "saved" ? "[data-saved-list] .saved-service-row" : ".directory-global-results .directory-global-result-wrap")}).length > 0`, "Healthy catalog retry did not recover");
      const after = await snapshot(view);
      assertCatalogRecovered(before, after, view === "saved" ? 2 : app.resources.length);
      check(initial[0].closed, "Timed-out catalog transport was not canceled", initial);
      evidence.push({ label, before, pending, after, requests: catalogControl.requests.slice(start) });
      await capture(client, `catalog-recovery-${label}-recovered.png`);
    }
    await mkdir(qaDir, { recursive: true });
    await writeFile(join(qaDir, "catalog-recovery.json"), JSON.stringify(evidence, null, 2));
  } catch (error) {
    evidence.push({ label, error: error.message });
    await mkdir(qaDir, { recursive: true });
    await writeFile(join(qaDir, "catalog-recovery-failure.json"), JSON.stringify(evidence, null, 2));
    await capture(client, "catalog-recovery-failure.png").catch(() => {});
    throw error;
  } finally {
    if (await evaluate(client, `location.origin === ${JSON.stringify(app.host)}`).catch(() => false)) {
      await evaluate(client, "(async()=>{for(const registration of await navigator.serviceWorker.getRegistrations())await registration.unregister();})()").catch(() => {});
    }
    await navigate(client, "about:blank").catch(() => {});
    await app.cleanup();
  }
}
