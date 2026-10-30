import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const institutional = await readFile(new URL("../scripts/browser-institutional.mjs", import.meta.url), "utf8");
const httpPort = Number(institutional.match(/const SERVER_PORT = (\d+);/)?.[1]);
const cdpPort = Number(institutional.match(/const CDP_PORT = (\d+);/)?.[1]);

test("institutional QA uses dedicated endpoints rather than a random candidate range", () => {
  assert.equal(httpPort, 4185);
  assert.equal(cdpPort, 9235);
  assert.notEqual(httpPort, cdpPort);
  assert.doesNotMatch(institutional, /randomQaHttpPort|Math\.random/);
});

test("dedicated QA endpoints exclude Fetch-blocked service ports", () => {
  // WHATWG Fetch 2.9, checked 2026-10-30:
  // https://fetch.spec.whatwg.org/#port-blocking
  // Keep the observed 4190 regression as a positive blocked-port control.
  const blocked = new Set([
    0, 1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69,
    77, 79, 87, 95, 101, 102, 103, 104, 109, 110, 111, 113, 115, 117, 119,
    123, 135, 137, 139, 143, 161, 179, 389, 427, 465, 512, 513, 514, 515,
    526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990,
    993, 995, 1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000,
    6566, 6665, 6666, 6667, 6668, 6669, 6679, 6697, 10080
  ]);
  assert.equal(blocked.has(4190), true);
  for (const port of [httpPort, cdpPort]) {
    assert.ok(Number.isSafeInteger(port) && port > 0 && port <= 65535);
    assert.equal(blocked.has(port), false);
  }
});

test("browser aggregate fails fast on directory QA without skipping any isolated suite", async () => {
  const { scripts } = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.deepEqual(scripts["test:browser:qa"].split(" && "), [
    "node scripts/browser-service-qa.mjs",
    "node scripts/browser-asset-upgrade.mjs",
    "node scripts/browser-saved-services.mjs",
    "node scripts/browser-chaos.mjs",
    "node scripts/browser-institutional.mjs",
    "node scripts/browser-globe-v2.mjs",
    "node scripts/browser-offline.mjs",
    "node scripts/browser-service-actions.mjs",
    "node scripts/browser-cache-upgrade.mjs"
  ]);
});
