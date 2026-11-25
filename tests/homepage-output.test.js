import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { validateEdit } from "../server/catalog-validation.js";
import { fetchPublishedCatalog } from "../scripts/catalog-sync-core.mjs";
import { resources, categories } from "../src/data/resources.js";
import { escapeHtml, safeExternalUrl } from "../src/utils/html.js";
import { phoneMarkup } from "../src/utils/phone.js";

const app = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const between = (start, end) => app.slice(app.indexOf(start), app.indexOf(end, app.indexOf(start)));
const original = resources.find(resource => resource.id === "womens-lunch-place");
const markup = '<span data-qa-injection="true">Forged assistance</span>';
function renderer(record) {
  const panel = { contains: () => false, style: { setProperty() {} } };
  const context = vm.createContext({
    categories, escapeHtml, safeExternalUrl, phoneMarkup,
    state: { selectedId: null, savedIds: new Set(), filtered: [record], inspectorOpen: true, userLocation: null },
    allTypes: resource => [resource.category], isContactOnly: () => false, isExactServiceSite: () => true,
    freeAccessLabel: () => "Free", freeAccessModels: {}, formatResourcePlace: resource => resource.city,
    locationResultLabel: resource => resource.accessType, reviewLabel: () => "Nov 5, 2026",
    sourceClosureMarkup: () => "", serviceLayerTags: () => "", availabilityInstructions: resource => resource.availabilityNote,
    kindLabel: () => "Service location", checkedDate: value => value,
    directionsUrl: () => "https://maps.example/route", appleMapsUrl: () => "https://maps.example/apple", googleMapsUrl: () => "https://maps.example/google",
    icon: new Proxy({}, { get: () => "" }), selectedResource: () => record,
    window: { innerWidth: 1440 }, document: { activeElement: {}, querySelector: () => null, getElementById: id => id === "resourcePanel" ? panel : null }
  });
  vm.runInContext(between("function renderResourcePanel()", "function emptyResultsCopy("), context);
  return { card: () => context.resourceCard(record), panel: () => { context.renderResourcePanel(); return panel.innerHTML; } };
}

test("reviewed editorial export stays text at homepage card and inspector HTML boundaries", async () => {
  const changes = Object.fromEntries(["name", "summary", "address", "hours", "eligibility", "sourceName"].map(key => [key, markup]));
  changes.sourceUrl = 'https://example.org/" data-qa-injection="true';
  const body = { id: original.id, updatedAt: "2026-11-05T00:00:00Z", reason: "Isolated fixture for output escaping", published: true, changes };
  assert.equal(validateEdit(body), null, "editor text may legitimately contain punctuation; rendering must encode it");
  const record = { ...original, ...changes };
  const records = await fetchPublishedCatalog({ url: "https://catalog.example", key: "fixture", fetchImpl: async () => new Response(JSON.stringify([{ id: record.id, record, updated_at: body.updatedAt }]), { headers: { "Content-Range": "0-0/1" } }) });
  const view = renderer(records[0]);
  for (const html of [view.card(), view.panel()]) {
    assert.doesNotMatch(html, /<span data-qa-injection| data-qa-injection="true"/);
    assert.ok(html.includes(escapeHtml(markup)), "show the complete source text, without interpreting its markup");
  }
  assert.ok(view.panel().includes(escapeHtml(safeExternalUrl(changes.sourceUrl))), "URL is normalized and escaped before inserting an attribute");
});

test("non-editor catalog text, geographic labels and service descriptions cannot introduce markup", () => {
  const record = { ...original, name: markup, city: markup, sourceName: markup, accessType: markup, costNote: markup, availabilityNote: markup, sourceKind: markup, sourceDetail: markup, coordinateNote: markup, services: [markup] };
  const view = renderer(record);
  for (const html of [view.card(), view.panel()]) assert.doesNotMatch(html, /<span data-qa-injection/);
  assert.equal(record.name, markup, "output escaping must not change catalog or clipboard data");
});

test("unsafe external URLs cannot become homepage actions", () => {
  for (const value of ["javascript:alert(1)", "data:text/html,test", "http://example.org", "https://user:pass@example.org", "not a URL"]) {
    assert.equal(safeExternalUrl(value), null);
    const view = renderer({ ...original, accessUrl: value, providerUrl: value, sourceUrl: value });
    assert.match(view.panel(), /Official website unavailable/);
    assert.doesNotMatch(view.panel(), /href="(?:javascript:|data:|http:|https:\/\/user:pass)/);
  }
});

test("escaped attributes preserve punctuation and cannot create new attributes", () => {
  assert.equal(escapeHtml('&<>"\''), "&amp;&lt;&gt;&quot;&#39;");
  assert.equal(safeExternalUrl("https://example.org/food?city=Boston&kind=free"), "https://example.org/food?city=Boston&kind=free");
});

test("globe pins, grouped listings and geographic readouts escape catalog data", () => {
  const record = { ...original, id: 'quoted" data-qa-injection="true', name: markup, city: markup, country: markup };
  const layer = { querySelectorAll: () => [] }, tray = {}, readout = {};
  const state = { filtered: [record], clusterIds: [record.id], selectedId: null, zoom: 1, targetZoom: 1, targetLon: null, velocityLon: 0, velocityLat: 0, focusPoint: true };
  const context = vm.createContext({
    state, categories, escapeHtml, formatResourcePlace: resource => resource.city,
    selectedResource: () => record, kindLabel: () => "Service location", isExactServiceSite: () => true, hasMapCoordinates: () => true,
    icon: { close: "", arrow: "" }, performance: { now: () => 1000 },
    globeServicePoints: null, globeStageElement: null, globePinLayerElement: layer, globeReadoutElement: readout,
    globeLastPinUpdate: 0, globeLastReadoutUpdate: 0, pinSignature: "", earthDetailTextureReady: false,
    clusterVisibleResources: () => [{ members: [record] }], globeHasMotion: () => false, placePins() {},
    formatCoordinate: () => "0N", document: { getElementById: id => id === "globeClusterTray" ? tray : null }
  });
  vm.runInContext(between("function renderPins(", "function placePins(") + between("function renderClusterTray(", "function focusCluster(") + between("function updateGlobeReadout(", "function shortestLongitude("), context);
  context.renderPins(800, 600, 1000);
  context.renderClusterTray();
  context.updateGlobeReadout(1000);
  for (const element of [layer, tray, readout]) {
    assert.ok(element.innerHTML.includes(escapeHtml(markup)));
    assert.doesNotMatch(element.innerHTML, /<span data-qa-injection| data-qa-injection="true"/);
  }
});
