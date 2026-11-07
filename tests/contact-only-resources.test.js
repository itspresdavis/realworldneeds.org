import { serviceAccessSummary } from "../src/utils/service-access.js";
import { escapeHtml, safeExternalUrl } from "../src/utils/html.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { resources } from "../src/data/resources.js";
import { isContactOnly, hasMapCoordinates, validateResourceLocation, contactOnlyNotice } from "../src/utils/resource-location.js";
import { resourceDistanceKm, isExactServiceSite, rankResourcesForLocation, matchesResource } from "../src/utils/geo.js";
import { resourceSearchText } from "../src/utils/search.js";
import { phoneLinks, phoneMarkup } from "../src/utils/phone.js";
import { validateLocationEdit } from "../server/catalog-validation.js";

// Synthetic contract data only: never included in the published catalog.
const route = {
  id: "fixture-contact-only", name: "Fixture phone and web route", kind: "locator",
  locationPrecision: "contact-only", country: "Canada", region: "North America",
  address: "British Columbia coverage", coverageNote: "British Columbia only; no walk-in site.",
  eligibility: "People in British Columbia; check the provider's eligibility rules.",
  phone: "811", phoneAccess: "Dial 811 within British Columbia. Overseas access is not established.",
  accessUrl: "https://example.org/contact", category: "referral", services: ["Information"],
};

test("contact-only location contract accepts missing or null coordinates without inventing a city", () => {
  for (const record of [route, { ...route, lat: null, lng: null }, { ...route, kind: "network", phone: undefined, phoneAccess: undefined }]) {
    assert.equal(validateResourceLocation(record), null);
    assert.equal(isContactOnly(record), true);
    assert.equal(hasMapCoordinates(record), false);
    assert.equal(isExactServiceSite(record), false);
    assert.equal(resourceDistanceKm({ lat: 49.2, lng: -123.1 }, record), null);
  }
});

test("contact-only validation rejects coordinate fabrication, missing scope and unsafe access links", () => {
  for (const changes of [
    { lat: 0, lng: 0 }, { lat: 0 }, { lng: 0 }, { lat: "" }, { lat: NaN },
    { kind: "direct" }, { coverageNote: "" }, { eligibility: "" }, { country: "" },
    { address: "" }, { phoneAccess: "" }, { phone: undefined, accessUrl: undefined },
    { phone: 811 }, { phone: " " }, { accessUrl: " " }, { accessUrl: "HTTPS://example.org" }, { accessUrl: " https://example.org" }, { accessUrl: "javascript:alert(1)" },
    { accessUrl: "http://example.org" }, { accessUrl: "https://user:password@example.org" },
  ]) assert.ok(validateResourceLocation({ ...route, ...changes }), JSON.stringify(changes));
});

test("mapped records require valid coordinates and contact-only records never invent map positions", () => {
  for (const record of resources) {
    assert.equal(validateResourceLocation(record), null, record.id);
    assert.equal(hasMapCoordinates(record), !isContactOnly(record) && record.locationPrecision !== 'address', record.id);
  }
  for (const changes of [{ lat: null }, { lng: undefined }, { lat: "0" }, { lat: Infinity }, { lng: -181 }])
    assert.ok(validateResourceLocation({ ...resources[0], ...changes }));
});

test("coverage resources stay searchable by need and country with domestic shortcodes unchanged", () => {
  assert.equal(matchesResource(route, "Canada referral", new Set(["referral"])), true);
  assert.equal(matchesResource(route, "British Columbia phone", new Set(["referral"])), true);
  assert.equal(matchesResource(route, "France", new Set(["referral"])), false);
  assert.match(resourceSearchText(route), /overseas/);
  assert.deepEqual(phoneLinks(route.phone), [{ label: "811", href: "tel:811" }]);
  const nearby = { id: "near", name: "Nearby", country: "Canada", kind: "direct", lat: 49.2, lng: -123.1 };
  assert.deepEqual(rankResourcesForLocation([route, nearby], { lat: 49.2, lng: -123.1 }, "Canada").map(r => r.id), ["near", route.id]);
});

test("ordinary editor updates preserve contact-only semantics and reject coordinate introduction", () => {
  assert.equal(validateLocationEdit(route, { name: "Reviewed contact route" }), null);
  const onlineOnly = { ...route, phone: undefined, phoneAccess: undefined };
  assert.equal(validateLocationEdit(onlineOnly, { name: "Reviewed online route", summary: "Reviewed", address: route.address, phone: "", hours: "", eligibility: route.eligibility, sourceName: "Provider", sourceUrl: "https://example.org", lastChecked: "2026-10-11" }), null, "real editor form sends empty optional phone and hours");
  assert.ok(validateLocationEdit({ ...route, accessUrl: undefined }, { phone: "" }), "last channel cannot be removed");
  assert.ok(validateLocationEdit(route, { lat: 0, lng: 0 }));
  assert.ok(validateLocationEdit(route, { eligibility: "" }));
  assert.equal(validateLocationEdit(resources[0], { name: "Reviewed physical site" }), null);
});

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
function functionSource(source, name, next) {
  const start = source.indexOf(`function ${name}(`);
  return source.slice(start, source.indexOf(`function ${next}(`, start));
}

test("selecting a contact-only record never moves the globe to a fabricated point", () => {
  const state = { focusPoint: { lat: 10, lng: 10 }, targetLat: 10, targetLon: 10 };
  const calls = [];
  const context = vm.createContext({ state, hasMapCoordinates, setCountryHighlight: value => calls.push(value), wakeGlobe: () => calls.push("redraw") });
  vm.runInContext(functionSource(app, "focusGlobeOn", "focusGlobeNearUser"), context);
  context.focusGlobeOn(route, true);
  assert.equal(state.focusPoint, null);
  assert.equal(state.targetLat, null);
  assert.equal(state.targetLon, null);
  assert.deepEqual(calls, ["redraw", null], "redraw stale selected pins without setting new coordinates");
});

test("GPU points and projected DOM pins both reject contact-only and malformed coordinates", async () => {
  const points = await readFile(new URL("../src/globe-points.js", import.meta.url), "utf8");
  const context = vm.createContext({ hasMapCoordinates });
  vm.runInContext(functionSource(points, "locationEntries", "buildGeometry"), context);
  const mapped = context.locationEntries([route, { ...route, lat: 0, lng: 0 }, resources[0], { kind: "direct", lat: null, lng: null }]);
  assert.deepEqual(Array.from(mapped, entry => entry.resource.id), [resources[0].id]);
  const offscreen = { z: -1 };
  const projection = vm.createContext({ hasMapCoordinates, globeWorld: {}, globeCamera: {}, OFFSCREEN_POINT: offscreen });
  vm.runInContext(functionSource(app, "projectResourceGlobePoint", "syncGlobePointLayer"), projection);
  assert.equal(projection.projectResourceGlobePoint(route, 400, 400), offscreen);
});

class Element {
  constructor(tag = "div") { this.tag = tag; this.children = []; this.dataset = {}; this.classList = { add() {} }; }
  append(...children) { this.children.push(...children); }
  setAttribute(name, value) { this[name] = value; }
  addEventListener() {}
}
const domText = element => [element.textContent || "", ...element.children.map(domText)].join(" ");
const domHrefs = element => [element.href, ...element.children.flatMap(domHrefs)].filter(Boolean);
const document = { createElement: tag => new Element(tag) };
const indexed = { ...route, categoryLabels: ["Referrals"], checked: "2026-10-11", phoneLinks: phoneLinks(route.phone) };

test("search and Saved rows preserve online access and readable offline eligibility and contact scope", async () => {
  const renderer = await readFile(new URL("../public/directory-results.js", import.meta.url), "utf8");
  for (const onLine of [true, false]) {
    const context = vm.createContext({ document, navigator: { onLine } });
    vm.runInContext(renderer.replace("export const createResultRow", "globalThis.createResultRow"), context);
    for (const record of [indexed, { ...indexed, phone: undefined, phoneAccess: undefined, phoneLinks: [] }]) {
      const row = context.createResultRow(record, {});
      assert.ok(domHrefs(row).includes(record.accessUrl));
      assert.match(domText(row), /Eligibility: People in British Columbia/);
      assert.ok(domText(row).includes(record.coverageNote));
      assert.ok(domText(row).includes(record.accessUrl), "website stays readable for both browser-offline and failed-probe states");
      if (record.phone) assert.ok(domText(row).includes(record.phoneAccess));
      assert.ok(!domHrefs(row).some(href => /maps\.|#resource/.test(href)));
    }
  }
});

test("legacy offline result enhancement retains contact websites, eligibility and dialing limits", async () => {
  const source = await readFile(new URL("../public/offline-status.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("  const actionLink ="), source.indexOf("  const setOffline ="));
  let wrapper;
  const link = new Element("a");
  link.href = `/service/${indexed.id}`;
  link.closest = () => null;
  link.before = element => { wrapper = element; };
  const context = vm.createContext({
    document: { ...document, querySelectorAll: () => [link] }, catalog: async () => ({ records: [indexed] }),
    resultId: () => indexed.id, setOffline() {}, networkOffline: true, activePage: true,
  });
  vm.runInContext(`${body}\nglobalThis.enhance = enhanceSearchActions;`, context);
  await context.enhance();
  assert.ok(domHrefs(wrapper).includes(indexed.accessUrl));
  for (const field of ["accessUrl", "coverageNote", "eligibility", "phoneAccess"]) assert.ok(domText(wrapper).includes(indexed[field]));
  assert.ok(!domHrefs(wrapper).some(href => /maps\.|#resource/.test(href)));
});

test("finder download preserves remote contact facts without an undefined city", () => {
  let payload;
  const context = vm.createContext({
    state: { filtered: [route] }, isContactOnly, serviceAccessSummary, kindLabel: () => "Phone or online help", allTypes: r => [r.category], categories: { referral: { label: "Referrals" } },
    URL: { createObjectURL: blob => { payload = blob.parts[0]; return "blob:test"; }, revokeObjectURL() {} },
    Blob: class { constructor(parts) { this.parts = parts; } },
    document: { createElement: () => ({ click() {} }) }, notify() {},
  });
  vm.runInContext(`${functionSource(app, "downloadDirectory", "focusGlobeOn")}\ndownloadDirectory();`, context);
  assert.doesNotMatch(payload, /undefined|null/);
  assert.match(payload, /"Location precision","Coverage details","Eligibility","Phone","Phone dialing scope","Online access"/);
  for (const field of ["phone", "accessUrl", "coverageNote", "phoneAccess", "eligibility"]) assert.ok(payload.includes(route[field]));
});

test("contact inspector shows scope and contact route without stale coordinate notes or travel advice", () => {
  const resource = { ...route, coordinateNote: "Legacy office coordinates are not a destination." };
  const panel = { contains: () => false, style: { setProperty() {} } };
  const context = vm.createContext({
    isContactOnly, contactOnlyNotice, phoneMarkup, escapeHtml, safeExternalUrl,
    document: { getElementById: id => id === "resourcePanel" ? panel : null, querySelector: () => null },
    selectedResource: () => resource, state: { inspectorOpen: true, savedIds: new Set(), filtered: [resource] },
    categories: { referral: {} }, isExactServiceSite, freeAccessModels: {}, freeAccessLabel: () => "Free navigation",
    icon: {}, formatResourcePlace: () => "Canada", sourceClosureMarkup: () => "", serviceLayerTags: () => "",
    window: { innerWidth: 500 }, availabilityInstructions: () => "Check contact details", kindLabel: () => "Contact route", checkedDate: date => date,
  });
  vm.runInContext(`${functionSource(app, "renderResourcePanel", "resourceCard")}\nrenderResourcePanel();`, context);
  for (const field of ["accessUrl", "coverageNote", "eligibility", "phoneAccess"]) assert.ok(panel.innerHTML.includes(escapeHtml(resource[field])));
  assert.doesNotMatch(panel.innerHTML, /Legacy office|Directions|maps\.apple|google\.com\/maps|before you go|this marker shows|<dt>Distance<\/dt>/);
});

test("copied listing facts retain the actual online access URL, not only its button label", async () => {
  const source = await readFile(new URL("../public/service-actions.js", import.meta.url), "utf8");
  const body = source.slice(source.indexOf("  const publicDetails ="), source.indexOf("  const fallbackCopy ="));
  const context = vm.createContext({
    title: route.name, place: route.country, listingUrl: "https://www.realworldneeds.org/service/example", officialSource: "https://example.org/source",
    document: {
      querySelectorAll: selector => selector.includes('[data-service-route]') ? [] : [{ querySelector: selector => selector === "dt" ? { textContent: "Online access" } : selector === "dd" ? { textContent: "Get help online" } : { href: route.accessUrl }, querySelectorAll: () => [{ href: route.accessUrl }] }],
      querySelector: selector => selector === "#service" ? { dataset: { locationPrecision: "contact-only" } } : null,
    },
  });
  vm.runInContext(`${body}\nglobalThis.copy = publicDetails;`, context);
  assert.ok(context.copy().includes(`Online access: Get help online (${route.accessUrl})`));
  assert.doesNotMatch(context.copy(), /before you go/);
});

test("Saved contact facts explicitly wrap unbroken access URLs", async () => {
  const css = await readFile(new URL("../public/saved-services.css", import.meta.url), "utf8");
  assert.match(css, /\.directory-global-result\s+:is\([^)]*\bsmall\b[^)]*\)\s*\{[^}]*white-space:\s*normal;[^}]*overflow-wrap:\s*anywhere;?\s*\}/);
});
