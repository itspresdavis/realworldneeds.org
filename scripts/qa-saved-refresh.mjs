import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pressConnectivityRecoveryKey } from "./qa-connectivity-recovery.mjs";

const check = (condition, message, detail) => { if (!condition) throw new Error(`${message}: ${JSON.stringify(detail)}`); };
export const SAVED_REFRESH_WIDTHS = [1440, 390];
export const SAVED_REFRESH_COUNTS = [61, 121];

// Serialized only into the isolated local CI document. Application event
// listeners, catalog loader, request deadline and rendering stay unchanged.
// The controllerchange is synthetic; subsequent Enter/Tab input is native.
export function installSavedRefreshFixture(origin, ids, records) {
  if (location.origin !== origin || !["127.0.0.1", "localhost"].includes(location.hostname)) return;
  const key = "rwn-saved-resources", storage = window.localStorage;
  const read = Storage.prototype.getItem, write = Storage.prototype.setItem;
  const remove = Storage.prototype.removeItem, clear = Storage.prototype.clear;
  const nativeFetch = window.fetch.bind(window);
  write.call(storage, key, JSON.stringify(ids));
  write.call(storage, "qa-saved-refresh-unrelated", "keep");
  let currentRecords = records, held = false;
  const pending = new Set();
  const values = () => Object.fromEntries(Array.from({ length: storage.length }, (_, index) => storage.key(index)).sort().map(name => [name, read.call(storage, name)]));
  const response = () => new Response(JSON.stringify({ records: currentRecords, scopes: {} }), { headers: { "Content-Type": "application/json" } });
  const probe = window.__rwnSavedRefreshQA = {
    phase: 0, controllerChanges: 0, requests: [], writes: [], clicks: [], keys: [], baseline: values(),
    stored: () => read.call(storage, key), values,
    get pending() { return pending.size; },
    begin() {
      if (held || pending.size) throw new Error("A catalog refresh is already pending");
      if (!navigator.serviceWorker) throw new Error("The Saved controllerchange target is unavailable");
      held = true;
      this.phase++;
      navigator.serviceWorker.dispatchEvent(new Event("controllerchange"));
    },
    release({ withdrawn = [], withoutPhone = [] } = {}) {
      if (!held || !pending.size) throw new Error("No controllerchange catalog request was held");
      currentRecords = currentRecords.filter(record => !withdrawn.includes(record.id))
        .map(record => withoutPhone.includes(record.id) ? { ...record, phoneLinks: [] } : record);
      held = false;
      for (const entry of [...pending]) entry.finish();
    }
  };
  navigator.serviceWorker?.addEventListener("controllerchange", () => { probe.controllerChanges++; });
  for (const [method, original] of [["setItem", write], ["removeItem", remove], ["clear", clear]]) {
    Storage.prototype[method] = function (...args) {
      if (this === storage) probe.writes.push({ method, key: args[0] ?? null });
      return original.apply(this, args);
    };
  }
  document.addEventListener("click", event => {
    const target = event.target.closest?.("a, button");
    if (target) probe.clicks.push({ phase: probe.phase, more: target.matches("[data-saved-more]"), href: target.getAttribute("href"), trusted: event.isTrusted });
  }, true);
  document.addEventListener("keydown", event => {
    if (["Enter", "Tab"].includes(event.key)) probe.keys.push({ phase: probe.phase, key: event.key, trusted: event.isTrusted });
  }, true);
  window.fetch = (input, options = {}) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url, location.href);
    if (url.origin !== origin || url.pathname !== "/data/search-index.json") return nativeFetch(input, options);
    const request = { phase: probe.phase, cache: options.cache, status: held ? "held" : "fulfilled" };
    probe.requests.push(request);
    if (!held) return Promise.resolve(response());
    return new Promise((resolve, reject) => {
      const signal = options.signal;
      const cleanup = () => { pending.delete(entry); signal?.removeEventListener("abort", abort); };
      const abort = () => { cleanup(); request.status = "aborted"; reject(new DOMException("Fixture catalog request aborted", "AbortError")); };
      const entry = { finish() { cleanup(); request.status = "fulfilled"; resolve(response()); } };
      pending.add(entry);
      if (signal?.aborted) abort();
      else signal?.addEventListener("abort", abort, { once: true });
    });
  };
}

export function savedRefreshSnapshot() {
  const probe = window.__rwnSavedRefreshQA, focused = document.activeElement;
  const list = document.querySelector("[data-saved-list]");
  const rows = [...(list?.children || [])];
  return {
    url: location.href, timeOrigin: performance.timeOrigin, title: document.title,
    phase: probe?.phase, controllerChanges: probe?.controllerChanges, pending: probe?.pending,
    requests: probe?.requests, keys: probe?.keys, clicks: probe?.clicks, writes: probe?.writes,
    baseline: probe?.baseline, storage: probe?.values(), stored: probe?.stored(),
    loading: /Loading/.test(document.querySelector("[data-saved-summary]")?.textContent),
    summary: document.querySelector("[data-saved-summary]")?.textContent,
    moreHidden: document.querySelector("[data-saved-more]")?.hidden,
    rows: rows.map(row => ({ id: row.dataset.savedId, unavailable: !row.querySelector(".directory-global-result"),
      removable: row.querySelector("[data-saved-remove]")?.dataset.savedRemove === row.dataset.savedId,
      unavailableMessage: /no longer in the current directory/.test(row.textContent), actions: row.querySelectorAll("a, button").length })),
    focus: { row: focused?.closest?.("[data-saved-id]")?.dataset.savedId || null,
      id: focused?.id || "", tag: focused?.tagName, href: focused?.getAttribute("href"), className: focused?.getAttribute("class"),
      remove: focused?.getAttribute("data-saved-remove"), connected: Boolean(focused?.isConnected),
      visible: Boolean(focused?.getClientRects().length), body: focused === document.body,
      outside: !list?.contains(focused) },
    outsideSameNode: Boolean(probe?.outsideTarget && focused === probe.outsideTarget),
    overflow: document.documentElement.scrollWidth > innerWidth + 1
  };
}

export function assertSavedRefreshRetained(before, after, { ids, unavailable, outside = false }) {
  check(before.pending === 1 && before.loading && before.controllerChanges > 0, "Interaction did not occur during a held controllerchange refresh", before);
  const requests = before.requests.filter(request => request.phase === before.phase);
  check(requests.length === 1 && requests[0].cache === "reload" && requests[0].status === "held", "The actual controllerchange handler did not reset the catalog loader", requests);
  const keys = before.keys.filter(event => event.phase === before.phase);
  check(keys.length > 0 && keys.every(event => event.trusted) && before.clicks.every(event => event.trusted && event.more && !event.href), "Pending refresh input was not trusted or activated a listing link", before);
  for (const field of ["url", "timeOrigin", "title", "phase", "controllerChanges"]) check(before[field] === after[field], `Refresh changed ${field}`, { before: before[field], after: after[field] });
  const settled = after.requests.filter(request => request.phase === after.phase);
  check(settled.length === 1 && settled[0].status === "fulfilled" && settled[0].cache === "reload", "Held catalog response did not fulfill", settled);
  check(after.pending === 0 && !after.loading && after.moreHidden && !after.overflow, "Refresh failed to settle the expanded list", after);
  check(JSON.stringify(before.rows.map(row => row.id)) === JSON.stringify(ids) && JSON.stringify(after.rows.map(row => row.id)) === JSON.stringify(ids), "Pending refresh collapsed, reordered or pruned saved rows", { expected: ids, before: before.rows, after: after.rows });
  check(after.rows.every(row => row.removable && (!row.unavailable || row.unavailableMessage)) && JSON.stringify(after.rows.filter(row => row.unavailable).map(row => row.id).sort()) === JSON.stringify([...unavailable].sort()), "Fresh catalog withdrawal or removable unavailable saved membership was lost", after.rows);
  check(JSON.stringify(after.focus) === JSON.stringify(before.focus) && after.focus.connected && after.focus.visible && !after.focus.body, "Refresh replaced the latest row/control focus with stale or detached focus", { before: before.focus, after: after.focus });
  if (outside) check(before.focus.outside && before.outsideSameNode && after.outsideSameNode, "Refresh stole the newer focus outside Saved results", { before, after });
  for (const state of [before, after]) {
    check(state.writes.length === 0 && state.stored === JSON.stringify(ids) && JSON.stringify(state.storage) === JSON.stringify(state.baseline), "Read-only catalog refresh wrote or pruned saved/unrelated storage", state);
  }
}

export async function verifySavedRefresh({ client, host, records, navigate, evaluate, capture, waitForUI, qaDir }) {
  check(records.length >= 120 && new Set(records.slice(0, 120).map(record => record.id)).size === 120, "Saved refresh QA needs 120 distinct catalog fixtures");
  const evidence = [];
  const snapshot = () => evaluate(client, `(${savedRefreshSnapshot.toString()})()`);
  const focus = selector => evaluate(client, `(() => { const target = document.querySelector(${JSON.stringify(selector)}); if (!target?.getClientRects().length) throw new Error('Expected visible focus fixture'); target.scrollIntoView({block:'center',behavior:'instant'}); target.focus({preventScroll:true}); })()`);
  const row = id => `[data-saved-id=${JSON.stringify(id)}]`;
  const key = name => pressConnectivityRecoveryKey(client, name, name === "Tab" ? 9 : 13);
  const begin = async () => {
    await evaluate(client, "window.__rwnSavedRefreshQA.begin()");
    await waitForUI("window.__rwnSavedRefreshQA.pending === 1 && /Loading/.test(document.querySelector('[data-saved-summary]').textContent)");
  };
  let installed, label = "startup";
  try {
    for (const width of SAVED_REFRESH_WIDTHS) for (const count of SAVED_REFRESH_COUNTS) {
      label = `${width}-${count}`;
      const selected = records.slice(0, count - 1);
      // Put a record with a phone action second so removing that preceding
      // action also verifies stable View details identity, never its old index.
      const phoneIndex = selected.findIndex(record => record.phoneLinks?.length);
      check(phoneIndex >= 0, "Saved refresh QA needs one public phone-action fixture");
      [selected[1], selected[phoneIndex]] = [selected[phoneIndex], selected[1]];
      const unknown = "qa-saved-refresh-unavailable", ids = selected.map(record => record.id);
      ids.splice(10, 0, unknown);
      const withdrawn = ids[3], controlId = ids[1];
      installed = await client.call("Page.addScriptToEvaluateOnNewDocument", {
        source: `(${installSavedRefreshFixture.toString()})(${JSON.stringify(host)},${JSON.stringify(ids)},${JSON.stringify(selected)})`
      });
      await client.call("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      await navigate(client, "about:blank");
      await navigate(client, `${host}/directory#saved`);
      await waitForUI("document.querySelectorAll('[data-saved-id]').length === 60 && !document.querySelector('[data-saved-more]').hidden");
      const initial = await snapshot();
      check(initial.rows.map(item => item.id).join() === ids.slice(0, 60).join() && !initial.loading && initial.writes.length === 0, "Fresh Saved fixture did not start with exactly the first page", initial);

      await focus(`${row(ids[0])} .directory-global-result`);
      await begin();
      const pages = Math.ceil(count / 60) - 1;
      for (let page = 0; page < pages; page++) {
        await focus("[data-saved-more]");
        await key("Enter");
        await waitForUI(`document.querySelectorAll('[data-saved-id]').length === ${Math.min(count, 60 * (page + 2))}`);
      }
      let before = await snapshot();
      check(before.focus.row === ids[60 * pages] && before.focus.className === "directory-global-result" && before.clicks.length === pages, "Trusted Show more did not focus the first newly revealed row", before);
      await evaluate(client, `window.__rwnSavedRefreshQA.release({withdrawn:[${JSON.stringify(withdrawn)}]})`);
      await waitForUI("! /Loading/.test(document.querySelector('[data-saved-summary]').textContent)");
      let after = await snapshot();
      assertSavedRefreshRetained(before, after, { ids, unavailable: [unknown, withdrawn] });
      evidence.push({ label, phase: "expanded-during-refresh", initial, before, after });
      await capture(client, `saved-refresh-expanded-${label}.png`);

      await focus(`${row(ids[0])} [data-saved-remove]`);
      await begin();
      // Native Tab, rather than .focus(), owns the newer row and control.
      const details = `${row(controlId)} .is-details`;
      for (let tabs = 0; tabs < 12; tabs++) {
        await key("Tab");
        if (await evaluate(client, `document.activeElement.matches(${JSON.stringify(details)})`)) break;
      }
      before = await snapshot();
      check(before.focus.row === controlId && before.focus.className === "is-details", "Native Tab did not reach the next row's View details control", before);
      await evaluate(client, `window.__rwnSavedRefreshQA.release({withoutPhone:[${JSON.stringify(controlId)}]})`);
      await waitForUI("! /Loading/.test(document.querySelector('[data-saved-summary]').textContent)");
      after = await snapshot();
      assertSavedRefreshRetained(before, after, { ids, unavailable: [unknown, withdrawn] });
      check(after.rows[1].actions < before.rows[1].actions, "Control-identity fixture did not remove the preceding phone action", { before: before.rows[1], after: after.rows[1] });
      evidence.push({ label, phase: "newer-row-and-control", before, after });

      await focus(`${row(ids.at(-1))} [data-saved-remove]`);
      await begin();
      await key("Tab");
      await evaluate(client, "window.__rwnSavedRefreshQA.outsideTarget = document.activeElement");
      before = await snapshot();
      check(before.focus.outside && !before.focus.body && before.focus.visible, "Native Tab did not leave Saved results", before);
      await evaluate(client, "window.__rwnSavedRefreshQA.release()");
      await waitForUI("! /Loading/.test(document.querySelector('[data-saved-summary]').textContent)");
      after = await snapshot();
      assertSavedRefreshRetained(before, after, { ids, unavailable: [unknown, withdrawn], outside: true });
      evidence.push({ label, phase: "newer-outside-focus", before, after });
      await capture(client, `saved-refresh-outside-${label}.png`);
      await client.call("Page.removeScriptToEvaluateOnNewDocument", { identifier: installed.identifier });
      installed = null;
    }
    console.log("Saved refresh browser QA passed at 1440/390px: held controllerchange, trusted 60→61/multi-page expansion, latest row/control/outside focus, source withdrawal and unchanged local storage.");
  } catch (error) {
    evidence.push({ label, phase: "failure", error: error.message, snapshot: await snapshot().catch(() => null) });
    await capture(client, "saved-refresh-failure.png").catch(() => {});
    throw error;
  } finally {
    try {
      if (installed) await client.call("Page.removeScriptToEvaluateOnNewDocument", { identifier: installed.identifier });
    } finally {
      try { await navigate(client, "about:blank"); } finally {
        await mkdir(qaDir, { recursive: true });
        await writeFile(join(qaDir, "saved-refresh-continuity.json"), JSON.stringify(evidence, null, 2));
      }
    }
  }
}
