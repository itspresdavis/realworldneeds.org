import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const start = app.indexOf('  const siteMenu = document.querySelector(".site-menu");');
const end = app.indexOf('  window.addEventListener("popstate"', start);
assert.ok(start >= 0 && end > start);
const source = app.slice(start, end);

function fixture() {
  const events = {}, summary = {}, link = {}, input = {}, outside = {};
  const menu = {
    open: true,
    contains: (element) => [menu, summary, link].includes(element),
    querySelector: () => summary,
    querySelectorAll: () => [],
    removeAttribute: () => { menu.open = false; },
  };
  const document = { activeElement: summary, querySelector: () => menu, addEventListener: (event, handler) => { events[event] = handler; } };
  summary.focus = () => { document.activeElement = summary; };
  vm.runInNewContext(source, { document, window: { addEventListener() {} } });
  return { events, menu, document, summary, link, input, outside };
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

test("Escape still closes navigation and returns focus to the summary", () => {
  const f = fixture(); let prevented = false;
  f.document.activeElement = f.link;
  f.events.keydown({ key: "Escape", preventDefault: () => { prevented = true; } });
  assert.equal(f.menu.open, false);
  assert.equal(f.document.activeElement, f.summary);
  assert.equal(prevented, true);
});
