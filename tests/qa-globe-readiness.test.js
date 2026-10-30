import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { waitForGlobePresentation } from "../scripts/qa-globe-readiness.mjs";

const ready = { elementsReady: true, startup: "ready", visible: true, healthy: true, readout: "World view · 1.0× · standard boundaries" };
const shot = { data: Buffer.from("composited image").toString("base64") };
function fixture(overrides = {}) {
  let clock = 0;
  const calls = { samples: 0, prepare: 0, capture: 0, waits: [] };
  const options = {
    now: () => clock, timeoutMs: 200,
    sample: async () => { calls.samples++; return ready; },
    prepare: async () => { calls.prepare++; },
    capture: async () => { calls.capture++; return shot; },
    wait: async ms => { calls.waits.push(ms); clock += ms; },
    ...overrides
  };
  return { options, calls, advance: ms => { clock += ms; } };
}

test("successful setup positions the map then captures one image with hash evidence", async () => {
  const f = fixture();
  const result = await waitForGlobePresentation(f.options);
  assert.equal(f.calls.prepare, 1);
  assert.equal(f.calls.capture, 1);
  assert.equal(f.calls.samples, 2);
  assert.equal(result.captureSha256, createHash("sha256").update("composited image").digest("hex"));
  assert.equal(result.image.toString(), "composited image");
  assert.equal(result.snapshot, ready);
});

test("DOM elements alone cannot pass presentation readiness", async () => {
  const f = fixture({ sample: async () => ({ elementsReady: true, startup: "loading" }) });
  await assert.rejects(waitForGlobePresentation(f.options), error => {
    assert.equal(error.globeReadiness.stage, "render readiness");
    assert.equal(error.globeReadiness.durationMs, 200);
    return true;
  });
  assert.equal(f.calls.prepare, 1);
  assert.equal(f.calls.capture, 0);
});

test("hidden, lost-context and fallback-text states never trigger capture", async () => {
  for (const invalid of [{visible:false},{healthy:false},{readout:"The interactive map is unavailable"},{startup:"degraded"}]) {
    const f = fixture({ sample: async () => ({ ...ready, ...invalid }) });
    await assert.rejects(waitForGlobePresentation(f.options), /render readiness/);
    assert.equal(f.calls.capture, 0);
  }
});

test("late DOM success is rejected before positioning", async () => {
  const f = fixture();
  f.options.sample = async () => { f.advance(201); return ready; };
  await assert.rejects(waitForGlobePresentation(f.options), /DOM readiness/);
  assert.equal(f.calls.prepare, 0);
  assert.equal(f.calls.capture, 0);
});

test("positioning shares the same host deadline", async () => {
  const f = fixture();
  f.options.prepare = async () => { f.calls.prepare++; f.advance(200); };
  await assert.rejects(waitForGlobePresentation(f.options), /map positioning/);
  assert.equal(f.calls.capture, 0);
});

test("DOM wait, positioning and capture cannot each obtain a fresh budget", async () => {
  const f = fixture();
  f.options.sample = async () => ++f.calls.samples === 1 ? { elementsReady: false } : ready;
  f.options.prepare = async () => { f.calls.prepare++; f.advance(120); };
  f.options.capture = async () => { f.calls.capture++; f.advance(31); return shot; };
  await assert.rejects(waitForGlobePresentation(f.options), error => {
    assert.equal(error.globeReadiness.durationMs, 201);
    assert.equal(error.globeReadiness.stage, "composited map capture");
    return true;
  });
  assert.deepEqual(f.calls.waits, [50]);
  assert.equal(f.calls.capture, 1);
});

test("a late successful capture is rejected and never retried", async () => {
  const f = fixture();
  f.options.capture = async () => { f.calls.capture++; f.advance(201); return shot; };
  await assert.rejects(waitForGlobePresentation(f.options), /composited map capture/);
  assert.equal(f.calls.capture, 1);
});

test("a hung capture is stopped by the host deadline", async () => {
  const f = fixture({ timeoutMs: 20 });
  f.options.capture = () => { f.calls.capture++; return new Promise(() => {}); };
  await assert.rejects(waitForGlobePresentation(f.options), /composited map capture/);
  assert.equal(f.calls.capture, 1);
});

test("a hung page evaluation cannot defeat the host deadline", async () => {
  const f = fixture({ timeoutMs: 20, sample: () => new Promise(() => {}) });
  await assert.rejects(waitForGlobePresentation(f.options), /DOM readiness/);
  assert.equal(f.calls.prepare, 0);
  assert.equal(f.calls.capture, 0);
});

test("capture errors are propagated without retries", async () => {
  const f = fixture();
  f.options.capture = async () => { f.calls.capture++; throw new Error("compositor disconnected"); };
  await assert.rejects(waitForGlobePresentation(f.options), /compositor disconnected/);
  assert.equal(f.calls.capture, 1);
});

test("empty capture output cannot count as presentation proof", async () => {
  const f = fixture({ capture: async () => ({data:""}) });
  await assert.rejects(waitForGlobePresentation(f.options), /no image/);
});


test("readiness integration does not reposition the map after its capture", async () => {
  const source = await readFile(new URL("../scripts/browser-globe-touch-v4.mjs", import.meta.url), "utf8");
  assert.match(source, /const vertical = await canvasGeometry\(client, false\);/);
  assert.match(source, /const readyMs = readiness\.snapshot\.at;/);
});

test("readiness failure diagnostics cannot strand cleanup on the timed-out page", async () => {
  const source = await readFile(new URL("../scripts/browser-globe-touch-v4.mjs", import.meta.url), "utf8");
  const start = source.indexOf('if (phase === "map-presentation-readiness")');
  const end = source.indexOf('} else if (client)', start);
  assert.ok(start >= 0 && end > start);
  const hostOnly = source.slice(start, end);
  assert.match(hostOnly, /error\.globeReadiness/);
  assert.match(hostOnly, /writeFile/);
  assert.doesNotMatch(hostOnly, /evaluate\(|client\.call\(|inspectFailedGlobeState\(/);
  assert.match(source.slice(end), /finally \{\s*client\?\.close\(\);\s*await stop\(browser\);\s*await stop\(server\);/);
});


test("browser sampling reads a context only after a normal map readout exists", async () => {
  const source = await readFile(new URL("../scripts/browser-globe-touch-v4.mjs", import.meta.url), "utf8");
  const integration = source.slice(source.indexOf("const { image: readyImage"));
  const match = integration.match(/sample: \(\) => evaluate\(client, `([\s\S]*?)`\),/);
  assert.ok(match);
  // Compile the actual template as Node does before transmitting it to CDP.
  const expression = Function("return `" + match[1] + "`;")();
  let contextReads = 0;
  const readout = { textContent: "" };
  const canvas = {
    closest: () => ({classList:{contains:()=>false}}),
    getBoundingClientRect: () => ({x:10,y:20,top:20,left:10,right:370,bottom:320,width:360,height:300}),
    getContext: () => { contextReads++; return {isContextLost:()=>false}; }
  };
  const page = {
    document:{documentElement:{dataset:{finderStartup:"ready"}},visibilityState:"visible",hidden:false,
      getElementById:id=>({globeCanvas:canvas,globeReadout:readout,zoomIn:{}}[id])},
    performance:{now:()=>1},innerWidth:390,innerHeight:844,
    getComputedStyle:()=>({display:"block",visibility:"visible",opacity:"1"})
  };
  assert.equal(vm.runInNewContext(expression,page).healthy,false);
  assert.equal(contextReads,0);
  readout.textContent="World view · 1.0× · standard boundaries";
  assert.equal(vm.runInNewContext(expression,page).healthy,true);
  assert.equal(contextReads,1);
});
