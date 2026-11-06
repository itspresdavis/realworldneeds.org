import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/offline-status.js", import.meta.url), "utf8");
const directory = await readFile(new URL("../public/directory.js", import.meta.url), "utf8");
const fallback = directory.slice(directory.indexOf("const showConnectivityState="), directory.indexOf("const scopedRecords="));
const flush = () => new Promise(setImmediate);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const ok = { ok: true, status: 200 };

function fixture(responses, { saved = false, noticePresent = true, online = true, cachedNavigation = false } = {}) {
  const listeners = new Map(), windowListeners = new Map(), timers = new Map(), calls = [], focusCalls = [];
  let observer, time = 0, nextTimer = 0;
  const match = (node, selector) => selector === node.tagName.toLowerCase()
    || selector.match(/^\[([^\]]+)\]$/)?.[1] in node.attributes;
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.dataset = {}; this.hidden = false; this.textContent = ""; this.isConnected = true; }
    setAttribute(name, value) { this.attributes[name] = String(value); }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    toggleAttribute(name, value) { if (value) this.setAttribute(name, ""); else this.removeAttribute(name); }
    append(...nodes) { for (const node of nodes) { node.parentNode = this; this.children.push(node); } }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    querySelector(selector) { return this.children.find(node => match(node, selector)) || this.children.map(node => node.querySelector(selector)).find(Boolean) || null; }
    addEventListener(type, callback) { (this.events ||= new Map()).set(type, callback); }
    focus(options) { document.activeElement = this; focusCalls.push({ node: this, options }); listeners.get("focusin")?.({ target: this }); }
    scrollIntoView() {}
    click() { return this.events?.get("click")?.({ target: this, preventDefault() {} }); }
  }
  const notice = new Element("div"), explanation = new Element("p"), body = new Element("body"), query = new Element("input");
  notice.id = "offlineDirectoryNotice"; notice.hidden = true; explanation.textContent = "Offline mode. Reconnect before traveling or relying on a listing."; notice.append(explanation);
  query.value = "Synthetic";
  const row = new Element("a"), meta = new Element("small"); row.append(meta); meta.textContent = "Source checked 2026-10-12";
  row.closest = () => ({}); // Current renderer already wraps search and Saved rows.
  const links = ["tel:+16175550123", "/service/synthetic", "https://example.invalid/contact", "https://example.invalid/maps"].map(href => {
    const node = new Element("a"); node.setAttribute("href", href); node.closest = () => node; return node;
  });
  const count = new Element("span"); count.textContent = "1 matching listings";
  const document = {
    body, activeElement: body, visibilityState: "visible",
    documentElement: { classList: { toggle() {} } },
    getElementById: () => noticePresent ? notice : null,
    createElement: tag => new Element(tag),
    querySelector(selector) {
      if (selector === 'meta[name="rwn-offline-navigation"]' && cachedNavigation) return { remove() { cachedNavigation = false; } };
      if (selector === "[data-directory-count]") return count;
      if (selector === (saved ? "[data-saved-list]" : ".directory-global-results")) return {};
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".directory-global-result") return [row];
      if (selector === ".directory-global-result-actions a") return links;
      return [];
    },
    addEventListener(type, handler) { listeners.set(type, handler); }
  };
  const navigator = { onLine: online };
  const recovered = [];
  const window = { location: { pathname: "/directory/help/food", search: "?query=private" }, dispatchEvent(event) { recovered.push(event.type); }, addEventListener(type, handler) { windowListeners.set(type, handler); } };
  Object.defineProperty(window, "localStorage", { get() { throw new Error("Connectivity must not read or mutate Saved state"); } });
  vm.runInNewContext(source, {
    document, navigator, window, URL, AbortController, Event, queueMicrotask,
    MutationObserver: class { constructor(handler) { observer = handler; } observe() {} },
    setTimeout(callback, delay) { const id = ++nextTimer; timers.set(id, { at: time + delay, callback }); return id; },
    clearTimeout(id) { timers.delete(id); },
    fetch(url, options) { calls.push({ url, options }); const response = responses.shift(); return response instanceof Error ? Promise.reject(response) : Promise.resolve(response); }
  });
  return {
    notice, explanation, document, navigator, links, row, query, count, calls, focusCalls, timers, windowListeners, recovered,
    get retry() { return notice.querySelector("[data-directory-reconnect]"); },
    get status() { return notice.querySelector("[data-directory-connection-status]"); },
    mutate() { observer?.(); },
    offline() { navigator.onLine = false; windowListeners.get("offline")?.(); },
    online() { navigator.onLine = true; return windowListeners.get("online")?.({ type: "online" }); },
    advance(ms) { time += ms; for (const [id, timer] of [...timers]) if (timer.at <= time) { timers.delete(id); timer.callback(); } },
    detailClick() {
      let blocked = false;
      listeners.get("click")?.({ target: links[1], preventDefault() { blocked = true; }, stopImmediatePropagation() {} });
      return blocked;
    }
  };
}

for (const saved of [false, true]) {
  for (const failure of [new Error("Network failed"), { ok: false, status: 503 }]) {
    test(`${saved ? "Saved" : "search"}: Retry recovers ${failure instanceof Error ? "rejection" : "HTTP 503"} without an online event`, async () => {
      const f = fixture([failure, ok], { saved });
      await flush();
      assert.equal(f.navigator.onLine, true);
      assert.equal(f.notice.dataset.networkState, "offline");
      assert.equal(f.links[0].hidden, false);
      assert.ok(f.links.slice(1).every(link => link.hidden));
      assert.equal(f.detailClick(), true);
      assert.equal(f.document.activeElement, f.notice);
      assert.ok(f.retry, "offline notice needs an explicit recovery control");
      assert.equal(f.retry.type, "button");
      f.retry.focus(); f.retry.click(); await flush();
      assert.equal(f.calls.length, 2);
      assert.equal(f.notice.dataset.networkState, "online");
      assert.ok(f.links.every(link => !link.hidden));
      assert.equal(f.detailClick(), false);
      assert.equal(f.document.activeElement, f.retry, "do not hide or remove the focused recovery control");
      assert.equal(f.notice.hidden, false);
      assert.match(f.status.textContent, /Connection restored/i);
      assert.equal(f.explanation.hidden, true, "recovered notice must not still claim offline mode");
      assert.equal(f.query.value, "Synthetic");
      f.query.focus();
      assert.equal(f.notice.hidden, true, "the recovered notice can close after focus leaves");
      for (const call of f.calls) {
        assert.equal(call.url, "/data/release.json");
        assert.equal(call.options.cache, "no-store");
        assert.equal(call.options.credentials, "same-origin");
      }
    });
  }
}

test("repeated recovery clicks share one request and leave the keyboard control focusable", async () => {
  const held = deferred(), f = fixture([new Error("Offline"), held.promise]);
  await flush();
  f.retry.focus(); f.retry.click(); f.retry.click(); f.retry.click();
  assert.equal(f.calls.length, 2);
  assert.equal(f.retry.getAttribute("aria-disabled"), "true");
  assert.ok(!f.retry.disabled);
  assert.match(f.status.textContent, /Checking/i);
  assert.equal(f.links[0].hidden, false);
  held.resolve(ok); await flush();
  assert.equal(f.retry.getAttribute("aria-disabled"), "false");
  assert.equal(f.document.activeElement, f.retry);
  assert.equal(f.timers.size, 0);
});

test("a stalled probe expires, aborts transport, and allows a new user retry", async () => {
  const held = deferred(), f = fixture([held.promise, ok]);
  f.advance(8000); await flush();
  assert.equal(f.notice.dataset.networkState, "offline");
  assert.equal(f.calls[0].options.signal.aborted, true);
  assert.match(f.status.textContent, /try again/i);
  f.retry.click(); await flush();
  assert.equal(f.calls.length, 2);
  assert.equal(f.notice.dataset.networkState, "online");
  assert.equal(f.timers.size, 0);
  held.resolve({ ok: false, status: 503 }); await flush();
  assert.equal(f.notice.dataset.networkState, "online", "timed-out responses cannot undo newer recovery");
});

for (const late of ["success", "failure"]) {
  test(`an older ${late} cannot undo a newer offline event or recovery`, async () => {
    const held = deferred(), f = fixture([held.promise, ok]);
    f.offline(); await flush();
    assert.equal(f.calls[0].options.signal.aborted, true);
    assert.equal(f.notice.dataset.networkState, "offline");
    assert.ok(f.retry);
    assert.equal(f.retry.getAttribute("aria-disabled"), "false");
    assert.equal(f.timers.size, 0);
    if (late === "success") held.resolve(ok); else held.reject(new Error("Older request failed"));
    await flush();
    assert.equal(f.notice.dataset.networkState, "offline");
    assert.equal(f.detailClick(), true);
    assert.equal(f.links[0].hidden, false);
    f.navigator.onLine = true; f.retry.click(); await flush();
    assert.equal(f.notice.dataset.networkState, "online");
  });
}

test("superseded cleanup cannot unlock a newer pending retry or change its result", async () => {
  const old = deferred(), current = deferred(), f = fixture([old.promise, current.promise]);
  f.offline();
  f.navigator.onLine = true; f.retry.focus(); f.retry.click();
  await flush();
  assert.equal(f.calls.length, 2);
  assert.equal(f.retry.getAttribute("aria-disabled"), "true");
  assert.equal(f.timers.size, 1);
  old.resolve(ok); await flush();
  assert.equal(f.notice.dataset.networkState, "offline");
  assert.equal(f.retry.getAttribute("aria-disabled"), "true");
  f.retry.click(); assert.equal(f.calls.length, 2);
  current.resolve({ ok: false, status: 503 }); await flush();
  assert.equal(f.notice.dataset.networkState, "offline");
  assert.equal(f.retry.getAttribute("aria-disabled"), "false");
  assert.equal(f.timers.size, 0);
});

test("recovery does not steal focus if the visitor keeps searching during the request", async () => {
  const held = deferred(), f = fixture([new Error("Offline"), held.promise]);
  await flush(); f.retry.focus(); f.retry.click(); f.query.focus();
  const focusCount = f.focusCalls.length;
  held.resolve(ok); await flush();
  assert.equal(f.document.activeElement, f.query);
  assert.equal(f.focusCalls.length, focusCount);
  assert.equal(f.notice.hidden, true);
  assert.equal(f.query.value, "Synthetic");
});

test("the directory's native online fallback cannot hide a focused pending Retry", async () => {
  const held = deferred(), f = fixture([new Error("Offline"), held.promise]);
  await flush(); f.retry.focus(); f.retry.click();
  // directory.js registers its connectivity listener before offline-status.js.
  // Run that actual fallback first, as a native online event would.
  vm.runInNewContext(`${fallback}\nshowConnectivityState();`, { notice: f.notice, navigator: f.navigator });
  assert.equal(f.notice.hidden, false);
  f.online();
  assert.equal(f.calls.length, 2, "the online event reuses the pending user probe");
  assert.equal(f.document.activeElement, f.retry);
  held.resolve(ok); await flush();
  assert.equal(f.notice.hidden, false);
  assert.equal(f.document.activeElement, f.retry);
});

test("the directory retains its native offline fallback before the probe module establishes state", () => {
  const notice = { hidden: true, dataset: {} }, navigator = { onLine: false };
  const context = vm.createContext({ notice, navigator });
  vm.runInContext(`${fallback}\nshowConnectivityState();`, context);
  assert.equal(notice.hidden, false);
  navigator.onLine = true;
  vm.runInContext("showConnectivityState();", context);
  assert.equal(notice.hidden, true);
});

test("initially offline startup owns visibility before the first hung probe settles", async () => {
  const held = deferred(), f = fixture([held.promise], { online: false });
  assert.equal(f.notice.dataset.networkState, "offline");
  assert.equal(f.notice.hidden, false);
  f.retry.focus(); f.navigator.onLine = true;
  vm.runInNewContext(`${fallback}\nshowConnectivityState();`, { notice: f.notice, navigator: f.navigator });
  assert.equal(f.notice.hidden, false);
  f.online();
  assert.equal(f.calls.length, 1);
  held.resolve(ok); await flush();
  assert.equal(f.notice.hidden, false);
  assert.equal(f.document.activeElement, f.retry);
});

test("recovered notice closes after focus leaves for a nonfocusable page background", async () => {
  const f = fixture([new Error("Offline"), ok]);
  await flush(); f.retry.focus(); f.retry.click(); await flush();
  f.notice.events.get("focusout")({ relatedTarget: null });
  f.document.activeElement = f.document.body;
  await flush();
  assert.equal(f.notice.hidden, true);
});

test("focus moving within a recovered notice cannot dismiss it during native focusout", async () => {
  const f = fixture([new Error("Offline"), ok]);
  await flush(); f.detailClick();
  await f.online();
  assert.equal(f.document.activeElement, f.notice);
  assert.equal(f.notice.hidden, false);
  // Native focusout may expose body before its relatedTarget receives focus.
  f.document.activeElement = f.document.body;
  f.notice.events.get("focusout")({ relatedTarget: f.retry });
  await flush();
  assert.equal(f.notice.hidden, false);
  f.retry.focus();
  assert.equal(f.document.activeElement, f.retry);
});

test("a failed retry keeps hard-offline warnings, telephone actions, and safe details interception", async () => {
  const f = fixture([new Error("Offline"), { ok: false, status: 503 }]);
  await flush(); f.retry.focus(); f.retry.click(); await flush(); f.mutate();
  assert.equal(f.notice.dataset.networkState, "offline");
  assert.equal(f.notice.hidden, false);
  assert.equal(f.explanation.hidden, false);
  assert.equal(f.links[0].hidden, false);
  assert.ok(f.links.slice(1).every(link => link.hidden));
  assert.equal(f.detailClick(), true);
  assert.match(f.count.textContent, /offline copy/);
  assert.match(f.status.textContent, /try again/i);
});

test("pages without a directory notice do not create controls or requests", () => {
  const f = fixture([], { noticePresent: false });
  assert.equal(f.calls.length, 0);
  assert.equal(f.retry, null);
  assert.equal(f.windowListeners.size, 0);
});


test("a successful coalesced connection retry notifies catalog consumers once", async () => {
  const pending = deferred();
  const f = fixture([new Error("offline"), pending.promise]);
  await flush();
  assert.deepEqual(f.recovered, []);
  const first = f.retry.click();
  assert.equal(f.retry.click(), first);
  pending.resolve(ok);
  await first;
  assert.deepEqual(f.recovered, ["rwn-connection-restored"]);
});


test("a healthy startup probe does not restart the catalog request", async () => {
  const f = fixture([ok]); await flush();
  assert.deepEqual(f.recovered, []);
});

test("an online event already retries catalogs and its probe must not restart them again", async () => {
  const f = fixture([new Error("offline"), ok]); await flush();
  await f.online();
  assert.deepEqual(f.recovered, []);
  assert.equal(f.notice.dataset.networkState, "online");
});


const recoveredDirectory = () => ({ ok: true, async text() { return '<html><head><meta name="rwn-offline-assets" content="0123456789ab"></head><body><section data-directory-search></section></body></html>'; } });
for (const status of [503, 504, 404, 410]) test(`cached navigation stays warned on directory HTTP ${status} even when navigator reports online`, async () => {
  const f = fixture([{ ok: false, status }, recoveredDirectory(), ok], { cachedNavigation: true });
  assert.equal(f.notice.hidden, false);
  await flush();
  assert.equal(f.calls[0].url, '/directory/help/food');
  assert.equal(f.calls[0].options.cache, 'no-store');
  assert.equal(f.notice.dataset.networkState, 'offline');
  assert.equal(f.detailClick(), true);
  f.retry.click(); await flush();
  assert.equal(f.notice.dataset.networkState, 'online');
  assert.equal(f.detailClick(), false);
  assert.equal(f.document.querySelector('meta[name="rwn-offline-navigation"]'), null);
  assert.deepEqual(f.recovered, ['rwn-connection-restored']);
  f.retry.click(); await flush();
  assert.equal(f.calls[2].url, '/data/release.json', 'successful navigation recovery resumes ordinary probes');
});

test('cached navigation probe bounds complete HTML and ignores late body success', async () => {
  const held = deferred();
  const f = fixture([{ ok: true, text: () => held.promise }, recoveredDirectory()], { cachedNavigation: true });
  await flush();
  assert.equal(f.notice.dataset.networkState, 'offline');
  f.advance(8000); await flush();
  assert.equal(f.calls[0].options.signal.aborted, true);
  assert.equal(f.notice.dataset.networkState, 'offline');
  f.retry.click(); await flush();
  assert.equal(f.notice.dataset.networkState, 'online');
  held.resolve('<html>not a directory</html>'); await flush();
  assert.equal(f.notice.dataset.networkState, 'online');
  assert.deepEqual(f.recovered, ['rwn-connection-restored']);
});

test('cached navigation cannot treat a non-directory success as recovery', async () => {
  const f = fixture([{ ok: true, async text() { return '<html>Source-hidden notice</html>'; } }], { cachedNavigation: true });
  await flush(); assert.equal(f.notice.dataset.networkState, 'offline');
  assert.equal(f.detailClick(), true);
});

test('restoring an unrecovered cached page rechecks its route without altering another tab', async () => {
  const first = fixture([{ ok: false, status: 503 }, recoveredDirectory()], { cachedNavigation: true });
  const second = fixture([{ ok: false, status: 504 }], { cachedNavigation: true });
  await flush();
  first.windowListeners.get('pageshow')({ persisted: true }); await flush();
  assert.equal(first.notice.dataset.networkState, 'online');
  assert.equal(second.notice.dataset.networkState, 'offline');
  assert.equal(first.calls[1].url, '/directory/help/food');
  first.windowListeners.get('pageshow')({ persisted: true }); await flush();
  assert.equal(first.calls.length, 2, 'removed marker does not impose extra ordinary-page work');
});

for (const redirected of [false, true]) test(`a ${redirected ? 'redirected directory' : 'non-directory page with release metadata'} cannot clear cached-navigation warnings`, async () => {
  const body = redirected ? await recoveredDirectory().text() : '<html><head><meta name="rwn-offline-assets" content="0123456789ab"></head><body>Source hidden</body></html>';
  const f = fixture([{ ok: true, redirected, async text() { return body; } }], { cachedNavigation: true });
  await flush(); assert.equal(f.notice.dataset.networkState, 'offline'); assert.equal(f.detailClick(), true);
});

test("a healthy release probe cannot clear a cached-index warning; only fresh catalog data can", async () => {
  const f = fixture([ok, ok]);
  await flush();
  f.windowListeners.get("rwn-catalog-status")({ detail: { cached: true } });
  assert.equal(f.notice.hidden, false);
  assert.match(f.status.textContent, /saved catalog/);
  f.retry.click(); await flush();
  assert.equal(f.notice.dataset.networkState, "offline");
  assert.equal(f.notice.hidden, false);
  assert.match(f.status.textContent, /saved catalog/);
  assert.ok(f.links.slice(1).every(link => link.hidden));
  f.mutate();
  f.windowListeners.get("rwn-catalog-status")({ detail: { cached: false } });
  assert.equal(f.notice.dataset.networkState, "online");
  assert.ok(f.links.every(link => !link.hidden));
  assert.match(f.status.textContent, /directory has refreshed/);
});

test("fresh catalog data cannot override a real network failure", async () => {
  const f = fixture([new Error("Offline")]);
  await flush();
  f.windowListeners.get("rwn-catalog-status")({ detail: { cached: false } });
  assert.equal(f.notice.dataset.networkState, "offline");
  assert.equal(f.notice.hidden, false);
});

test("a healthy online probe retries a catalog that remained cached during the first recovery attempt", async () => {
  const pending = deferred();
  const f = fixture([new Error("offline"), pending.promise]);
  await flush();
  f.windowListeners.get("rwn-catalog-status")({ detail: { cached: true } });
  const probe = f.online();
  // The direct online catalog request can finish from cache while a worker's
  // network connection is still recovering, before the page probe succeeds.
  f.windowListeners.get("rwn-catalog-status")({ detail: { cached: true } });
  pending.resolve(ok);
  await probe;
  assert.deepEqual(f.recovered, ["rwn-connection-restored"]);
  assert.equal(f.notice.dataset.networkState, "offline", "successful connectivity alone cannot clear a stale catalog warning");
  f.windowListeners.get("rwn-catalog-status")({ detail: { cached: false } });
  assert.equal(f.notice.dataset.networkState, "online");
  assert.equal(f.notice.hidden, true);
});

test("a fresh catalog completed before its online probe is not interrupted by duplicate recovery", async () => {
  const pending = deferred();
  const f = fixture([new Error("offline"), pending.promise]);
  await flush();
  f.windowListeners.get("rwn-catalog-status")({ detail: { cached: true } });
  const probe = f.online();
  f.windowListeners.get("rwn-catalog-status")({ detail: { cached: false } });
  pending.resolve(ok);
  await probe;
  assert.deepEqual(f.recovered, []);
  assert.equal(f.notice.dataset.networkState, "online");
});
