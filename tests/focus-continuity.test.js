import { isContactOnly, hasMapCoordinates, contactOnlyNotice, contactOnlyLabel } from "../src/utils/resource-location.js";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
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
  document.getElementById = (id) => document.body.querySelector(`#${id}`);
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
    setResourceSaved: (id, value) => { if (value) stored.add(id); else stored.delete(id); },
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

async function savedFixture(initialCount = 61) {
  const f = domFixture(), { document, Element } = f;
  const panel = new Element("section", { "data-saved-services": "" });
  const heading = new Element("h2", { tabindex: "-1" });
  const controls = Object.fromEntries(["summary", "status", "list", "retry", "clear", "confirmation", "more", "cancel", "confirm"].map((key) => [key, new Element(["retry", "clear", "more", "cancel", "confirm"].includes(key) ? "button" : "div", { [`data-saved-${key}`]: "" })]));
  const search = new Element("input");
  controls.confirmation.append(controls.cancel, controls.confirm);
  panel.append(heading, ...Object.entries(controls).filter(([key]) => !["cancel", "confirm"].includes(key)).map(([, element]) => element));
  document.body.append(panel, search);
  const ids = Array.from({ length: 61 }, (_, index) => `service-${index}`);
  let currentIds = ids.slice(0, initialCount), storageError = false;
  const events = {};
  const context = vm.createContext({ isContactOnly, hasMapCoordinates, contactOnlyNotice, contactOnlyLabel,
    document, URL, location: { hash: "#saved" }, navigator: {}, SAVED_RESOURCES_KEY: "saved",
    window: { addEventListener: (name, handler) => { events[name] = handler; } },
    fetch: () => Promise.resolve({ ok: true, json: async () => ({ records: ids.map((id) => ({ id, name: id })) }) }),
    readSavedResources: () => { if (storageError) throw new Error("denied"); return new Set(currentIds); },
    setResourceSaved: (id) => { currentIds = currentIds.filter((candidate) => candidate !== id); },
    clearSavedResources: () => { currentIds = []; },
    createResultRow: () => { const row = new Element(); row.append(new Element("a")); return row; },
  });
  vm.runInContext(saved.replace(/^import .*;\n/gm, "").replace("export function", "function").replace("import.meta.url", '"https://www.realworldneeds.org/saved-services.js"') + "\ninitSavedServices();", context);
  await settle();
  return { ...f, ...controls, heading, search, events,
    setIds: (count) => { currentIds = ids.slice(0, count); },
    denyStorage: () => { storageError = true; },
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
