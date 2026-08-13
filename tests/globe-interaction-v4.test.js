import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const text = (path) => readFile(path, "utf8");

test("production globe uses the audited deep-view profile", async () => {
  const app = await text("dist/src/app.js");
  assert.match(app, /return window\.innerWidth <= 600 \? 8\.0 : 12\.0/);
  assert.match(app, /globeViewProfile\(state\.zoom \* state\.ambientZoom/);
  assert.match(app, /new THREE\.SphereGeometry\(1, window\.innerWidth <= 600 \? 160 : 288/);
  assert.match(app, /const dprCap = width < 720/);
  assert.match(app, /deepBoundaryIntent/);
  assert.match(app, /deepTextureIntent/);
});

test("single-touch map ownership distinguishes scroll, rotation and pinch", async () => {
  const app = await text("dist/src/app.js");
  assert.match(app, /const startedOnMap = event\.pointerType === "touch" \? !isGlobeChrome\(event\.target\) : startedOnCanvas/);
  assert.match(app, /startedOnMap,/);
  assert.match(app, /classifyGlobeDragIntent/);
  assert.match(app, /intent === "scroll"/);
  assert.match(app, /intent !== "rotate"/);
  assert.match(app, /event\.pointerType !== "touch"/);
  assert.match(app, /setPointerCapture\(event\.pointerId\)/);
  assert.match(app, /event\.touches\.length > 1/);
});

test("service point picking scales from screen space instead of a fixed world radius", async () => {
  const app = await text("dist/src/app.js");
  assert.match(app, /pointPickThresholdWorld/);
  assert.match(app, /viewportHeight: rect\.height/);
  assert.doesNotMatch(app, /Points\.threshold = event\.pointerType === "touch" \? 0\.034 : 0\.022/);
});

test("HD globe loading remains bandwidth aware", async () => {
  const app = await text("dist/src/app.js");
  assert.match(app, /navigator\.connection\?\.saveData/);
  assert.match(app, /connectionType === "slow-2g" \|\| connectionType === "2g"/);
  assert.match(app, /window\.innerWidth <= 600 \? 4096 : 8192/);
});
