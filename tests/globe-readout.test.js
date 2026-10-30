import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { hasMapCoordinates } from "../src/utils/resource-location.js";

const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
const readoutSource = source.slice(source.indexOf("function formatCoordinate("), source.indexOf("function shortestLongitude("));
const exact = { kind: "direct", locationPrecision: "exact", lat: 42.12345, lng: -71.23456, country: "United States" };
const coverage = { kind: "network", locationPrecision: "coverage", lat: 15, lng: -15, country: "Global", region: "Worldwide" };
const contact = { kind: "locator", locationPrecision: "contact-only", country: "United States" };

function readout(resource = null, changes = {}) {
  const output = { innerHTML: "" };
  const context = vm.createContext({
    state: { focusedRegion: null, focusedCountry: null, focusPoint: resource ? { lat: resource.lat, lng: resource.lng } : null,
      filtered: [exact, coverage, contact], zoom: 1, detailGeometryReady: false, ...changes },
    hasMapCoordinates, selectedResource: () => resource,
    globeLastReadoutUpdate: 0, globeReadoutElement: output, earthDetailTextureReady: false,
  });
  vm.runInContext(readoutSource + "\nupdateGlobeReadout(1000);", context);
  return output.innerHTML;
}

test("exact service coordinates remain available in the globe readout", () => {
  assert.match(readout(exact), /42\.12345°N, 71\.23456°W/);
});
