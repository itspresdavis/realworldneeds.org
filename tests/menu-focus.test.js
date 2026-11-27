import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/page-menu.js", import.meta.url), "utf8");

function fixture() {
  const events = {}, windowEvents = {}, menuEvents = {}, body = {}, input = {}, outside = {};
  const window = { innerWidth: 800, matchMedia: () => ({ get matches() { return window.innerWidth <= 1088; } }), innerHeight: 700, addEventListener: (type, handler) => { windowEvents[type] = handler; } };
  const document = { body, activeElement: body, hasFocus: () => true,
    querySelector: () => menu, addEventListener: (type, handler) => { events[type] = handler; } };
  function control(kind, inMenu = true) {
    const node = { inMenu,
      closest: selector => selector === "summary, a[href]" ? node
        : selector === "a[href]" && kind === "link" ? node : null,
      focus: () => { document.activeElement = node; },
      getBoundingClientRect: () => ({ width: inMenu && window.innerWidth > 1088 ? 0 : 80,
        height: inMenu && window.innerWidth > 1088 ? 0 : 32, top: 10, bottom: 42 }) };
    return node;
  }
  const summary = control("summary"), link = control("link"), brand = control("link", false);
  const menu = {
    open: true, contains: node => node === menu || Boolean(node?.inMenu),
    querySelector: () => summary,
    closest: () => ({ querySelectorAll: () => [brand, link] }),
    addEventListener: (type, handler) => { menuEvents[type] = handler; },
    removeAttribute: () => { menu.open = false; },
  };
  document.activeElement = summary;
  vm.runInNewContext(source, { document, window,
    getComputedStyle: node => ({ visibility: "visible", display: node === menu && window.innerWidth > 1088 ? "none" : "block" }) });
  return { events, windowEvents, menuEvents, menu, document, window, summary, link, brand, input, outside, control };
}

function escape(target, updates = {}) {
  return { key: "Escape", target, preventDefault() { this.defaultPrevented = true; }, ...updates };
}

test("outside click preserves focus deliberately moved to the search input", () => {
  const f = fixture();
  f.document.activeElement = f.input;
  f.events.click({ target: f.input });
  assert.equal(f.menu.open, false);
  assert.equal(f.document.activeElement, f.input);
});

test("outside dismissal restores focus if it remained inside the closing menu", () => {
  const f = fixture();
  f.document.activeElement = f.link;
  f.events.click({ target: f.outside });
  assert.equal(f.menu.open, false);
  assert.equal(f.document.activeElement, f.summary);
});

test("Escape inside navigation closes it and returns focus to the summary", () => {
  const f = fixture(), event = escape(f.link);
  f.document.activeElement = f.link;
  f.events.keydown(event);
  assert.equal(f.menu.open, false);
  assert.equal(f.document.activeElement, f.summary);
  assert.equal(event.defaultPrevented, true);
});

test("Escape does not steal focus from search or override another interaction", () => {
  for (const variant of ["outside", "handled", "composition"]) {
    const f = fixture();
    f.document.activeElement = variant === "outside" ? f.input : f.link;
    const event = escape(f.document.activeElement, variant === "handled" ? { defaultPrevented: true }
      : variant === "composition" ? { isComposing: true } : {});
    f.events.keydown(event);
    assert.equal(f.menu.open, true, variant);
    assert.equal(f.document.activeElement, variant === "outside" ? f.input : f.link, variant);
  }
});

test("desktop reflow moves focus from hidden mobile navigation to visible header", () => {
  const f = fixture();
  f.document.activeElement = f.link;
  f.window.innerWidth = 1200;
  f.windowEvents.resize();
  assert.equal(f.menu.open, false);
  assert.equal(f.document.activeElement, f.brand);
});

test("native focus loss during desktop reflow is repaired without stealing deliberate focus", () => {
  const f = fixture();
  f.window.innerWidth = 1200;
  f.document.activeElement = f.document.body;
  f.menuEvents.focusout({ target: f.link, relatedTarget: null });
  assert.equal(f.document.activeElement, f.brand);
  f.document.activeElement = f.input;
  f.menuEvents.focusout({ target: f.link, relatedTarget: null });
  f.windowEvents.resize();
  assert.equal(f.document.activeElement, f.input);
});

test("links replaced by the presentation layer still close mobile navigation", () => {
  const f = fixture(), replacement = f.control("link");
  f.events.click({ target: replacement });
  assert.equal(f.menu.open, false);
});

test("home no longer replaces shared navigation or tracks page links as section links", async () => {
  const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
  const presentation = await readFile(new URL("../src/professional.js", import.meta.url), "utf8");
  assert.doesNotMatch(app, /data-section-link|const siteMenu =/);
  assert.doesNotMatch(presentation, /function rewriteNavigation/);
});
