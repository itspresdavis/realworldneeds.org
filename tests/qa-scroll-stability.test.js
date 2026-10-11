import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { waitForScrollStability, sameCaptureGeometry } from "../scripts/qa-scroll-stability.mjs";

function fixture(position, frameTime = () => 16) {
  let time = 0; let calls = 0;
  return {
    sample: async () => { time += frameTime(calls); return {at: time, ...position(calls++)}; },
    wait: async ms => { time += ms; },
    now: () => time,
    calls: () => calls
  };
}
const coordinates = (scrollY = 495, canvasY = 200, viewportY = 0) => ({scrollX: 0, scrollY, canvasY, viewportY});

test("a stable scroll baseline requires both a quiet interval and multiple samples", async () => {
  const f = fixture(() => coordinates());
  const result = await waitForScrollStability(f);
  assert.ok(result.durationMs >= 250);
  assert.ok(f.calls() >= 4);
  assert.equal(result.position.scrollY, 495);
});

test("momentum finishes before the baseline is accepted", async () => {
  const f = fixture(index => coordinates(495 + Math.min(index, 6) * 8));
  const result = await waitForScrollStability(f);
  assert.equal(result.position.scrollY, 543);
  const arrival = result.trace.find(point => point.scrollY === 543).elapsedMs;
  assert.ok(result.durationMs - arrival >= 250);
});

test("small cumulative drift cannot pass as several individually small deltas", async () => {
  const f = fixture(index => coordinates(495 + index * .2));
  await assert.rejects(waitForScrollStability({...f, timeoutMs: 600}), error => {
    assert.match(error.message, /did not settle within 600ms/);
    assert.ok(error.scrollStability.trace.length > 4);
    return true;
  });
});

test("viewport and canvas geometry changes restart the quiet interval", async () => {
  const f = fixture(index => coordinates(495, index < 3 ? 200 : 190, index < 5 ? 0 : 10));
  const result = await waitForScrollStability(f);
  const arrival = result.trace.find(point => point.viewportY === 10).elapsedMs;
  assert.ok(result.durationMs - arrival >= 250);
});

test("one slow compositor gap is not enough evidence of stability", async () => {
  const f = fixture(() => coordinates(), index => index === 1 ? 1000 : 16);
  await waitForScrollStability(f);
  assert.ok(f.calls() >= 4);
});

test("an invalid geometry sample cannot become an accepted anchor", async () => {
  const f = fixture(() => coordinates(NaN));
  await assert.rejects(waitForScrollStability({...f, timeoutMs: 300}), /did not settle/);
});

test("a paused frame sampler has a real deadline", async () => {
  await assert.rejects(waitForScrollStability({sample: () => new Promise(() => {}), wait: async () => {}, timeoutMs: 20}), error => {
    assert.match(error.message, /did not settle within 20ms/);
    assert.deepEqual(error.scrollStability.trace, []);
    return true;
  });
});

test("touch QA preserves the 18px assertion and records its actual pre/post baselines", async () => {
  const source = await readFile(new URL("../scripts/browser-globe-touch-v4.mjs", import.meta.url), "utf8");
  assert.match(source, /Math\.abs\(horizontalEnd\.scrollY - horizontal\.scrollY\) > 18/);
  assert.match(source, /cropDigest\(client, captureGeometry\.rect\);[\s\S]*?horizontal = await canvasGeometry\(client, false\);[\s\S]*?observations\.horizontalStart = horizontal;[\s\S]*?touch\(client, "touchStart"/);
  assert.match(source, /observations\.horizontalEnd = horizontalEnd;/);
  assert.equal((source.match(/cropDigest\(client, captureGeometry\.rect\)/g) || []).length, 2);
  assert.match(source, /scrollTrace:window\.__rwnScrollTrace/);
  assert.match(source, /rows\.push\(\{type,at:performance\.now\(\),scrollX,scrollY,target:/);
});


test("the before/after pixel comparison rejects changed capture dimensions or scroll", () => {
  const baseline = {scrollX: 0, scrollY: 495, rect: {x: 14, y: 810, width: 364, height: 296}};
  assert.equal(sameCaptureGeometry(baseline, structuredClone(baseline)), true);
  for (const key of ["scrollX", "scrollY"]) {
    const changed = structuredClone(baseline); changed[key] += .01;
    assert.equal(sameCaptureGeometry(baseline, changed), false);
  }
  for (const key of ["x", "y", "width", "height"]) {
    const changed = structuredClone(baseline); changed.rect[key] += .01;
    assert.equal(sameCaptureGeometry(baseline, changed), false);
  }
  const invalid = structuredClone(baseline); invalid.rect.width = NaN;
  assert.equal(sameCaptureGeometry(baseline, invalid), false);
});

test("the capture comparability check runs before horizontal native input", async () => {
  const source = await readFile(new URL("../scripts/browser-globe-touch-v4.mjs", import.meta.url), "utf8");
  assert.match(source, /if \(!sameCaptureGeometry\(captureGeometry, horizontal\)\) throw new Error\([\s\S]*?touch\(client, "touchStart"/);
});
