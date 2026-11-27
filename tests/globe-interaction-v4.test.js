import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const text = (path) => readFile(path, "utf8");

// These assertions run against src/ because the source is now the single
// truth for globe behavior. dist/ is checked only for build parity.
test("globe source uses the audited deep-view profile", async () => {
  const app = await text("src/app.js");
  assert.match(app, /return window\.innerWidth <= 600 \? 8\.0 :\s*12\.0/);
  assert.match(app, /globeViewProfile\(state\.zoom \* state\.ambientZoom/);
  assert.match(app, /new THREE\.SphereGeometry\(1, window\.innerWidth <= 600 \? 160 :\s*288/);
  assert.match(app, /const dprCap = width < 720/);
  assert.match(app, /interactionSettled && state\.zoom > 1\.35/);
  assert.match(app, /interactionSettled && state\.zoom > detailTextureZoom/);
});

test("build output preserves the source globe profile without post-build patching", async () => {
  const app = await text("dist/src/app.js");
  assert.match(app, /return window\.innerWidth <= 600 \? 8\.0 :\s*12\.0/);
  assert.match(app, /globeViewProfile\(state\.zoom \* state\.ambientZoom/);
  assert.match(app, /new THREE\.SphereGeometry\(1, window\.innerWidth <= 600 \? 160 :\s*288/);
});

test("single-touch map ownership distinguishes scroll, rotation and pinch", async () => {
  const app = await text("src/app.js");
  const css = await text("dist/src/clarity.css");
  assert.match(app, /event\.pointerType === "touch" \|\| event\.button !== 0/);
  assert.match(app, /classifyGlobeDragIntent/);
  assert.match(app, /intent !== "rotate"/);
  assert.match(app, /setPointerCapture\(event\.pointerId\)/);
  assert.match(app, /mapTouches\(event\.touches\)/);
  assert.match(app, /lostpointercapture/);
  assert.match(app, /touchcancel", resetGlobeInput/);
  assert.match(app, /visibilitychange.*resetGlobeInput/);
  assert.match(css, /RWN globe touch-surface contract/);
  assert.match(css, /\.rwn-professional \.globe-stage \{ touch-action:\s*pan-y; overscroll-behavior-y:\s*auto; \}/);
  assert.match(css, /\.rwn-professional \.globe-pin \{ touch-action:\s*pan-y; \}/);
});

test("service point picking scales from screen space instead of a fixed world radius", async () => {
  const app = await text("src/app.js");
  assert.match(app, /pointPickThresholdWorld/);
  assert.match(app, /viewportHeight:\s*rect\.height/);
  assert.doesNotMatch(app, /Points\.threshold = event\.pointerType === "touch" \? 0\.034 :\s*0\.022/);
});

test("HD globe loading remains bandwidth aware", async () => {
  const app = await text("src/app.js");
  assert.match(app, /navigator\.connection\?\.saveData/);
  assert.match(app, /connectionType === "slow-2g" \|\| connectionType === "2g"/);
  assert.match(app, /window\.innerWidth <= 600 \? 4096 :\s*8192/);
});

test("the build no longer rewrites application source after bundling", async () => {
  const pkg = JSON.parse(await text("package.json"));
  assert.doesNotMatch(pkg.scripts.build, /globe-production|globe-touch-production/);
  assert.doesNotMatch(pkg.scripts.check, /globe-production|globe-touch-production/);
});
