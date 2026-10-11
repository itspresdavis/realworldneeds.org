import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { phoneLinks, phoneMarkup } from "../src/utils/phone.js";
import { resources } from "../src/data/resources.js";

const read = (path) => readFile(path, "utf8");
const escapeHtml = (text) => String(text ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const targets = (html) => [...html.matchAll(/href="(tel:[^"]*)"/g)].map((match) => match[1]);
const cases = [
  ["01727 613019 Our phone-line is open Monday-Friday 9:30am-5:30pm", ["tel:01727613019"]],
  ["07507648948 / 07454726061", ["tel:07507648948", "tel:07454726061"]],
  ["07902933297/02891817487", ["tel:07902933297", "tel:02891817487"]],
  ["07384 213621 or 0121 359 0801", ["tel:07384213621", "tel:01213590801"]],
  ["01252 331668 (Tue, Wed & Fri 09:30-14:30) / 07880 831029", ["tel:01252331668", "tel:07880831029"]],
  ["  (202) 555-0123  ", ["tel:2025550123"]],
  ["+44 20 7946 0958", ["tel:+442079460958"]],
  ["+1 (202) 555-0123", ["tel:+12025550123"]],
  ["(202) 555–0123", ["tel:2025550123"]],
  ["(202) 555-0123 Ext:1364", ["tel:2025550123;ext=1364"]],
  ["(202) 555-0123 ext. 227", ["tel:2025550123;ext=227"]],
  ["(202) 555-0123 x42", ["tel:2025550123;ext=42"]],
  ["(202) 555-0123 WIC - option 5", ["tel:2025550123"]],
  ["07427537437 Manned from 9 am to 12 noon", ["tel:07427537437"]],
  ["01274 292256 (part-time)", ["tel:01274292256"]],
  ["211", ["tel:211"]], ["121", ["tel:121"]],
  ["020 7946 0958 - 9-5 Mon-Fri", []], ["01234 567890 - 24 hours", []],
  ["020 7946 0958 9-5 Mon-Fri", []], ["01234 567890 24 hours", []],
  ["555-1212 555-1313", []], ["01234 567890 9-5", []],
  ["01234 567890 24-hour helpline", []], ["555-1212 9.30-5.30 Mon-Fri", []],
  ["555-1212 9 -5 Mon-Fri", []], ["555-1212 9- 5 Mon-Fri", []],
  ["555-1212 9 30 Mon-Fri", []], ["555-1212 9.30 Mon-Fri", []],
  ["", []], [null, []], [undefined, []], ["use email address", []],
  ["07951749363/73", []], ["01255 431760/423328", []],
  ["0141 959 9813 - 07787 334 012", []],
  ["0750764894807454726061", []], ["+44 (0)20 7946 0958", []],
  ["2025550123 ext. unknown", []], ["2025550123 ext 1234567", []],
  ["2025550123+2025550456", []], ["(202 555-0123", []],
  ["2025550123<script>alert(1)</script>", []],
];

test("phone parsing separates complete dial targets from alternatives, annotations and extensions", () => {
  for (const [value, expected] of cases) {
    assert.deepEqual(phoneLinks(value).map(({ href }) => href), expected, String(value));
    assert.equal(phoneMarkup(value).replace(/<\/?a(?: [^>]*)?>/g, ""), escapeHtml(value), "the exact original text must remain readable");
  }
});

const fixture = (phone) => ({ id: "synthetic-phone", name: "Synthetic service", kind: "direct", category: "food", categoryLabels: ["Food"], place: "Example", checked: "2026-10-10", sourceUrl: "https://example.org", phone, phoneLinks: phoneLinks(phone), services: [], lastChecked: "2026-10-10" });
const functionSource = (source, name, next) => source.slice(source.indexOf(`function ${name}(`), source.indexOf(`\nfunction ${next}(`));

class Element {
  constructor(tag = "div") { this.tag = tag; this.children = []; this.dataset = {}; this.style = { setProperty() {} }; this.classList = { add() {}, toggle() {} }; }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener() {}
  get childElementCount() { return this.children.length; }
}
const domTargets = (element) => [element.href, ...element.children.flatMap(domTargets)].filter((href) => href?.startsWith("tel:"));
const domText = (element) => [element.textContent || "", ...element.children.flatMap(domText)].join(" ");
const document = { createElement: (tag) => new Element(tag) };

test("finder direct actions and inspector use the same safe targets and preserve contact text", async () => {
  const actions = await read("src/result-actions.js");
  const app = await read("src/app.js");
  for (const [phone, expected] of cases) {
    const resource = fixture(phone);
    const article = new Element();
    article.querySelector = () => ({ dataset: { resourceId: resource.id }, replaceWith() {} });
    const context = vm.createContext({ document, phoneLinks, navigator: { userAgent: "" }, resourceById: new Map([[resource.id, resource]]) });
    const body = actions.slice(actions.indexOf("function directionsUrl("), actions.indexOf("\nfunction enhanceResults("));
    vm.runInContext(`${body}\nenhanceCard(article);`, Object.assign(context, { article }));
    assert.deepEqual(domTargets(article), expected);
    vm.runInContext("enhanceCard(article)", context);
    assert.deepEqual(domTargets(article), expected, "repeated enhancement must not duplicate call links");
    const panel = new Element();
    const inspector = vm.createContext({
      phoneMarkup, document: { getElementById: (id) => id === "resourcePanel" ? panel : null, querySelector: () => null },
      selectedResource: () => resource, state: { inspectorOpen: true, savedIds: new Set(), filtered: [resource] },
      categories: { food: {} }, isExactServiceSite: () => false, freeAccessModels: {}, freeAccessLabel: () => "Free",
      icon: {}, formatResourcePlace: () => "Example", sourceClosureMarkup: () => "", serviceLayerTags: () => "",
      window: { innerWidth: 500 }, availabilityInstructions: () => "Check details", kindLabel: () => "Service", checkedDate: (date) => date,
    });
    vm.runInContext(`${functionSource(app, "renderResourcePanel", "resourceCard")}\nrenderResourcePanel();`, inspector);
    assert.deepEqual(targets(panel.innerHTML), expected);
    if (phone) assert.ok(panel.innerHTML.includes(phoneMarkup(phone)));
  }
});

test("every static action generator rejects ambiguous phone targets", async () => {
  const build = await read("scripts/build.mjs");
  const enhancement = await read("scripts/enhance-generated-pages.mjs");
  const professional = await read("scripts/professional-seo.mjs");
  const bodies = [
    [functionSource(build, "directoryRecordActions", "resourceRecord"), "directoryRecordActions"],
    [functionSource(enhancement, "serviceNextStepMarkup", "assetLinks"), "serviceNextStepMarkup"],
    [functionSource(professional, "directoryQuickActions", "serviceActions"), "directoryQuickActions"],
    [functionSource(professional, "serviceActions", "enhanceActionOrientation"), "serviceActions"],
  ];
  for (const [body, name] of bodies) {
    const context = vm.createContext({ phoneLinks, escapeHtml, sourceClosureNotice: () => null });
    vm.runInContext(body, context);
    for (const [phone, expected] of cases) assert.deepEqual(targets(context[name](fixture(phone), "")), expected, name);
  }
});

test("directory and offline fallback use build-parsed phone targets without new module dependencies", async () => {
  const renderer = await read("public/directory-results.js");
  const offline = await read("public/offline-status.js");
  const shipped = await read("dist/directory.js");
  const createRow = (source) => {
    const context = vm.createContext({ document, navigator: { onLine: true } });
    vm.runInContext(`${source.replace("export const createResultRow", "const createResultRow")}\nglobalThis.row = createResultRow;`, context);
    return context.row;
  };
  const rows = [createRow(renderer), createRow(shipped.slice(0, shipped.indexOf('const root=document.querySelector')))];
  const offlineBody = offline.slice(offline.indexOf("  const actionLink ="), offline.indexOf("  const setOffline ="));
  for (const [phone, expected] of cases) {
    const resource = fixture(phone);
    for (const row of rows) {
      const rendered = row(resource, {});
      assert.deepEqual(domTargets(rendered), expected);
      if (phone) assert.ok(domText(rendered).includes(phone));
    }
    let wrapper;
    const link = new Element("a");
    link.closest = () => null;
    link.before = (element) => { wrapper = element; };
    const context = vm.createContext({
      document: { ...document, querySelectorAll: () => [link] }, catalog: async () => ({ records: [resource] }),
      resultId: () => resource.id, setOffline() {}, offline: false,
    });
    vm.runInContext(`${offlineBody}\nglobalThis.enhance = enhanceSearchActions;`, context);
    await context.enhance();
    assert.deepEqual(domTargets(wrapper), expected);
    if (phone) assert.ok(domText(wrapper).includes(phone));
    // An older cached index has no parsed targets. It must never revive the old
    // digit-stripping behavior while the fresh index is still unavailable.
    const { phoneLinks: _, ...oldRecord } = resource;
    for (const row of rows) {
      const rendered = row(oldRecord, {});
      assert.deepEqual(domTargets(rendered), []);
      if (phone) assert.ok(domText(rendered).includes(phone));
    }
  }
  assert.doesNotMatch(shipped, /\bimport\s/);
  assert.ok(Buffer.byteLength(shipped) <= 14_000);
});

test("built service pages, directory records and search index agree on every phone target", async () => {
  const index = JSON.parse(await read("dist/data/search-index.json"));
  const byId = new Map(resources.map((resource) => [resource.id, resource]));
  for (const record of index.records) {
    const resource = byId.get(record.id);
    assert.deepEqual(record.phoneLinks, phoneLinks(resource.phone));
    assert.equal(record.phone, resource.phone || "");
    const html = await read(`dist/service/${record.id}/index.html`);
    assert.deepEqual([...new Set(targets(html))].sort(), [...new Set(record.phoneLinks.map(({ href }) => href))].sort(), record.id);
    if (resource.phone) assert.ok(html.includes(`<dt>Phone</dt><dd>${phoneMarkup(resource.phone)}</dd>`));
  }
  const files = await readdir("dist/directory", { recursive: true });
  for (const file of files.filter((path) => path.endsWith("index.html"))) {
    const html = await read(`dist/directory/${file}`);
    for (const match of html.matchAll(/<article class="directory-record" id="([^"]+)"[\s\S]*?<\/article>/g)) {
      const expected = phoneLinks(byId.get(match[1]).phone).map(({ href }) => href);
      assert.deepEqual([...new Set(targets(match[0]))].sort(), [...new Set(expected)].sort(), match[1]);
    }
  }
});
