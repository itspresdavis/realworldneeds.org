import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { randomQaHttpPort } from "../scripts/qa-port.mjs";

test("QA HTTP ports stay within the bounded dynamic/private range", () => {
  assert.equal(randomQaHttpPort(() => 0), 49152);
  assert.equal(randomQaHttpPort(() => 1 - Number.EPSILON), 50151);
});

test("every QA HTTP port slot excludes the blocked service-port range", () => {
  const values = new Set();
  for (let index = 0; index < 1000; index++) {
    const port = randomQaHttpPort(() => (index + .5) / 1000);
    assert.equal(port, 49152 + index);
    // Fetch's current blocked ports, including the observed 4190 failure,
    // are all at or below 10080: https://fetch.spec.whatwg.org/#port-blocking
    assert.ok(port > 10080 && port <= 65535);
    assert.notEqual(port, 4190);
    values.add(port);
  }
  assert.equal(values.size, 1000);
});

test("invalid injected randomness cannot produce an out-of-range port", () => {
  for (const sample of [-1, 1, Infinity, NaN, "0.5"]) {
    assert.throws(() => randomQaHttpPort(() => sample), RangeError);
  }
});

test("institutional browser QA uses the tested selector for its preview server", async () => {
  const source = await readFile(new URL("../scripts/browser-institutional.mjs", import.meta.url), "utf8");
  assert.match(source, /import \{ randomQaHttpPort \} from "\.\/qa-port\.mjs"/);
  assert.match(source, /const SERVER_PORT = randomQaHttpPort\(\);/);
  assert.doesNotMatch(source, /4178 \+ Math\.floor\(Math\.random\(\) \* 200\)/);
});
