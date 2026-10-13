import { mkdir, writeFile } from "node:fs/promises";
import { pressConnectivityRecoveryKey } from "./qa-connectivity-recovery.mjs";

const check = (condition, message, detail) => { if (!condition) throw new Error(`${message}: ${JSON.stringify(detail)}`); };

// Runs only in an isolated CI page at the local test origin. The stored IDs
// are public catalog fixtures. No production storage or device data is used.
export function installSavedStorageFixture(origin, ids) {
  if (location.origin !== origin) return;
  const key = "rwn-saved-resources", storage = window.localStorage;
  const read = Storage.prototype.getItem, write = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
  write.call(storage, key, JSON.stringify(ids));
  write.call(storage, "qa-saved-unrelated", "keep");
  const probe = window.__rwnSavedStorageQA = {
    denied: true, writes: 0, clicks: [],
    stored: () => read.call(storage, key),
    unrelated: () => read.call(storage, "qa-saved-unrelated"),
    replace: value => write.call(storage, key, JSON.stringify(value))
  };
  document.addEventListener("click", event => {
    const id = event.target.closest?.("#toggleSaved, #retrySavedServices")?.id;
    if (id) probe.clicks.push({ id, trusted: event.isTrusted });
  }, true);
  Storage.prototype.getItem = function (name) {
    if (this === storage && name === key && probe.denied) throw new DOMException("Synthetic saved read denial", "SecurityError");
    return read.call(this, name);
  };
  Storage.prototype.setItem = function (name, value) {
    if (this === storage && name === key) probe.writes++;
    return write.call(this, name, value);
  };
  Storage.prototype.removeItem = function (name) {
    if (this === storage && name === key) probe.writes++;
    return remove.call(this, name);
  };
}

export async function verifySavedStorage({ client, host, record, navigate, evaluate, capture, waitForUI, qaDir }) {
  const evidence = [];
  const seed = [record.id, "qa-unavailable-record"];
  const installed = await client.call("Page.addScriptToEvaluateOnNewDocument", {
    source: `(${installSavedStorageFixture.toString()})(${JSON.stringify(host)}, ${JSON.stringify(seed)})`
  });
  const snapshot = () => evaluate(client, `(() => {
    const byId = id => document.getElementById(id), probe = window.__rwnSavedStorageQA;
    const save = byId('saveResource'), retry = byId('retrySavedServices');
    return { url: location.href, timeOrigin: performance.timeOrigin, title: document.title, heading: document.querySelector('h1')?.textContent,
      count: byId('savedCount')?.textContent, savedOnly: byId('toggleSaved')?.getAttribute('aria-pressed'),
      status: byId('savedStorageStatus')?.textContent, statusHidden: byId('savedStorageStatus')?.hidden,
      retryVisible: !!retry?.getClientRects().length, retryDisabled: retry?.disabled,
      focus: document.activeElement?.id, query: byId('resourceSearch')?.value,
      results: byId('resourceGrid')?.textContent, resultCount: byId('resultCount')?.textContent,
      cards: [...document.querySelectorAll('#resourceGrid .resource-card')].map(row => row.dataset.resultResourceId || row.querySelector('[data-resource-id]')?.dataset.resourceId),
      save: save ? { disabled: save.disabled, pressed: save.getAttribute('aria-pressed'), label: save.getAttribute('aria-label') } : null,
      stored: probe?.stored(), writes: probe?.writes, unrelated: probe?.unrelated(), clicks: probe?.clicks,
      overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  })()`);
  const activate = async id => {
    const before = await evaluate(client, "window.__rwnSavedStorageQA.clicks.length");
    await evaluate(client, `(() => { const button = document.getElementById(${JSON.stringify(id)}); if (!button || button.disabled || !button.getClientRects().length) throw new Error('Expected an enabled visible control'); button.scrollIntoView({block:'center',behavior:'instant'}); button.focus({preventScroll:true}); })()`);
    await pressConnectivityRecoveryKey(client, "Enter", 13);
    const clicks = await evaluate(client, "window.__rwnSavedStorageQA.clicks");
    check(clicks.length === before + 1 && clicks.at(-1).id === id && clicks.at(-1).trusted, "Recovery control did not receive exactly one trusted activation", clicks);
  };
  try {
    let previousTimeOrigin;
    for (const width of [1440, 390]) {
      await client.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      await navigate(client, "about:blank");
      await navigate(client, `${host}/#resource=${encodeURIComponent(record.id)}`);
      await waitForUI("document.getElementById('savedCount')?.textContent === 'Unavailable' && document.getElementById('saveResource')?.disabled");
      let current = await snapshot();
      check(current.timeOrigin !== previousTimeOrigin, "Each viewport must start a newly seeded document", current);
      previousTimeOrigin = current.timeOrigin;
      check(new URL(current.url).origin === host && current.title && current.heading && current.save?.pressed === null && current.save?.label === "Saving unavailable", "Initial storage denial was presented as known unsaved membership", current);
      check(!current.statusHidden && current.retryVisible && !current.retryDisabled && !current.overflow, "Unreadable Saved state needs visible usable recovery without overflow", current);
      evidence.push({ phase: "initial-denial", width, ...current });

      await evaluate(client, "document.getElementById('resourceSearch').focus()");
      await client.call("Input.insertText", { text: record.name });
      await waitForUI(`document.querySelectorAll('#resourceGrid .resource-card').length === 1 && document.querySelector('#resourceGrid .resource-card')?.dataset.resultResourceId === ${JSON.stringify(record.id)} && document.getElementById('resourceSearch').value === ${JSON.stringify(record.name)} && !/Preparing/.test(document.getElementById('resultCount').textContent)`);
      await activate("toggleSaved");
      await waitForUI("/Saved services are unavailable/.test(document.getElementById('resourceGrid').textContent)");
      for (let i = 0; i < 2; i++) {
        await activate("retrySavedServices");
        current = await snapshot();
        check(current.focus === "retrySavedServices" && current.retryVisible && /unavailable/.test(current.results) && !/No saved services yet/.test(current.results), "Repeated denied Retry lost truthful state or focus", current);
        check(current.stored === JSON.stringify(seed) && current.writes === 0 && current.unrelated === "keep", "A failed read/retry mutated storage", current);
      }
      evidence.push({ phase: "filtered-denial-and-retries", width, ...current });
      await capture(client, `saved-storage-unavailable-${width}.png`);

      await evaluate(client, "window.__rwnSavedStorageQA.denied = false");
      await activate("retrySavedServices");
      await waitForUI("document.getElementById('savedCount').textContent === '1' && document.getElementById('retrySavedServices').hidden");
      current = await snapshot();
      check(current.focus === "toggleSaved" && current.statusHidden && !current.status && current.cards.includes(record.id) && current.query === record.name, "Successful Retry failed to restore saved content, query or focus", current);
      check(!current.overflow && current.writes === 0 && current.stored === JSON.stringify(seed), "Successful read recovery changed persistence or overflowed", current);
      evidence.push({ phase: "populated-recovery", width, ...current });
      await capture(client, `saved-storage-recovered-${width}.png`);

      await evaluate(client, "window.__rwnSavedStorageQA.denied = true; window.dispatchEvent(new PageTransitionEvent('pageshow'))");
      current = await snapshot();
      check(current.count === "Unavailable" && current.cards.includes(record.id) && /previously loaded/.test(current.resultCount) && /out of date/.test(current.status), "Later denial discarded the last loaded list or claimed it was current", current);
      check(current.query === record.name && current.writes === 0 && current.unrelated === "keep", "Later denial changed query or persistent data", current);
      evidence.push({ phase: "later-denial-retains-qualified-rows", width, ...current });

      await evaluate(client, "window.__rwnSavedStorageQA.replace([]); window.__rwnSavedStorageQA.denied = false");
      await activate("retrySavedServices");
      current = await snapshot();
      check(current.count === "0" && current.statusHidden && /No saved services yet/.test(current.results) && current.focus === "toggleSaved", "An actually empty recovered list was not distinguished from unavailable", current);
      evidence.push({ phase: "empty-recovery", width, ...current });
      await evaluate(client, `window.__rwnSavedStorageQA.replace(${JSON.stringify(seed)}); window.dispatchEvent(new StorageEvent('storage', {key:'rwn-saved-resources'}))`);
      current = await snapshot();
      check(current.count === "1" && current.cards.includes(record.id) && current.writes === 0, "Relevant cross-tab recovery did not refresh the saved list", current);
      evidence.push({ phase: "cross-tab-recovery", width, ...current });
    }
    console.log("Saved storage browser QA passed at 1440/390px: initial/later denied reads, trusted search and Retry, unchanged persisted IDs, distinct empty/recovered states and focus continuity.");
  } catch (error) {
    evidence.push({ phase: "failure", error: error.message, ...await snapshot() });
    await capture(client, "saved-storage-failure.png");
    throw error;
  } finally {
    await client.call("Page.removeScriptToEvaluateOnNewDocument", { identifier: installed.identifier });
    await navigate(client, "about:blank");
    await mkdir(qaDir, { recursive: true });
    await writeFile(`${qaDir}/saved-storage-recovery.json`, JSON.stringify(evidence, null, 2));
  }
}
