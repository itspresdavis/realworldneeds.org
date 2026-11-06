import test from "node:test";
import assert from "node:assert/strict";
import { resources } from "../src/data/resources.js";
import { isContactOnly, hasMapCoordinates, validateResourceLocation } from "../src/utils/resource-location.js";
import { isExactServiceSite } from "../src/utils/geo.js";

test("broken source repairs preserve review dates and withhold conflicting Carapicuíba directions", () => {
  const mission = resources.find(record => record.id === "bahnhofsmission-germany");
  assert.equal(mission.sourceUrl, "https://www.bahnhofsmission.de/startseite");
  assert.equal(mission.lastChecked, "2026-08-04");
  const record = resources.find(record => record.id === "centro-pop-carapicuiba");
  assert.equal(record.lastChecked, "2026-08-04", "repairing a link must not fabricate a new full review");
  assert.equal(isContactOnly(record), true);
  assert.equal(hasMapCoordinates(record), false);
  assert.equal(isExactServiceSite(record), false);
  assert.equal(validateResourceLocation(record), null);
  assert.equal(record.phone, "(11) 4164-2806");
  assert.match(record.availabilityNote, /Fernanda, 154/);
  assert.match(record.availabilityNote, /Celeste, 180/);
  assert.match(record.sourceUrl, /secretarias\/41\/centro-pop/);
  assert.match(record.sourceDetail, /secretarias\/71\/centro-pop/);
});
