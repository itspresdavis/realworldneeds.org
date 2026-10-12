import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { normalizeSearch as normalize, querySearchTokens as queryTokens, resourceSearchScore as scoreRecord } from "../src/utils/search.js";
import { readDirectoryState, writeDirectoryState, restoreDirectoryView } from "../public/directory-state.js";

const source = await readFile(new URL("../public/directory.js", import.meta.url), "utf8");
const savedSource = await readFile(new URL("../public/saved-services.js", import.meta.url), "utf8");
const savedSyncSource = savedSource.slice(savedSource.indexOf("  const syncView ="), savedSource.indexOf('  window.addEventListener("hashchange"'));
const startupSource = await readFile(new URL("../public/directory-startup.js", import.meta.url), "utf8");
const catalog = JSON.parse(await readFile(new URL("../dist/data/search-index.json", import.meta.url), "utf8"));
const runtime = source.replace(/^import .*;\n/gm, "").replaceAll("import.meta.url", '"https://example.org/directory.js?v=startup-fixture"');
const london = "Drinking fountains for London";
const stale = () => ({ rwnDirectory: { path: "/directory", query: "WIC", category: "food", country: "United States", shown: 120, scroll: 900, focus: "/service/stale-target" }, unrelated: { retained: true } });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};

// Execute the entire real entry and real search/state helpers. These deliberately
// narrow DOM doubles test initialization and event ordering, not browser layout.
function fixture({ state = null, hash = "", path = "/directory", online = true } = {}) {
  let document;
  class Node {
    constructor(tag = "div", selectors = []) {
      this.tagName = tag.toUpperCase(); this.selectors = new Set(selectors);
      this.children = []; this.handlers = new Map(); this.attrs = new Map(); this.dataset = {};
      this.parentElement = null; this.textContent = ""; this.hidden = false; this._value = "";
      const classes = new Set();
      this.classList = { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value),
        toggle(value, on = !classes.has(value)) { on ? classes.add(value) : classes.delete(value); return on; } };
    }
    get value() { return this._value; }
    set value(value) { this._value = String(value); this.selectionStart = this.selectionEnd = this._value.length; }
    setSelectionRange(start, end) { this.selectionStart = start; this.selectionEnd = end; }
    get childElementCount() { return this.children.length; }
    addEventListener(type, callback, options = {}) {
      const capture = options === true || Boolean(options.capture);
      const handlers = this.handlers.get(type) || [];
      handlers.push({ callback, capture, once: Boolean(options.once) }); this.handlers.set(type, handlers);
    }
    removeEventListener(type, callback, options = {}) {
      const capture = options === true || Boolean(options.capture);
      this.handlers.set(type, (this.handlers.get(type) || []).filter(item => item.callback !== callback || item.capture !== capture));
    }
    invoke(event, capture) {
      for (const item of [...this.handlers.get(event.type) || []]) {
        if (item.capture !== capture) continue;
        item.callback(event);
        if (item.once) this.removeEventListener(event.type, item.callback, item.capture);
      }
    }
    dispatch(type, data = {}) {
      const event = { type, target: this, preventDefault() { this.defaultPrevented = true; }, ...data };
      const parents = []; for (let node = this.parentElement; node; node = node.parentElement) parents.push(node);
      for (const node of [...parents].reverse()) node.invoke(event, true);
      this.invoke(event, true); this.invoke(event, false);
      for (const node of parents) node.invoke(event, false);
      return event;
    }
    dispatchEvent(event) { return !this.dispatch(event.type, event).defaultPrevented; }
    matches(selector) { return selector.split(",").some(value => this.selectors.has(value.trim())); }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node;
      return null;
    }
    querySelectorAll(selector) {
      const result = [];
      for (const child of this.children) {
        if (child.matches(selector)) result.push(child);
        result.push(...child.querySelectorAll(selector));
      }
      return result;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    append(...children) {
      for (const child of children) {
        if (child.fragment) { this.append(...child.children); continue; }
        child.parentElement = this; this.children.push(child);
      }
    }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    setAttribute(name, value) { this.attrs.set(name, String(value)); }
    getAttribute(name) { return this.attrs.get(name) || null; }
    removeAttribute(name) { this.attrs.delete(name); }
    scrollIntoView() { this.scrolled = true; }
    getBoundingClientRect() { return { top: 120, bottom: 150, height: 30 }; }
    focus() { if (document.activeElement === this) return; document.activeElement = this; this.dispatch("focus"); }
    blur() { if (document.activeElement === this) document.activeElement = document.body; this.dispatch("blur"); }
    insertAdjacentElement(_where, node) { this.parentElement.append(node); }
  }
  document = new Node("document"); document.body = new Node("body"); document.append(document.body); document.activeElement = document.body;
  const shell = new Node("main", [".directory-shell"]), root = new Node("form", ["[data-directory-search]"]);
  const input = new Node("input", ["[data-directory-query]"]), country = new Node("select", ["[data-directory-country]"]);
  const clear = new Node("button", ["[data-directory-clear]"]), count = new Node("span", ["[data-directory-count]"]), chips = new Node("div", ["[data-directory-categories]"]);
  clear.hidden = true; country.disabled = true;
  root.append(input, country, clear, count, chips); shell.append(root);
  for (let i = 0; i < 60; i++) shell.append(new Node("article", [".directory-records > .directory-record"]));
  const resultList = new Node("div", ["[data-global-list]"]), summary = new Node("span", ["[data-global-summary]"]), more = new Node("button", ["[data-directory-more]"]);
  let results;
  document.createElement = tag => {
    const node = new Node(tag);
    if (tag === "section") { results = node; node.append(resultList, summary, more); }
    if (tag === "button") {
      const original = node.matches.bind(node);
      node.matches = selector => selector === "[data-directory-category]" ? "directoryCategory" in node.dataset : original(selector);
    }
    return node;
  };
  document.getElementById = id => document.querySelectorAll("*").find(node => node.id === id) || null;
  document.createDocumentFragment = () => Object.assign(new Node(), { fragment: true });
  const writes = [], requests = [], timers = new Map(), frames = [], scrolls = [];
  let timerId = 0;
  const history = { state, replaceState(...args) { writes.push(args); this.state = args[0]; } };
  const location = { pathname: path, hash, href: `https://example.org${path}${hash}` };
  const window = Object.assign(new Node("window"), { scrollY: 0, innerHeight: 800, isSecureContext: false,
    scrollTo({ top }) { this.scrollY = top; scrolls.push(top); } });
  const navigator = { onLine: online, serviceWorker: new Node("serviceworker") };
  const storage = new Proxy({}, { get() { assert.fail("Directory search must never read or write web storage"); } });
  const context = vm.createContext({ document, window, history, location, navigator, URL, Intl,
    normalize, queryTokens, scoreRecord, readDirectoryState, writeDirectoryState,
    HTMLInputElement: Node, HTMLTextAreaElement: Node,
    Event: class { constructor(type, options) { this.type = type; Object.assign(this, options); } }, CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    localStorage: storage, sessionStorage: storage,
    createResultRow(record) {
      const row = new Node("article"), link = new Node("a", ["a", ".directory-global-result", 'a[href^="/service/"]']);
      row.record = record; link.setAttribute("href", `/service/${record.id}`); row.append(link); return row;
    },
    fetch(url, options) { const pending = deferred(); requests.push({ url, options, ...pending }); return pending.promise; },
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); }, requestAnimationFrame(callback) { frames.push(callback); }
  });
  vm.runInContext(`const restoreDirectoryView = ${restoreDirectoryView.toString()};`, context);
  // A classic head script runs before static search controls exist.
  vm.runInContext(startupSource, context);
  document.body.append(shell);
  const savedPanel = new Node("section", ["[data-saved-services]"]), savedHeading = new Node("h2"), savedLink = new Node("a", ['a[href$="#saved"]', "a[href]"]), browseLink = new Node("a", ["a[href]"]);
  savedLink.setAttribute("href", "/directory#saved"); browseLink.setAttribute("href", "#directory-results");
  savedPanel.append(savedHeading, browseLink); shell.append(savedPanel, savedLink);
  Object.assign(context, { savedPanel, savedHeading });
  vm.runInContext(`{ const panel = savedPanel, heading = savedHeading;
    const active = () => location.hash === "#saved"; let generation = 0;
    const render = () => {}, cancelClear = () => {};
    ${savedSyncSource}
 globalThis.savedSync = syncView;
  }`, context);
  return { document, window, navigator, root, input, country, clear, count, chips, shell, resultList, more,
    history, location, writes, requests, timers, scrolls, savedHeading, savedLink, browseLink,
    staticSavedBrowse(scroll = 450) {
      window.scrollY = scroll; savedLink.dispatch("click"); location.hash = "#saved"; history.state = null;
      browseLink.dispatch("click"); location.hash = "#directory-results"; history.state = null;
      // Static :target navigation can reveal Saved and its Browse link while
      // both deferred modules are still loading. The fragment then jumps away.
      window.scrollY = 7000; document.activeElement = browseLink;
    },
    historySaved() {
      history.state = null; location.hash = "#saved"; window.dispatch("popstate"); context.savedSync(true);
    },
    enterSaved() {
      savedLink.dispatch("click"); history.state = null; location.hash = "#saved";
      window.dispatch("popstate"); context.savedSync(true);
    },
    leaveSaved({ state = null, hash = "#directory-results" } = {}) {
      history.state = state; location.hash = hash;
      window.dispatch("popstate"); const beforeHandoff = { input: input.value, scrolls: [...scrolls] };
      context.savedSync(true); return beforeHandoff;
    },
    start() { vm.runInContext(runtime, context); },
    type(value, data = {}) { input.value = value; input.dispatch("input", data); },
    get results() { return results; },
    async flush() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } await tick(); },
    async resolve(index = requests.length - 1, payload = catalog) { assert.ok(requests[index], `Missing catalog request ${index}`); requests[index].resolve({ ok: true, json: async () => payload }); await tick(); },
    async reject(index = requests.length - 1) { assert.ok(requests[index], `Missing catalog request ${index}`); requests[index].reject(new Error("Offline")); await tick(); },
    frames() { for (const callback of frames.splice(0)) callback(); },
    ids() { return resultList.children.filter(row => row.record).map(row => row.record.id); }
  };
}

function assertLondon(f) {
  assert.equal(f.input.value, london);
  assert.deepEqual(f.ids(), ["london-drinking-fountains"]);
  assert.equal(f.count.textContent, "1 matching listing");
  assert.equal(f.results.hidden, false);
  assert.equal(f.clear.hidden, false);
}
function assertOrdinary(f) {
  assert.equal(f.input.value, ""); assert.equal(f.country.value, "");
  assert.deepEqual(f.ids(), []); assert.equal(f.results.hidden, true);
  assert.equal(f.count.textContent, "60 listings on this page"); assert.equal(f.clear.hidden, true);
}

test("fresh early typing searches the real catalog without another input event or caret jump", async () => {
  const f = fixture(); f.input.focus(); f.type(london); f.input.setSelectionRange(9, 9);
  f.start(); await f.flush();
  assert.equal(f.requests.length, 1); await f.resolve();
  assertLondon(f); assert.equal(f.document.activeElement, f.input); assert.equal(f.input.selectionStart, 9);
});

test("untouched empty startup keeps static rows and avoids an unnecessary index request", async () => {
  const f = fixture(); f.start(); await f.flush();
  assertOrdinary(f); assert.equal(f.requests.length, 0); assert.deepEqual(f.scrolls, []);
});

test("a preexisting nonempty control without an observed edit is searched on fresh history", async () => {
  const f = fixture(); f.input.value = london; f.start(); await f.flush(); await f.resolve(); assertLondon(f);
});

test("country-only early input searches even without any query text", async () => {
  for (const captured of [false, true]) {
    const f = fixture(); f.country.value = "France"; if (captured) f.country.dispatch("change");
    f.start(); await f.flush(); await f.resolve();
    assert.equal(f.input.value, ""); assert.equal(f.clear.hidden, false); assert.equal(f.country.disabled, false);
    assert.deepEqual(f.ids().sort(), catalog.records.filter(record => record.country === "France").map(record => record.id).sort());
  }
});

test("early new text wins over stale history filters, result focus and scroll", async () => {
  const f = fixture({ state: stale() }); f.input.focus(); f.type(london); f.input.setSelectionRange(7, 7);
  f.start(); await f.flush(); await f.resolve(); f.frames();
  assertLondon(f); assert.equal(f.country.value, ""); assert.equal(f.history.state.rwnDirectory.category, "");
  assert.equal(f.document.activeElement, f.input); assert.equal(f.input.selectionStart, 7); assert.deepEqual(f.scrolls, []);
  assert.equal(f.history.state.rwnDirectory.query, london); assert.equal(f.history.state.rwnDirectory.focus, "");
  assert.deepEqual(f.history.state.unrelated, { retained: true });
});

test("an early country edit also discards unrelated saved query and category filters", async () => {
  const f = fixture({ state: stale() }); f.country.value = "France"; f.country.dispatch("change");
  f.start(); await f.flush(); await f.resolve(); f.frames();
  assert.equal(f.input.value, ""); assert.equal(f.history.state.rwnDirectory.category, ""); assert.deepEqual(f.scrolls, []);
  assert.ok(f.ids().length); assert.ok(f.resultList.children.every(row => row.record.country === "France"));
});

test("early edits back to blank defeat stale history even after the input loses focus", async () => {
  const f = fixture({ state: stale() }); f.input.focus(); f.type("changed"); f.type(""); f.input.blur();
  f.start(); await f.flush(); f.frames();
  assertOrdinary(f); assert.equal(f.requests.length, 0); assert.equal(f.document.activeElement, f.document.body);
  assert.equal(f.history.state.rwnDirectory.query, ""); assert.equal(f.history.state.rwnDirectory.category, "");
  assert.equal(f.history.state.rwnDirectory.country, ""); assert.equal(f.history.state.rwnDirectory.focus, ""); assert.deepEqual(f.scrolls, []);
});

test("browser-restored focus without an edit does not discard valid entry history", async () => {
  const f = fixture({ state: stale() }); f.input.focus(); f.start(); await f.flush();
  assert.equal(f.input.value, "WIC"); assert.equal(f.country.value, "United States");
  await f.resolve(); assert.equal(f.ids().length, 120); f.frames(); assert.deepEqual(f.scrolls, [900]);
});

test("untouched valid history restores filters, loaded batches, focus and scroll", async () => {
  const state = stale();
  const matches = catalog.records.filter(record => record.country === "United States" && record.categoryLabels.some(label => normalize(label) === "food"))
    .map(record => ({ record, score: scoreRecord(record, queryTokens("WIC")) })).filter(item => item.score >= 0)
    .sort((a, b) => b.score - a.score || new Intl.Collator(undefined, { sensitivity: "base" }).compare(a.record.name, b.record.name));
  assert.ok(matches.length >= 120); state.rwnDirectory.focus = `/service/${matches[80].record.id}`;
  const f = fixture({ state }); f.start(); await f.flush();
  assert.equal(f.input.value, "WIC"); assert.equal(f.country.value, "United States");
  await f.resolve(); assert.equal(f.ids().length, 120); assert.equal(f.scrolls.length, 0);
  f.frames(); assert.deepEqual(f.scrolls, [900]); assert.equal(f.document.activeElement.getAttribute("href"), state.rwnDirectory.focus);
});

test("history for another pathname never replaces live startup input", async () => {
  const state = stale(); state.rwnDirectory.path = "/directory/france";
  const f = fixture({ state }); f.input.value = london; f.start(); await f.flush(); await f.resolve(); assertLondon(f);
});

test("untouched Saved startup preserves entry state and defers restoration until returning", async () => {
  const state = stale(); state.rwnDirectory.query = london; state.rwnDirectory.country = ""; state.rwnDirectory.category = "";
  const f = fixture({ state, hash: "#saved" }); f.shell.classList.add("has-saved-view");
  f.start(); await f.flush();
  assert.equal(f.requests.length, 0); assert.equal(f.document.activeElement, f.document.body); assert.deepEqual(f.scrolls, []);
  assert.equal(f.history.state, state, "the directory must not replace the Saved view's history before handoff");
  f.location.hash = ""; f.shell.classList.remove("has-saved-view"); f.window.dispatch("rwn-directory-restore");
  await f.flush(); await f.resolve(); f.frames(); assertLondon(f); assert.deepEqual(f.scrolls, [900]);
});


for (const withHistory of [false, true]) {
  for (const returning of ["rwn-directory-restore", "popstate"]) {
    test(`early input survives Saved startup with ${withHistory ? "stale" : "no"} history and returns through ${returning}`, async () => {
      const originalState = withHistory ? stale() : null;
      const f = fixture({ state: originalState }); f.input.focus(); f.type(london);
      const savedHeading = f.document.createElement("h2"); f.shell.append(savedHeading);
      f.location.hash = "#saved"; f.shell.classList.add("has-saved-view"); savedHeading.focus();
      f.start(); await f.flush(); f.frames();
      assert.equal(f.requests.length, 0); assert.equal(f.document.activeElement, savedHeading); assert.deepEqual(f.scrolls, []);
      assert.equal(f.input.value, london); assert.equal(f.country.value, "");
      f.location.hash = ""; f.shell.classList.remove("has-saved-view");
      // Back may restore the original pre-Saved entry, including null/stale
      // state. The pending visitor edit must survive that history replacement.
      if (returning === "popstate") f.history.state = originalState;
      f.window.dispatch(returning); await f.flush();
      assert.equal(f.input.value, london); assert.equal(f.country.value, ""); assert.equal(f.requests.length, 1);
      await f.resolve(); f.frames(); assertLondon(f);
      assert.equal(f.history.state.rwnDirectory.category, ""); assert.ok(!f.scrolls.includes(900));
      // This precedence belongs only to the first return: later navigation
      // must still restore the selected history entry's own state normally.
      f.history.state = stale(); f.window.dispatch("popstate"); await f.flush(); f.frames();
      assert.equal(f.input.value, "WIC"); assert.equal(f.country.value, "United States");
      assert.equal(f.ids().length, 120); assert.equal(f.scrolls.at(-1), 900);
    });
  }
}

test("an early deliberate clear survives Saved and Back to stale history without searching", async () => {
  const originalState = stale(), f = fixture({ state: originalState });
  f.input.focus(); f.type("WIC"); f.type("");
  const savedHeading = f.document.createElement("h2"); f.shell.append(savedHeading); savedHeading.focus();
  f.location.hash = "#saved"; f.shell.classList.add("has-saved-view"); f.start(); await f.flush();
  assertOrdinary(f); assert.equal(f.requests.length, 0); assert.equal(f.document.activeElement, savedHeading);
  f.location.hash = ""; f.shell.classList.remove("has-saved-view"); f.history.state = originalState;
  f.window.dispatch("popstate"); await f.flush(); f.frames();
  assertOrdinary(f); assert.equal(f.requests.length, 0); assert.ok(!f.scrolls.includes(900));
  assert.equal(f.history.state.rwnDirectory.query, ""); assert.equal(f.history.state.rwnDirectory.category, "");
  assert.equal(f.history.state.rwnDirectory.country, "");
});

test("ordinary early input precedence expires before later history navigation", async () => {
  const f = fixture(); f.type(london); f.start(); await f.flush(); await f.resolve(); assertLondon(f);
  f.history.state = stale(); f.window.dispatch("popstate"); await f.flush(); f.frames();
  assert.equal(f.input.value, "WIC"); assert.equal(f.country.value, "United States");
  assert.equal(f.ids().length, 120); assert.deepEqual(f.scrolls, [900]);
});

test("composition spanning runtime startup waits for the final committed query", async () => {
  const f = fixture({ state: stale() }); f.input.focus(); f.input.dispatch("compositionstart"); f.type("Drinking", { isComposing: true });
  f.start(); await f.flush();
  assert.equal(f.input.value, "Drinking"); assert.equal(f.requests.length, 0); assert.deepEqual(f.scrolls, []);
  f.input.value = london; f.input.setSelectionRange(8, 8); f.input.dispatch("compositionend"); f.input.dispatch("input", { isComposing: false });
  await f.flush(); assert.equal(f.requests.length, 1); await f.resolve(); assertLondon(f);
  assert.equal(f.input.selectionStart, 8); assert.equal(f.document.activeElement, f.input); assert.deepEqual(f.scrolls, []);
});

test("post-startup composition and composing input events do not search partial text", async () => {
  const f = fixture(); f.start(); f.input.dispatch("compositionstart"); f.type("Drink", { isComposing: true });
  await f.flush(); assert.equal(f.requests.length, 0);
  f.input.value = london; f.input.dispatch("compositionend"); await f.flush(); await f.resolve(); assertLondon(f);
});

for (const outcome of ["resolve", "reject"]) {
  test(`a stale startup ${outcome === "resolve" ? "success" : "failure"} cannot paint over newer input before its debounce`, async () => {
    const f = fixture(); f.type("WIC"); f.start(); await f.flush(); assert.equal(f.requests.length, 1);
    f.type(london); await f[outcome](0);
    assert.deepEqual(f.ids(), []); assert.doesNotMatch(f.count.textContent, /unavailable|matching listings/);
    await f.flush(); if (outcome === "reject") { assert.equal(f.requests.length, 2); await f.resolve(1); }
    assertLondon(f);
  });
  test(`a stale startup ${outcome === "resolve" ? "success" : "failure"} cannot undo Clear filters`, async () => {
    const f = fixture(); f.input.focus(); f.type(london); f.start(); await f.flush();
    f.clear.dispatch("click"); assertOrdinary(f); await f[outcome](0); await f.flush();
    assertOrdinary(f); assert.equal(f.document.activeElement, f.input); assert.equal(f.history.state.rwnDirectory.query, "");
  });
}

test("an offline startup failure retries the same search when connectivity returns", async () => {
  const f = fixture({ online: false }); f.type(london); f.start(); await f.flush(); await f.reject();
  assert.match(f.count.textContent, /temporarily unavailable/); assert.equal(f.input.value, london);
  f.navigator.onLine = true; f.window.dispatch("online"); await f.flush();
  assert.equal(f.requests.length, 2); await f.resolve(); assertLondon(f);
});

test("startup search retains page scope and never fetches or persists the private query outside entry history", async () => {
  const f = fixture({ path: "/directory/france" }); f.type(london);
  assert.deepEqual(Object.keys(f.root.rwnDirectoryStartup), ["edited"]);
  assert.equal(f.root.rwnDirectoryStartup.edited, true);
  f.start(); await f.flush(); await f.resolve();
  assert.deepEqual(f.ids(), []); assert.equal(f.count.textContent, "No matching listings");
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url, "/data/search-index.json?v=startup-fixture");
  assert.equal(f.requests[0].options.credentials, "same-origin"); assert.equal(f.requests[0].options.body, undefined);
  assert.ok(f.writes.length); assert.ok(f.writes.every(args => args.length === 2 && args[1] === ""));
  assert.deepEqual(f.location, { pathname: "/directory/france", hash: "", href: "https://example.org/directory/france" });
  assert.equal(readDirectoryState(f.history.state, "/directory/france").query, london);
  assert.doesNotMatch(startupSource, /localStorage|sessionStorage|replaceState|pushState|\.value/);
  for (const type of ["input", "change", "compositionstart", "compositionend", "click"]) {
    assert.equal((f.document.handlers.get(type) || []).filter(handler => handler.capture).length, type === "click" ? 1 : 0, `${type} capture listener must retire on readiness`);
  }
});

test("normal post-startup typing remains debounced and Escape clears the entry state", async () => {
  const f = fixture(); f.start(); f.type(london);
  assert.equal(f.requests.length, 0); assert.equal(f.timers.size, 1);
  await f.flush(); await f.resolve(); assertLondon(f);
  const escape = f.input.dispatch("keydown", { key: "Escape" });
  assert.equal(escape.defaultPrevented, true); assertOrdinary(f);
  assert.equal(f.history.state.rwnDirectory.query, ""); assert.equal(f.document.activeElement, f.input);
});

test("a blank early edit remains cleared after reloading its new history entry state", async () => {
  const f = fixture({ state: stale() }); f.type(""); f.start(); await f.flush();
  const reloaded = fixture({ state: f.history.state }); reloaded.start(); await reloaded.flush(); reloaded.frames();
  assertOrdinary(reloaded); assert.equal(reloaded.requests.length, 0);
  assert.equal(reloaded.history.state.rwnDirectory.category, ""); assert.equal(reloaded.history.state.rwnDirectory.country, "");
});

test("an untouched unfocused control still lets valid entry history own restoration", async () => {
  const f = fixture({ state: stale() }); f.input.value = london;
  f.start(); await f.flush(); assert.equal(f.input.value, "WIC"); assert.equal(f.country.value, "United States");
  await f.resolve(); f.frames(); assert.equal(f.ids().length, 120); assert.deepEqual(f.scrolls, [900]);
});

test("composition completed before initialization searches only its final text", async () => {
  const f = fixture(); f.input.dispatch("compositionstart"); f.type("Drink", { isComposing: true });
  f.input.value = london; f.input.dispatch("compositionend");
  assert.equal(f.root.rwnDirectoryStartup.composing, false);
  assert.deepEqual(Object.keys(f.root.rwnDirectoryStartup).sort(), ["composing", "edited"]);
  f.start(); await f.flush(); assert.equal(f.requests.length, 1); await f.resolve(); assertLondon(f);
  assert.equal(f.root.rwnDirectoryStartup, undefined, "transient startup flags are discarded after handoff");
});

test("Escape during composition does not erase text or cancel the input method", async () => {
  const f = fixture(); f.input.dispatch("compositionstart"); f.type("Drink", { isComposing: true }); f.start();
  const escape = f.input.dispatch("keydown", { key: "Escape", isComposing: true });
  assert.equal(escape.defaultPrevented, undefined); assert.equal(f.input.value, "Drink");
  await f.flush(); assert.equal(f.requests.length, 0);
  f.input.value = london; f.input.dispatch("compositionend"); await f.flush(); await f.resolve(); assertLondon(f);
});

for (const outcome of ["resolve", "reject"]) {
  test(`composition starting during a pending search suppresses its stale ${outcome === "resolve" ? "success" : "failure"}`, async () => {
    const f = fixture(); f.type("WIC"); f.start(); await f.flush();
    f.input.dispatch("compositionstart"); f.type("Drink", { isComposing: true }); await f[outcome](0); await f.flush();
    assert.deepEqual(f.ids(), []); assert.doesNotMatch(f.count.textContent, /unavailable|matching listings/);
    assert.equal(f.requests.length, 1);
    f.input.value = london; f.input.dispatch("compositionend"); await f.flush();
    if (outcome === "reject") await f.resolve(1);
    assertLondon(f);
  });
}

test("early events outside directory controls do not supersede valid saved state", async () => {
  const f = fixture({ state: stale() });
  const unrelated = f.document.createElement("input"); f.document.body.append(unrelated); unrelated.dispatch("input");
  assert.equal(f.root.rwnDirectoryStartup, undefined);
  f.start(); await f.flush(); assert.equal(f.input.value, "WIC"); await f.resolve(); assert.equal(f.ids().length, 120);
});

// The actual Saved syncView handoff follows native fragment ordering: the new
// entry has null classic state, popstate fires while Saved still owns the view,
// then hashchange hides it and requests restoration.
for (const shown of [60, 120]) {
  test(`Saved Browse restores ${shown} rows from its captured entry after native-order null-state navigation`, async () => {
    const state = stale(); state.rwnDirectory.shown = shown;
    const f = fixture({ state }); f.start(); await f.flush(); await f.resolve(); f.frames();
    f.window.scrollY = 1550; f.resultList.children[shown - 10].children[0].focus();
    const focus = f.document.activeElement.getAttribute("href"); f.enterSaved();
    assert.equal(f.document.activeElement, f.savedHeading); const savedScrolls = f.scrolls.length;
    f.window.scrollY = 40; const before = f.leaveSaved();
    assert.equal(before.scrolls.length, savedScrolls, "popstate must wait until Saved hides");
    await f.flush(); f.frames();
    assert.equal(f.ids().length, shown); assert.equal(f.input.value, "WIC"); assert.equal(f.country.value, "United States");
    assert.equal(f.history.state.rwnDirectory.category, "food"); assert.equal(f.history.state.rwnDirectory.shown, shown);
    assert.equal(f.scrolls.at(-1), 1550); assert.equal(f.document.activeElement.getAttribute("href"), focus);
    assert.ok(f.writes.every(args => args.length === 2));
  });
}

test("Saved Browse uses valid current history before the captured directory entry", async () => {
  const f = fixture({ state: stale() }); f.start(); await f.flush(); await f.resolve(); f.frames(); f.enterSaved();
  const newer = stale(); Object.assign(newer.rwnDirectory, { query: london, country: "", category: "", shown: 60, scroll: 345 });
  f.leaveSaved({ state: newer }); await f.flush(); f.frames();
  assertLondon(f); assert.equal(f.scrolls.at(-1), 345); assert.equal(f.history.state.rwnDirectory.query, london);
});

test("a repeated Saved visit captures the newest cleared context instead of old filters", async () => {
  const f = fixture({ state: stale() }); f.start(); await f.flush(); await f.resolve(); f.frames(); f.enterSaved();
  f.leaveSaved(); await f.flush(); f.frames(); f.clear.dispatch("click");
  f.window.scrollY = 300; f.enterSaved(); f.leaveSaved(); await f.flush(); f.frames();
  assertOrdinary(f); assert.equal(f.scrolls.at(-1), 300); assert.equal(f.history.state.rwnDirectory.query, "");
});

test("early Saved Browse keeps a deliberate query or clear ahead of stale history", async () => {
  for (const value of [london, ""]) {
    const f = fixture({ state: stale() }); f.type(value); f.location.hash = "#saved";
    f.shell.classList.add("has-saved-view"); f.savedHeading.focus(); f.start(); await f.flush();
    const before = f.leaveSaved({ state: stale() });
    assert.equal(before.input, value, "hidden popstate must not replace the early edit");
    await f.flush(); if (value) await f.resolve(); f.frames();
    if (value) assertLondon(f); else assertOrdinary(f);
    assert.equal(f.history.state.rwnDirectory.query, value); assert.ok(!f.scrolls.includes(900));
    f.history.state = stale(); f.window.dispatch("popstate"); await f.flush();
    if (!value) await f.resolve(); f.frames(); assert.equal(f.input.value, "WIC"); assert.equal(f.ids().length, 120);
  }
});

test("Saved handoff leaves unrelated deliberate anchors and cold Saved to static fallback", async () => {
  const f = fixture({ state: stale() }); f.start(); await f.flush(); await f.resolve(); f.frames(); f.enterSaved();
  const prior = f.scrolls.length; f.leaveSaved({ hash: "#directory-search" }); await f.flush(); f.frames();
  assert.equal(f.scrolls.length, prior); assert.equal(f.input.scrolled, true); assert.equal(f.history.state, null);
  const cold = fixture({ hash: "#saved" }); cold.shell.classList.add("has-saved-view"); cold.start(); cold.leaveSaved();
  await cold.flush(); cold.frames(); assert.equal(cold.scrolls.length, 0); assert.equal(cold.input.scrolled, true);
});

test("Saved Browse preserves in-progress early composition and searches only committed text", async () => {
  const f = fixture({ state: stale() }); f.input.dispatch("compositionstart"); f.type("Drink", { isComposing: true });
  f.location.hash = "#saved"; f.shell.classList.add("has-saved-view"); f.start(); f.leaveSaved({ state: stale() });
  await f.flush(); assert.equal(f.input.value, "Drink"); assert.equal(f.requests.length, 0);
  f.input.value = london; f.input.dispatch("compositionend"); await f.flush(); await f.resolve(); f.frames(); assertLondon(f);
});

test("a search finishing inside Saved cannot replace its pre-entry return position", async () => {
  const f = fixture(); f.start(); f.type("WIC"); await f.flush(); f.window.scrollY = 650; f.enterSaved();
  f.window.scrollY = 20; await f.resolve(); f.leaveSaved(); await f.flush(); f.frames();
  assert.equal(f.input.value, "WIC"); assert.equal(f.ids().length, 60); assert.equal(f.scrolls.at(-1), 650);
});


test("Clear during composition immediately discards results and invalidates an older search", async () => {
  const f = fixture({ state: stale() }); f.start(); await f.flush();
  f.input.dispatch("compositionstart"); f.type("Drink", { isComposing: true }); f.clear.dispatch("click");
  assertOrdinary(f); await f.resolve(); await f.flush(); f.frames(); assertOrdinary(f);
  assert.equal(f.history.state.rwnDirectory.query, "");
});

test("retained Browse state survives restricted history without reading a stale write-back", async () => {
  const f = fixture(); f.start(); f.type(london); await f.flush(); await f.resolve();
  f.history.replaceState = () => { throw new Error("denied"); }; f.window.scrollY = 765; f.enterSaved();
  f.leaveSaved(); await f.flush(); f.frames(); assertLondon(f); assert.equal(f.scrolls.at(-1), 765);
});


test("restricted history cannot make stale entry filters beat an early Saved edit", async () => {
  for (const value of [london, ""]) {
    const f = fixture({ state: stale() }); f.type(value);
    f.history.replaceState = () => { throw new Error("denied"); };
    f.location.hash = "#saved"; f.shell.classList.add("has-saved-view"); f.start();
    f.leaveSaved({ state: stale() }); await f.flush(); if (value) await f.resolve(); f.frames();
    if (value) assertLondon(f); else assertOrdinary(f);
    assert.ok(!f.scrolls.includes(900));
  }
});


for (const value of [london, ""]) {
  test(`static Saved and Browse before the runtime preserve ${value ? "early input" : "intentional blank"} and useful directory context`, async () => {
    const f = fixture({ state: stale() }); f.type(value); f.staticSavedBrowse(455);
    assert.deepEqual(Object.keys(f.root.rwnDirectoryStartup).sort(), ["browse", "edited", "scroll"]);
    assert.equal(f.root.rwnDirectoryStartup.browse, true); assert.equal(f.root.rwnDirectoryStartup.scroll, 455);
    f.start(); await f.flush(); if (value) await f.resolve(); f.frames();
    if (value) assertLondon(f); else assertOrdinary(f);
    assert.equal(f.scrolls.at(-1), 455); assert.equal(f.history.state.rwnDirectory.query, value);
    assert.notEqual(f.document.activeElement.getAttribute("href"), "#directory-results");
    assert.equal(f.root.rwnDirectoryStartup, undefined);
  });
}

test("static Saved and Browse without any search input restore the default directory context", async () => {
  const f = fixture(); f.staticSavedBrowse(380); f.start(); await f.flush(); f.frames();
  assertOrdinary(f); assert.equal(f.scrolls.at(-1), 380); assert.equal(f.document.activeElement, f.input);
});


test("a pre-runtime input click is not an edit and cannot discard valid history", async () => {
  const f = fixture({ state: stale() }); f.input.dispatch("click"); assert.equal(f.root.rwnDirectoryStartup, undefined);
  f.start(); await f.flush(); await f.resolve(); f.frames();
  assert.equal(f.input.value, "WIC"); assert.equal(f.country.value, "United States"); assert.equal(f.ids().length, 120);
});

test("repeated static Saved clicks retain the original directory return scroll", async () => {
  const f = fixture(); f.type(london); f.window.scrollY = 450; f.savedLink.dispatch("click"); f.location.hash = "#saved";
  f.window.scrollY = 700; f.savedLink.dispatch("click"); assert.equal(f.root.rwnDirectoryStartup.scroll, 450);
  f.browseLink.dispatch("click"); f.location.hash = "#directory-results"; f.history.state = null;
  f.start(); await f.flush(); await f.resolve(); f.frames(); assertLondon(f); assert.equal(f.scrolls.at(-1), 450);
});

test("a newer unrelated static anchor cancels early Browse return-focus ownership", async () => {
  const f = fixture(); f.type(london); f.staticSavedBrowse(); f.location.hash = "#directory-search";
  f.window.scrollY = 220; f.document.activeElement = f.document.body;
  f.start(); await f.flush(); await f.resolve(); f.frames(); assertLondon(f);
  assert.deepEqual(f.scrolls, []); assert.equal(f.document.activeElement, f.document.body); assert.equal(f.window.scrollY, 220);
});

test("untouched valid Back history wins over an earlier static Saved scroll capture", async () => {
  const state = stale(), f = fixture({ state }); f.window.scrollY = 440; f.savedLink.dispatch("click");
  f.location.hash = "#saved"; f.history.state = null;
  f.location.hash = ""; f.history.state = state; f.start(); await f.flush(); await f.resolve(); f.frames();
  assert.equal(f.input.value, "WIC"); assert.equal(f.ids().length, 120); assert.equal(f.scrolls.at(-1), 900);
});


test("Back to the pre-runtime Saved entry can Browse the accepted early return again", async () => {
  const f = fixture(); f.type(london); f.staticSavedBrowse(455); f.start(); await f.flush(); await f.resolve(); f.frames();
  assertLondon(f); const count = f.scrolls.length; f.historySaved(); f.window.scrollY = 30;
  f.leaveSaved(); await f.flush(); f.frames(); assertLondon(f);
  assert.equal(f.scrolls.length, count + 1); assert.equal(f.scrolls.at(-1), 455);
  assert.equal(f.history.state.rwnDirectory.query, london);
});
