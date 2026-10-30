import { isContactOnly, hasMapCoordinates, contactOnlyNotice, contactOnlyLabel } from "../src/utils/resource-location.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const catalogLoader = (await readFile(new URL("../public/catalog-request.js", import.meta.url), "utf8")).replaceAll("export ", "");
const saved = await readFile(new URL("../public/saved-services.js", import.meta.url), "utf8");
const between = (start, end) => {
  const first = app.indexOf(start), last = app.indexOf(end, first);
  assert.ok(first >= 0 && last > first, `Missing source boundary: ${start}`);
  return app.slice(first, last);
};
const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

// A small DOM model for focus ownership. Removing a focused subtree returns
// activeElement to body, matching the browser behavior these regressions guard.
function domFixture() {
  const document = { activeElement: null };
  class Element {
    constructor(tag = "div", attributes = {}) {
      this.tagName = tag.toUpperCase(); this.attributes = attributes; this.children = [];
      this.dataset = {}; this.events = {}; this.hidden = false; this.disabled = false;
      this.style = { setProperty() {} }; this.classList = { add() {}, toggle() {} };
      for (const [name, value] of Object.entries(attributes)) this.setAttribute(name, value);
    }
    get id() { return this.attributes.id || ""; }
    set id(value) { this.attributes.id = value; }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
      if (name === "tabindex") this.tabIndex = Number(value);
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; }
    get isConnected() { return this === document.body || Boolean(this.parent?.isConnected); }
    getClientRects() { return this.isConnected && !this.hidden && (!this.parent || this.parent.getClientRects().length) ? [{}] : []; }
    contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
    matches(selector) {
      if (selector.includes(",")) return selector.split(",").some((part) => this.matches(part.trim()));
      if (selector.startsWith("#")) return this.id === selector.slice(1);
      if (selector.startsWith("[")) return Object.hasOwn(this.attributes, selector.slice(1, -1)) || Object.hasOwn(this.dataset, selector.slice(6, -1).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()));
      return this.tagName === selector.toUpperCase();
    }
    querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector) || null; }
    append(...nodes) { for (const node of nodes) { node.parent = this; this.children.push(node); } }
    remove() {
      if (this.contains(document.activeElement)) document.activeElement = document.body;
      if (this.parent) this.parent.children = this.parent.children.filter((node) => node !== this);
      this.parent = null;
    }
    replaceChildren(...nodes) { [...this.children].forEach((child) => child.remove()); this.append(...nodes); }
    set innerHTML(html) {
      this.replaceChildren();
      for (const match of html.matchAll(/<(button|h2)\b([^>]*)>/g)) {
        const attributes = {};
        for (const attribute of match[2].matchAll(/([\w-]+)="([^"]*)"/g)) attributes[attribute[1]] = attribute[2];
        if (!attributes.id && match[1] !== "h2") continue;
        const child = new Element(match[1], attributes);
        child.disabled = /\bdisabled\b/.test(match[2]);
        this.append(child);
      }
    }
    focus() {
      if (!this.getClientRects().length || this.disabled) return;
      if (!["BUTTON", "A", "INPUT", "TEXTAREA", "BODY"].includes(this.tagName) && this.tabIndex === undefined) return;
      document.activeElement = this;
    }
    select() { this.focus(); }
    scrollIntoView() {}
    addEventListener(event, callback) { this.events[event] = callback; }
    click() { if (!this.disabled) return this.events.click?.({ currentTarget: this, target: this }); }
  }
  document.body = new Element("body"); document.activeElement = document.body;
  document.getElementById = (id) => id ? document.body.querySelector(`#${id}`) : null;
  document.querySelector = (selector) => document.body.querySelector(selector);
  document.createElement = (tag) => new Element(tag);
  return { document, Element };
}

function inspectorFixture({ clipboard, execCommand = () => true, share } = {}) {
  const f = domFixture(), { document, Element } = f;
  const panel = new Element("aside", { id: "resourcePanel" });
  const toggle = new Element("button", { id: "openInspector" });
  const globeChrome = new Element(); globeChrome.append(toggle);
  const search = new Element("input", { id: "resourceSearch" });
  document.body.append(panel, globeChrome, search);
  document.execCommand = execCommand;
  const records = ["first", "second", "third"].map((id) => ({ id, name: id, category: "food", address: "10 Main St", services: [] }));
  const state = { filtered: records, selectedId: "second", inspectorOpen: true, savedIds: new Set() };
  let stored = new Set();
  const messages = [];
  const context = vm.createContext({ isContactOnly, hasMapCoordinates, contactOnlyNotice, contactOnlyLabel,
    document, state, navigator: { clipboard, share }, URL,
    window: { innerWidth: 1440, innerHeight: 1000, location: { href: "https://www.realworldneeds.org/" } },
    categories: { food: { color: "blue" } }, icon: {}, freeAccessModels: {}, reduceMotion: true,
    selectedResource: () => state.filtered.find((record) => record.id === state.selectedId),
    isExactServiceSite: (record) => record.exact !== false,
    freeAccessLabel: () => "Free", formatResourcePlace: () => "Test city", sourceClosureMarkup: () => "",
    serviceLayerTags: () => "", availabilityInstructions: () => "", kindLabel: () => "Service location",
    checkedDate: () => "Today", directionsUrl: () => "https://example.org", appleMapsUrl: () => "https://example.org",
    googleMapsUrl: () => "https://example.org", privateResourceUrl: (_, id) => new URL(`https://www.realworldneeds.org/#resource=${id}`),
    renderControls() {}, renderResults() {}, renderClusterTray() {}, focusGlobeOn() {}, writeFinderHistory() {},
    readSavedResources: () => new Set(stored), loadSavedResources: () => new Set(stored),
    resources: records,
    setResourceSaved: (id, value) => { if (value) stored.add(id); else stored.delete(id); return new Set(stored); },
    notify: (message) => messages.push(message),
    updateFilters: () => {
      state.filtered = records.filter((record) => state.savedIds.has(record.id));
      if (!state.filtered.some((record) => record.id === state.selectedId)) { state.selectedId = null; state.inspectorOpen = false; }
      context.renderResourcePanel();
    },
    pinSignature: "",
  });
  vm.runInContext(`${between("function renderResourcePanel()", "function resourceCard(")}\n${between("function setSelected(", "function downloadDirectory(")}`, context);
  panel.getBoundingClientRect = () => ({ top: 100, bottom: 600 });
  context.renderResourcePanel();
  return { ...f, context, state, panel, toggle, globeChrome, search, messages, records, control: (id) => document.getElementById(id) };
}

test("inspector Save retains focus on the replacement button through repeated save/remove", () => {
  const f = inspectorFixture();
  for (const expected of [true, false, true]) {
    const button = f.control("saveResource"); button.focus(); button.click();
    assert.equal(f.document.activeElement, f.control("saveResource"));
    assert.equal(f.control("saveResource").getAttribute("aria-pressed"), String(expected));
  }
});

test("inspector marks unreadable Saved membership unavailable without a false unpressed state", () => {
  const f = inspectorFixture();
  f.state.savedStorageUnavailable = true;
  f.context.renderResourcePanel();
  assert.equal(f.control("saveResource").disabled, true);
  assert.equal(f.control("saveResource").getAttribute("aria-pressed"), null);
  assert.equal(f.control("saveResource").getAttribute("aria-label"), "Saving unavailable");
  assert.equal(f.control("saveResource").getAttribute("aria-describedby"), "savedStorageStatus");
  f.state.savedStorageUnavailable = false;
  f.context.renderResourcePanel();
  assert.equal(f.control("saveResource").disabled, false);
  assert.equal(f.control("saveResource").getAttribute("aria-pressed"), "false");
});

for (const [direction, initial, final] of [["nextResource", "first", "third"], ["previousResource", "third", "first"]]) {
  test(`inspector ${direction} preserves its replacement until the boundary, then focuses the heading`, () => {
    const f = inspectorFixture(); f.state.selectedId = initial; f.context.renderResourcePanel();
    f.control(direction).focus(); f.control(direction).click();
    assert.equal(f.document.activeElement, f.control(direction));
    f.control(direction).click();
    assert.equal(f.state.selectedId, final);
    assert.equal(f.control(direction).disabled, true);
    assert.equal(f.document.activeElement, f.panel.querySelector("h2"));
  });
}

test("closing inspector returns focus to its visible opener, which can reopen details", () => {
  const f = inspectorFixture(); f.control("closeInspector").focus(); f.control("closeInspector").click();
  assert.equal(f.panel.hidden, true); assert.equal(f.toggle.hidden, false);
  assert.equal(f.document.activeElement, f.toggle);
  f.state.inspectorOpen = true; f.context.renderResourcePanel();
  assert.equal(f.document.activeElement, f.panel.querySelector("h2"));
});

test("removing the selected service in Saved-only view returns to search when details disappear", () => {
  const f = inspectorFixture(); f.control("saveResource").click(); f.state.savedOnly = true;
  f.control("saveResource").focus(); f.control("saveResource").click();
  assert.equal(f.panel.hidden, true); assert.equal(f.document.activeElement, f.search);
});

test("Close returns to search when unavailable map chrome hides the inspector opener", () => {
  const f = inspectorFixture(); f.globeChrome.hidden = true;
  f.control("closeInspector").focus(); f.control("closeInspector").click();
  assert.equal(f.panel.hidden, true); assert.equal(f.toggle.getClientRects().length, 0);
  assert.equal(f.document.activeElement, f.search);
});

test("background inspector rerenders never move focus away from search", () => {
  const f = inspectorFixture(); f.search.focus(); f.context.renderResourcePanel();
  assert.equal(f.document.activeElement, f.search);
});

test("background removal of a closed inspector's service recovers its focused opener to search", () => {
  const f = inspectorFixture(); f.control("closeInspector").focus(); f.control("closeInspector").click();
  f.toggle.focus(); f.state.selectedId = null; f.context.renderResourcePanel();
  assert.equal(f.toggle.hidden, true); assert.equal(f.document.activeElement, f.search);
});

for (const failure of ["rejected clipboard", "false legacy result", "throwing legacy copy"]) {
  test(`address and share announce accurate failure for ${failure}`, async () => {
    const options = failure === "rejected clipboard"
      ? { clipboard: { writeText: async () => { throw new Error("denied"); } } }
      : { execCommand: () => { if (failure === "throwing legacy copy") throw new Error("denied"); return false; } };
    const f = inspectorFixture(options);
    for (const id of ["copyAddress", "shareResource"]) {
      f.control(id).focus();
      await assert.doesNotReject(async () => f.control(id).click());
      assert.match(f.messages.at(-1), /could not be copied/i);
      assert.doesNotMatch(f.messages.at(-1), /^(Address|Coverage|Service link) copied$/);
      assert.equal(f.document.body.querySelectorAll("textarea").length, 0);
      assert.equal(f.document.activeElement, f.control(id));
    }
  });
}

test("successful legacy copy cleans up and preserves the initiating control", async () => {
  const f = inspectorFixture(); f.control("copyAddress").focus();
  await f.control("copyAddress").click();
  assert.equal(f.messages.at(-1), "Address copied");
  assert.equal(f.document.body.querySelectorAll("textarea").length, 0);
  assert.equal(f.document.activeElement, f.control("copyAddress"));
});

test("coverage copy and successful shared-link fallback use accurate success messages", async () => {
  const copied = [];
  const f = inspectorFixture({ clipboard: { writeText: async (value) => copied.push(value) }, share: async () => { throw new Error("unavailable"); } });
  f.records[1].exact = false; f.context.renderResourcePanel();
  await f.control("copyAddress").click();
  assert.equal(f.messages.at(-1), "Coverage copied");
  await f.control("shareResource").click();
  assert.equal(f.messages.at(-1), "Service link copied");
  assert.deepEqual(copied, ["10 Main St", "https://www.realworldneeds.org/#resource=second"]);
});

test("cancelling native Share does not copy or announce a failure", async () => {
  const f = inspectorFixture({ share: async () => { throw Object.assign(new Error("cancelled"), { name: "AbortError" }); }, clipboard: { writeText: () => assert.fail("Cancelled Share must not copy") } });
  await f.control("shareResource").click(); assert.deepEqual(f.messages, []);
});

async function savedFixture(initialCount = 61, { fetchCatalog, pendingCatalog = false, storageUnavailable = false, emptyNode = false, hash = "#saved", originalTitle = "Food services in New York | Real World Needs" } = {}) {
  const f = domFixture(), { document, Element } = f;
  const panel = new Element("section", { "data-saved-services": "" });
  const heading = new Element("h2", { tabindex: "-1" });
  heading.getBoundingClientRect = () => ({ top: 100, bottom: 140, height: 40 });
  const controls = Object.fromEntries(["summary", "status", "list", "retry", "clear", "confirmation", "more", "cancel", "confirm", ...(emptyNode ? ["empty"] : [])].map((key) => [key, new Element(["retry", "clear", "more", "cancel", "confirm"].includes(key) ? "button" : "div", { [`data-saved-${key}`]: "" })]));
  if (controls.empty) controls.empty.hidden = true;
  const search = new Element("input", { "data-directory-query": "" });
  const results = new Element("section", { id: "directory-results", tabindex: "-1" });
  const navigation = [
    new Element("a", { href: "/directory", "aria-current": "page" }),
    new Element("a", { href: "/directory#saved" }),
    new Element("a", { href: "/directory/help/food", "aria-current": "location" }),
    new Element("a", { href: "/sources", "aria-current": "false" }),
    new Element("a", { href: "/directory#saved", class: "rwn-saved-link" }),
  ];
  const outsideNavigation = new Element("a", { href: "/directory#saved", "aria-current": "location" });
  const initialNavigation = navigation.map((link) => link.getAttribute("aria-current"));
  document.title = originalTitle;
  document.querySelectorAll = (selector) => selector === ".legal-header nav a, .rwn-saved-link" ? navigation
    : selector === ".legal-header nav a" ? navigation.slice(0, -1) : document.body.querySelectorAll(selector);
  const classes = new Set();
  const shell = { classList: { contains: (value) => classes.has(value), toggle: (value, active) => active ? classes.add(value) : classes.delete(value) } };
  panel.closest = (selector) => selector === ".directory-shell" ? shell : null;
  controls.confirmation.append(controls.cancel, controls.confirm);
  panel.append(heading, ...Object.entries(controls).filter(([key]) => !["cancel", "confirm"].includes(key)).map(([, element]) => element));
  document.body.append(panel, search, results, ...navigation, outsideNavigation);
  const ids = Array.from({ length: 61 }, (_, index) => `service-${index}`);
  let currentIds = ids.slice(0, initialCount), storageError = storageUnavailable;
  const timers = new Map(); let now = 0, nextTimer = 0;
  const events = {}, workerEvents = {}, effects = { reads: 0, writes: 0, fetches: 0 }, requests = [];
  const navigator = { onLine: true, serviceWorker: { addEventListener(type, handler) { workerEvents[type] = handler; } } };
  const location = { hash }, history = { state: null }, restores = [];
  const response = { ok: true, json: async () => ({ records: ids.map((id) => ({ id, name: id })) }) };
  let resolveCatalog, rejectCatalog;
  const catalog = pendingCatalog ? new Promise((resolve, reject) => { resolveCatalog = resolve; rejectCatalog = reject; }) : Promise.resolve(response);
  const context = vm.createContext({ isContactOnly, hasMapCoordinates, contactOnlyNotice, contactOnlyLabel,
    document, URL, location, history, navigator, AbortController,
    setTimeout(callback, delay) { timers.set(++nextTimer, { at: now + delay, callback }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); }, SAVED_RESOURCES_KEY: "saved",
    CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    window: {
      innerHeight: 900, scrollX: 0, scrollY: 0, scrollTo() {},
      addEventListener: (name, handler) => { events[name] = handler; },
      dispatchEvent: (event) => { restores.push(event); return true; },
    },
    fetch: (...args) => { effects.fetches += 1; requests.push(args); return fetchCatalog ? fetchCatalog(...args) : catalog; },
    readSavedResources: () => { effects.reads += 1; if (storageError) throw new Error("denied"); return new Set(currentIds); },
    setResourceSaved: (id) => { effects.writes += 1; currentIds = currentIds.filter((candidate) => candidate !== id); },
    clearSavedResources: () => { effects.writes += 1; currentIds = []; },
    createResultRow: record => { const row = new Element(); row.renderedRecord = structuredClone(record); row.renderedOnline = navigator.onLine; row.append(new Element("a")); return row; },
  });
  vm.runInContext(catalogLoader + "\n" + saved.replace(/^import .*;\n/gm, "").replace("export function", "function").replace("import.meta.url", '"https://www.realworldneeds.org/saved-services.js"') + "\ninitSavedServices();", context);
  await settle();
  return { ...f, ...controls, heading, search, results, events, effects, location, history, restores, navigation, initialNavigation, outsideNavigation, originalTitle,
    timers, workerEvents, requests, navigator, savedIds: () => [...currentIds],
    advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.callback(); } },
    setIds: (count) => { currentIds = ids.slice(0, count); },
    denyStorage: () => { storageError = true; },
    allowStorage: () => { storageError = false; },
    finishCatalog: async () => { resolveCatalog(response); await settle(); },
    failCatalog: async () => { rejectCatalog(new Error("offline")); await settle(); },
    refresh: async () => { events.storage({ key: "saved" }); await settle(); },
  };
}

test("a cross-tab clear recovers focus when Clear saved list becomes hidden", async () => {
  const f = await savedFixture(); f.clear.focus(); f.setIds(0); await f.refresh();
  assert.equal(f.clear.hidden, true); assert.equal(f.document.activeElement, f.heading);
});

test("a shorter cross-tab list recovers focus when Show more becomes hidden", async () => {
  const f = await savedFixture(); assert.equal(f.more.hidden, false);
  f.more.focus(); f.setIds(2); await f.refresh();
  assert.equal(f.more.hidden, true); assert.equal(f.document.activeElement, f.heading);
});

for (const control of ["clear", "more"]) {
  test(`storage denial recovers focus when ${control} becomes unavailable`, async () => {
    const f = await savedFixture(); f[control].focus(); f.denyStorage(); await f.refresh();
    assert.equal(f.retry.hidden, false); assert.equal(f.document.activeElement, f.heading);
  });
  test(`background refresh preserves ${control} focus while the control stays available`, async () => {
    const f = await savedFixture(); f[control].focus(); await f.refresh();
    assert.equal(f.document.activeElement, f[control]);
  });
}

test("a cross-tab clear never steals focus from another control", async () => {
  const f = await savedFixture(); f.search.focus(); f.setIds(0); await f.refresh();
  assert.equal(f.document.activeElement, f.search);
});

test("an async storage refresh respects focus moved elsewhere while catalog work settles", async () => {
  const f = await savedFixture(); f.more.focus(); f.setIds(2);
  f.events.storage({ key: "saved" }); f.search.focus(); await settle();
  assert.equal(f.more.hidden, true); assert.equal(f.document.activeElement, f.search);
});

test("saved row removal and an open clear confirmation keep their existing focus recovery", async () => {
  const f = await savedFixture(2); const first = f.list.children[0].querySelector("[data-saved-remove]");
  first.focus(); await first.click(); await settle();
  assert.equal(f.document.activeElement, f.list.children[0].querySelector("[data-saved-remove]"));
  f.clear.click(); assert.equal(f.document.activeElement, f.cancel);
  await f.refresh(); assert.equal(f.document.activeElement, f.cancel);
});


test("Saved empty guidance appears after a successful empty read without fetching or mutating storage", async () => {
  const f = await savedFixture(0);
  assert.equal(f.summary.textContent, "No saved services yet. Open a listing and choose Save to keep it here.");
  assert.match(f.summary.textContent, /No saved services yet/);
  assert.equal(f.retry.hidden, true);
  assert.equal(f.clear.hidden, true);
  assert.equal(f.document.activeElement, f.heading);
  assert.deepEqual(f.effects, { reads: 1, writes: 0, fetches: 0 });
});

test("Saved summary never claims empty while populated details load or after they resolve", async () => {
  const f = await savedFixture(2, { pendingCatalog: true });
  assert.doesNotMatch(f.summary.textContent || "", /No saved services yet/);
  assert.match(f.summary.textContent, /Loading/);
  assert.equal(f.list.children.length, 0);
  f.search.focus();
  await f.finishCatalog();
  assert.doesNotMatch(f.summary.textContent || "", /No saved services yet/);
  assert.equal(f.list.children.length, 2);
  assert.match(f.summary.textContent, /2 saved listings/);
  assert.equal(f.document.activeElement, f.search, "finishing background work must not steal focus");
  assert.equal(f.effects.writes, 0);
});

test("Saved empty guidance never misrepresents unavailable storage as an empty list", async () => {
  const f = await savedFixture(0, { storageUnavailable: true });
  assert.doesNotMatch(f.summary.textContent || "", /No saved services yet/);
  assert.equal(f.retry.hidden, false);
  assert.match(f.summary.textContent, /unavailable in this browser/);
  assert.deepEqual(f.effects, { reads: 1, writes: 0, fetches: 0 });
  f.retry.focus();
  f.allowStorage();
  await f.retry.click();
  assert.equal(f.summary.textContent, "No saved services yet. Open a listing and choose Save to keep it here.");
  assert.equal(f.document.activeElement, f.heading, "a successful retry retains heading focus recovery");
  f.denyStorage();
  await f.refresh();
  assert.doesNotMatch(f.summary.textContent || "", /No saved services yet/, "a later failed read replaces stale empty guidance");
  assert.equal(f.effects.writes, 0);
});

test("Saved catalog errors replace the summary honestly and keep saved IDs untouched", async () => {
  const f = await savedFixture(2, { pendingCatalog: true });
  await f.failCatalog();
  assert.doesNotMatch(f.summary.textContent || "", /No saved services yet/);
  assert.equal(f.retry.hidden, false);
  assert.match(f.summary.textContent, /saved list is still on this device.*could not load/);
  assert.equal(f.effects.writes, 0);
});

test("cross-tab empty, populated and empty transitions cancel stale details and preserve focus", async () => {
  const f = await savedFixture(0, { pendingCatalog: true });
  assert.equal(f.summary.textContent, "No saved services yet. Open a listing and choose Save to keep it here.");
  f.search.focus();
  f.setIds(2);
  await f.refresh();
  assert.doesNotMatch(f.summary.textContent || "", /No saved services yet/);
  assert.match(f.summary.textContent, /Loading/);
  f.setIds(0);
  await f.refresh();
  assert.equal(f.summary.textContent, "No saved services yet. Open a listing and choose Save to keep it here.");
  await f.finishCatalog();
  assert.equal(f.summary.textContent, "No saved services yet. Open a listing and choose Save to keep it here.");
  assert.equal(f.list.children.length, 0, "the obsolete populated request must not repopulate the list");
  assert.match(f.summary.textContent, /No saved services yet/);
  f.setIds(1);
  await f.refresh();
  assert.doesNotMatch(f.summary.textContent || "", /No saved services yet/);
  assert.equal(f.list.children.length, 1);
  const remove = f.list.children[0].querySelector("[data-saved-remove]");
  remove.focus();
  f.setIds(0);
  f.events.storage({ key: null });
  await settle();
  assert.equal(f.summary.textContent, "No saved services yet. Open a listing and choose Save to keep it here.");
  assert.equal(f.document.activeElement, f.heading, "cross-tab clearing the focused last row still recovers to the heading");
  assert.equal(f.effects.writes, 0);
});

test("inactive Saved and unrelated storage events never read private storage or fetch details", async () => {
  const f = await savedFixture(0, { hash: "#directory-results" });
  for (const name of ["pageshow", "online", "offline"]) f.events[name]();
  f.events.storage({ key: "saved" });
  f.events.storage({ key: "unrelated" });
  await settle();
  assert.doesNotMatch(f.summary.textContent || "", /No saved services yet/);
  assert.deepEqual(f.effects, { reads: 0, writes: 0, fetches: 0 });
  f.location.hash = "#saved";
  f.events.hashchange();
  await settle();
  assert.equal(f.summary.textContent, "No saved services yet. Open a listing and choose Save to keep it here.");
  assert.equal(f.document.activeElement, f.heading);
  f.events.storage({ key: "unrelated" });
  await settle();
  assert.deepEqual(f.effects, { reads: 1, writes: 0, fetches: 0 });
});

test("Saved summary works with new markup and keeps the retired cached empty card hidden", async () => {
  for (const emptyNode of [false, true]) for (const count of [0, 2]) {
    const f = await savedFixture(count, { emptyNode });
    assert.equal(f.list.children.length, count);
    assert.match(f.summary.textContent, count ? /2 saved listings/ : /No saved services yet/);
    if (emptyNode) assert.equal(f.empty.hidden, true);
    assert.equal(f.effects.writes, 0);
  }
});


function assertSavedNavigation(f) {
  assert.equal(f.document.title, "Saved services | Real World Needs");
  assert.deepEqual(f.navigation.map((link) => link.getAttribute("aria-current")), [null, "page", null, null, "page"]);
  assert.equal(f.outsideNavigation.getAttribute("aria-current"), "location", "only header navigation is changed");
}

function assertDirectoryNavigation(f) {
  assert.equal(f.document.title, f.originalTitle);
  assert.deepEqual(f.navigation.map((link) => link.getAttribute("aria-current")), f.initialNavigation);
  assert.equal(f.outsideNavigation.getAttribute("aria-current"), "location");
}

test("direct Saved entry identifies both header Saved links and restores exact original semantics on Browse", async () => {
  const f = await savedFixture(0);
  assertSavedNavigation(f);
  assert.equal(f.document.activeElement, f.heading);
  f.location.hash = "#directory-results";
  f.events.hashchange();
  await settle();
  assertDirectoryNavigation(f);
  assert.equal(f.document.activeElement, f.results);
  assert.equal(f.restores.length, 1);
  assert.equal(f.restores[0].type, "rwn-directory-restore");
  assert.equal(f.restores[0].detail, "browse");
  assert.equal(f.restores[0].cancelable, true);
  assert.equal(f.effects.writes, 0);
});

test("Saved Back and Forward hash synchronization preserves the scoped title and initial aria-current values", async () => {
  const f = await savedFixture(0, { hash: "#directory-results", originalTitle: "Local food support | Real World Needs" });
  assertDirectoryNavigation(f);
  assert.equal(f.effects.reads, 0);
  for (const hash of ["#saved", "#directory-results", "#saved", "", "#saved", "#directory-results"]) {
    f.location.hash = hash;
    f.events.hashchange();
    await settle();
    if (hash === "#saved") {
      assertSavedNavigation(f);
      assert.equal(f.document.activeElement, f.heading);
    } else {
      assertDirectoryNavigation(f);
      assert.equal(f.document.activeElement, hash ? f.results : f.search);
    }
  }
  assert.deepEqual(f.restores.map((event) => event.detail), ["browse", "history", "browse"]);
  assert.equal(f.effects.writes, 0);
});

test("Saved cross-tab and connectivity refreshes preserve navigation, title and unrelated focus", async () => {
  const f = await savedFixture(2);
  f.search.focus();
  for (const count of [0, 1, 2]) {
    f.setIds(count);
    await f.refresh();
    for (const name of ["online", "offline", "pageshow"]) {
      f.events[name]();
      await settle();
      assertSavedNavigation(f);
      assert.equal(f.document.activeElement, f.search);
    }
  }
  assert.equal(f.restores.length, 0);
  assert.equal(f.effects.writes, 0);
});

test("pageshow restores the current hash semantics without moving focus or dispatching history restoration", async () => {
  const f = await savedFixture(0);
  f.search.focus();
  for (const hash of ["#directory-results", "#saved", ""]) {
    f.location.hash = hash;
    f.events.pageshow();
    await settle();
    if (hash === "#saved") assertSavedNavigation(f);
    else assertDirectoryNavigation(f);
    assert.equal(f.document.activeElement, f.search);
  }
  const reads = f.effects.reads;
  f.events.storage({ key: "saved" });
  f.events.online();
  f.events.offline();
  await settle();
  assertDirectoryNavigation(f);
  assert.equal(f.effects.reads, reads, "background activity must not read Saved after leaving its view");
  assert.equal(f.effects.writes, 0);
  assert.equal(f.restores.length, 0);
});

test("late Saved catalog resolution cannot overwrite Browse navigation, title or focus", async () => {
  const f = await savedFixture(2, { pendingCatalog: true });
  assertSavedNavigation(f);
  f.location.hash = "#directory-results";
  f.events.hashchange();
  await f.finishCatalog();
  assertDirectoryNavigation(f);
  assert.equal(f.document.activeElement, f.results);
  assert.equal(f.list.children.length, 0);
  assert.equal(f.effects.writes, 0);
});


for (const stage of ["headers", "JSON"]) {
  test(`Saved ${stage} timeout preserves IDs and focused Retry through coalesced recovery`, async () => {
    let attempts = 0, finish;
    const stalled = new Promise(() => {});
    const healthy = new Promise(resolve => { finish = resolve; });
    const f = await savedFixture(2, { fetchCatalog: () => ++attempts === 1 ? (stage === "headers" ? stalled : { ok: true, json: () => stalled }) : healthy });
    f.advance(8000); await settle();
    assert.equal(f.retry.hidden, false); assert.match(f.summary.textContent, /could not load/);
    assert.deepEqual(f.savedIds(), ["service-0", "service-1"]); assert.equal(f.effects.writes, 0);
    f.retry.focus(); f.retry.click(); await settle();
    assert.equal(f.retry.hidden, false); assert.equal(f.document.activeElement, f.retry);
    assert.equal(f.retry.getAttribute("aria-disabled"), "true");
    for (let i = 0; i < 5; i++) f.retry.click();
    await settle(); assert.equal(attempts, 2);
    finish({ ok: true, json: async () => ({ records: [{ id: "service-0", name: "Current listing" }] }) });
    await settle();
    assert.equal(f.retry.hidden, true); assert.equal(f.document.activeElement, f.heading);
    assert.equal(f.list.children.length, 2); assert.match(f.summary.textContent, /1 no longer/);
    assert.deepEqual(f.savedIds(), ["service-0", "service-1"]); assert.equal(f.effects.writes, 0);
  });
}

test("Saved online recovery replaces a stalled request and ignores its late success", async () => {
  let attempts = 0, finishOld;
  const old = new Promise(resolve => { finishOld = resolve; });
  const f = await savedFixture(1, { fetchCatalog: () => ++attempts === 1 ? old : { ok: true, json: async () => ({ records: [] }) } });
  f.events["rwn-connection-restored"](); await settle();
  assert.equal(attempts, 2); assert.match(f.summary.textContent, /1 no longer/);
  finishOld({ ok: true, json: async () => ({ records: [{ id: "service-0", name: "Withdrawn" }] }) });
  await settle();
  assert.match(f.summary.textContent, /1 no longer/); assert.equal(f.effects.writes, 0);
  f.events.offline(); await settle(); assert.equal(attempts, 2, "finished offline snapshot remains cached");
});

test("Saved navigation away supersedes timeout without restoring the panel or stealing focus", async () => {
  const f = await savedFixture(1, { fetchCatalog: () => new Promise(() => {}) });
  f.location.hash = "#directory-results"; f.events.hashchange(); f.search.focus();
  const summary = f.summary.textContent;
  f.advance(8000); await settle();
  assert.equal(f.summary.textContent, summary); assert.equal(f.document.activeElement, f.search);
  assert.equal(f.retry.hidden, true); assert.equal(f.effects.writes, 0);
});


const catalogResponse = records => ({ ok: true, json: async () => ({ records: structuredClone(records) }) });

test("Saved identical fresh catalog keeps row identity, pagination and focus through controller replacement", async () => {
  const records = Array.from({ length: 61 }, (_, index) => ({ id: `service-${index}`, name: `Service ${index}`, sourceStatus: { title: "Open", detail: "Check with provider" } }));
  let attempts = 0, finish;
  const refresh = new Promise(resolve => { finish = resolve; });
  const f = await savedFixture(61, { fetchCatalog: () => ++attempts === 1 ? catalogResponse(records) : refresh });
  f.more.click();
  const rows = [...f.list.children], link = rows[0].querySelector("a"), summary = f.summary.textContent;
  link.focus(); f.workerEvents.controllerchange(); await settle();
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1][0], "/data/search-index.json");
  assert.equal(f.requests[1][1].cache, "reload", "identity preservation must not skip a fresh release fetch");
  assert.equal(f.list.children[0], rows[0], "pending refresh retains the current pointer target");
  assert.equal(f.summary.textContent, summary, "pending refresh must not move rows by collapsing the summary");
  finish(catalogResponse(records)); await settle();
  assert.equal(f.list.children.length, 61);
  assert.ok(f.list.children.every((row, index) => row === rows[index]));
  assert.equal(f.document.activeElement, link);
  assert.equal(f.more.hidden, true);
  f.events["rwn-connection-restored"](); await settle();
  assert.ok(f.list.children.every((row, index) => row === rows[index]));
  assert.equal(attempts, 2, "completed catalog remains usable on ordinary connectivity notification");
  assert.equal(f.effects.writes, 0);
});

for (const [label, change] of [
  ["provider contact", { phone: "+1 617 555 0199", accessUrl: "https://example.invalid/new-contact" }],
  ["availability detail", { sourceStatus: { title: "Temporarily closed", detail: "New closure information" } }],
]) {
  test(`Saved same-ID fresh ${label} changes rebuild rows and preserve the matching control focus`, async () => {
    let records = [{ id: "service-0", name: "Same service", phone: "+1 617 555 0100", sourceStatus: { title: "Open", detail: "Old detail" } }];
    const f = await savedFixture(1, { fetchCatalog: () => catalogResponse(records) });
    const old = f.list.children[0]; old.querySelector("a").focus();
    records = [{ ...records[0], ...change }];
    f.workerEvents.controllerchange(); await settle();
    const current = f.list.children[0];
    assert.notEqual(current, old);
    assert.equal(old.isConnected, false);
    assert.deepEqual(current.renderedRecord, records[0]);
    assert.equal(f.document.activeElement, current.querySelector("a"));
    assert.deepEqual(f.savedIds(), ["service-0"]);
    assert.equal(f.requests[1][1].cache, "reload");
    assert.equal(f.effects.writes, 0);
  });
}

test("Saved withdrawn record becomes an unavailable row without deleting its saved ID", async () => {
  let records = [{ id: "service-0", name: "Withdrawn service" }];
  const f = await savedFixture(1, { fetchCatalog: () => catalogResponse(records) });
  const old = f.list.children[0]; records = [];
  f.workerEvents.controllerchange(); await settle();
  assert.notEqual(f.list.children[0], old);
  assert.equal(f.list.children[0].querySelector("a"), null);
  assert.match(f.summary.textContent, /1 no longer in the directory/);
  assert.deepEqual(f.savedIds(), ["service-0"]);
  assert.equal(f.effects.writes, 0);
});

test("Saved failed fresh reload clears old rows and identical-data recovery restores them", async () => {
  const records = [{ id: "service-0", name: "Original service" }];
  let attempts = 0;
  const f = await savedFixture(1, { fetchCatalog: () => ++attempts === 2 ? { ok: false } : catalogResponse(records) });
  const old = f.list.children[0];
  f.workerEvents.controllerchange(); await settle();
  assert.equal(f.list.children.length, 0);
  assert.match(f.summary.textContent, /could not load/);
  assert.equal(f.retry.hidden, false);
  assert.deepEqual(f.savedIds(), ["service-0"]);
  f.retry.focus(); await f.retry.click(); await settle();
  assert.equal(f.list.children.length, 1);
  assert.notEqual(f.list.children[0], old, "an identical signature cannot suppress rebuilding an emptied list");
  assert.deepEqual(f.list.children[0].renderedRecord, records[0]);
  assert.equal(f.document.activeElement, f.heading);
  assert.equal(f.requests[2][1].cache, "reload");
  assert.equal(f.effects.writes, 0);
});

test("Saved navigator mode changes rebuild offline click semantics even with unchanged records", async () => {
  const f = await savedFixture(1);
  let previous = f.list.children[0];
  for (const online of [false, true]) {
    f.navigator.onLine = online;
    f.events[online ? "online" : "offline"](); await settle();
    const current = f.list.children[0];
    assert.notEqual(current, previous);
    assert.equal(current.renderedOnline, online);
    f.events[online ? "online" : "offline"](); await settle();
    assert.equal(f.list.children[0], current, "an unchanged mode can retain the new rows");
    previous = current;
  }
  assert.equal(f.effects.writes, 0);
});
