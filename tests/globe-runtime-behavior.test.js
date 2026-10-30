import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { classifyGlobeDragIntent, pinchZoom, pointerDistance } from "../src/utils/gesture.js";
import { classifyWheelIntent, wheelZoomFactor } from "../src/utils/globe-zoom.js";

const source = await readFile(new URL("../src/app.js", import.meta.url), "utf8");
function section(start, end) {
  const offset = source.indexOf(start, source.indexOf("function bindEvents()"));
  assert.ok(offset >= 0 && source.indexOf(end, offset) > offset);
  return source.slice(offset, source.indexOf(end, offset));
}
const inputSource = section('  const canvas = document.getElementById("globeCanvas");', '  const siteMenu =');

class ElementStub {
  constructor(kind = "") { this.kind = kind; this.listeners = new Map(); this.captured = new Set(); this.classList = { add() {}, remove() {}, toggle() {} }; }
  addEventListener(type, listener) { const list = this.listeners.get(type) || []; list.push(listener); this.listeners.set(type, list); }
  dispatch(type, values = {}) { const event = { target: this, currentTarget: this, cancelable: true, timeStamp: 100, pointerType: "touch", pointerId: 1, button: 0, clientX: 100, clientY: 100, touches: [], changedTouches: [], defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, ...values }; for (const listener of this.listeners.get(type) || []) listener(event); return event; }
  closest(selector) { if (selector === ".globe-stage") return this.stage; if (this.kind === "chrome") return this; if (this.kind === "pin" && selector.includes(".globe-pin")) return this; return null; }
  contains(target) { return target.stage === this || target === this; }
  setPointerCapture(id) { this.captured.add(id); }
  releasePointerCapture(id) { this.captured.delete(id); }
  hasPointerCapture(id) { return this.captured.has(id); }
  setAttribute() {}
}
function fixture() {
  const stage = new ElementStub("stage");
  const canvas = new ElementStub("canvas"); canvas.stage = stage;
  const pin = new ElementStub("pin"); pin.stage = stage;
  const chrome = new ElementStub("chrome"); chrome.stage = stage;
  const nodes = new Map([["globeCanvas", canvas]]);
  const window = new ElementStub(); Object.assign(window, { innerWidth: 390, innerHeight: 844, scrollY: 100 });
  const document = new ElementStub(); Object.assign(document, { hidden: false, documentElement: { scrollHeight: 2000 }, getElementById: id => { if (!nodes.has(id)) nodes.set(id, new ElementStub()); return nodes.get(id); } });
  const calls = { selected: [], wake: 0 };
  const motionPreference = new ElementStub();
  const state = { zoom: 1, targetZoom: 1, rotationLon: 0, rotationLat: 0, targetLon: null, targetLat: null, velocityLon: 0, velocityLat: 0, dragging: false, pinching: false, clusterIds: [], pointerMoved: false };
  const context = vm.createContext({ Element: ElementStub, document, window, performance: { now: () => 100 }, Math, state, activeGlobePointers: new Map(), pinchStartDistance: 0, pinchStartZoom: 1, globeGestureHadMultiplePointers: false, globeEngaged: false, globeContextLost: false, globeContextRecoveryExtension: null, MIN_GLOBE_ZOOM: 0.82, reduceMotion: false, motionPreference,
    classifyGlobeDragIntent, pinchZoom, pointerDistance, classifyWheelIntent, wheelZoomFactor,
    wakeGlobe() { calls.wake++; }, pauseGlobe() {}, markGlobeEngaged() {}, renderClusterTray() {}, setCountryHighlight() {}, maxGlobeZoom: () => 8, normalizeLongitude: value => ((value + 540) % 360) - 180, clampGlobeLatitude: value => Math.max(-82, Math.min(82, value)), selectCountryFromPointer: event => calls.selected.push(event), zoomTowardPointer() {}, focusRegion() {}, recoverGlobeContext() {}, icon: { pause: "", play: "" } });
  vm.runInContext(inputSource, context);
  const point = (x = 100, y = 100, identifier = 1, target = canvas) => ({ clientX: x, clientY: y, identifier, target });
  const touch = (type, touches, changedTouches = [], target = canvas) => stage.dispatch(type, { target, touches, changedTouches });
  const pointer = (type, props = {}) => stage.dispatch(type, { target: canvas, ...props });
  return { stage, canvas, pin, chrome, context, calls, state, window, document, motionPreference, point, touch, pointer };
}

test("a stationary touch on the canvas selects once, including browsers that also emit pointer events", () => {
  const f = fixture(); const point = f.point();
  f.pointer("pointerdown"); f.touch("touchstart", [point], [point]);
  f.pointer("pointerup"); f.touch("touchend", [], [point]);
  assert.equal(f.calls.selected.length, 1);
  assert.equal(f.calls.selected[0].pointerType, "touch");
});

test("touch streams have one owner when pointer and touch events both arrive", () => {
  const f = fixture();
  f.pointer("pointerdown"); f.touch("touchstart", [f.point()], [f.point()]);
  for (const x of [120, 150, 180]) { f.pointer("pointermove", { clientX: x }); f.touch("touchmove", [f.point(x)]); }
  assert.equal(f.context.activeGlobePointers.size, 0);
  assert.ok(f.state.rotationLon < -5);
});

test("a pinch can continue as a one-finger drag without a stuck pinch or phantom tap", () => {
  const f = fixture();
  f.touch("touchstart", [f.point(80), f.point(140, 100, 2)], [f.point(80), f.point(140, 100, 2)]);
  f.touch("touchmove", [f.point(60), f.point(160, 100, 2)]);
  const zoom = f.state.targetZoom;
  f.touch("touchend", [f.point(60)], [f.point(160, 100, 2)]);
  assert.equal(f.state.pinching, false);
  for (const x of [80, 110]) f.touch("touchmove", [f.point(x)]);
  f.touch("touchend", [], [f.point(110)]);
  assert.ok(f.state.rotationLon < 0);
  assert.equal(f.state.targetZoom, zoom);
  assert.equal(f.calls.selected.length, 0);
  assert.equal(f.state.dragging, false);
});

test("vertical page scrolling does not select or rotate the globe", () => {
  const f = fixture();
  f.touch("touchstart", [f.point()], [f.point()]);
  const first = f.touch("touchmove", [f.point(102, 130)]);
  const second = f.touch("touchmove", [f.point(130, 160)]);
  f.touch("touchend", [], [f.point(130, 160)]);
  assert.equal(first.defaultPrevented, false); assert.equal(second.defaultPrevented, false);
  assert.equal(f.calls.selected.length, 0); assert.equal(f.state.rotationLon, 0);
});

test("lost mouse pointer capture cancels motion and stale pointers", () => {
  const f = fixture(); f.pointer("pointerdown", { pointerType: "mouse" });
  f.pointer("pointermove", { pointerType: "mouse", clientX: 160 });
  f.pointer("lostpointercapture", { pointerType: "mouse" });
  assert.equal(f.context.activeGlobePointers.size, 0);
  assert.equal(f.state.dragging, false); assert.equal(f.state.velocityLon, 0);
  assert.equal(f.calls.selected.length, 0);
});

test("app interruption clears both input streams before the next gesture", () => {
  const f = fixture(); f.pointer("pointerdown", { pointerType: "mouse" });
  f.pointer("pointermove", { pointerType: "mouse", clientX: 160 });
  f.window.dispatch("blur");
  assert.equal(f.context.activeGlobePointers.size, 0); assert.equal(f.state.dragging, false);
  assert.equal(f.state.velocityLon, 0);
  f.touch("touchstart", [f.point()], [f.point()]); f.touch("touchend", [], [f.point()]);
  assert.equal(f.calls.selected.length, 1);
});

test("touch cancellation cannot leave the renderer in a permanent gesture state", () => {
  const f = fixture(); f.touch("touchstart", [f.point()], [f.point()]);
  f.touch("touchmove", [f.point(140)]); f.touch("touchcancel", [], [f.point(140)]);
  assert.equal(f.state.dragging, false); assert.equal(f.state.pinching, false);
  assert.equal(f.state.velocityLon, 0); assert.equal(f.calls.selected.length, 0);
});

test("a native marker tap keeps its button click and does not also pick the canvas", () => {
  const f = fixture(); const point = f.point(100, 100, 1, f.pin);
  const start = f.touch("touchstart", [point], [point], f.pin);
  f.touch("touchend", [], [point], f.pin);
  assert.equal(start.defaultPrevented, false);
  assert.equal(f.calls.selected.length, 0);
});

test("touches on map controls never become a pinch or intercept their scrolling", () => {
  const f = fixture();
  const first = f.point(); const second = f.point(140, 100, 2, f.chrome);
  f.touch("touchstart", [first], [first]);
  f.touch("touchstart", [first, second], [second], f.chrome);
  const move = f.touch("touchmove", [f.point(100, 140), second]);
  assert.equal(f.state.pinching, false); assert.equal(move.defaultPrevented, false);
});

test("right-click does not capture the map or begin a rotation", () => {
  const f = fixture(); f.pointer("pointerdown", { pointerType: "mouse", button: 2 });
  assert.equal(f.context.activeGlobePointers.size, 0); assert.equal(f.state.dragging, false);
});

function functionSource(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end);
}

test("repeated wheel zoom uses incremental input, not the lagging animated zoom", () => {
  function drive(zoom) {
    const state = { zoom, targetZoom: 2, rotationLon: 0, rotationLat: 0 };
    const context = vm.createContext({ state, MIN_GLOBE_ZOOM: 0.82, maxGlobeZoom: () => 12, wakeGlobe() {}, globeCoordinateAtClientPoint: () => ({ lat: 0, lng: 20 }), normalizeLongitude: value => value, clampGlobeLatitude: value => value });
    vm.runInContext(functionSource("zoomTowardPointer", "maxGlobeZoom") + "zoomTowardPointer(1.1, 100, 100);", context);
    return state.rotationLon;
  }
  assert.equal(drive(1), drive(2));
  assert.ok(drive(1) < 4);
});

test("failed WebGL recovery never announces success", () => {
  let notified = false; const messages = [];
  const context = vm.createContext({ globeCanvasElement: {}, resetGlobeContextResources() {}, globeContextLost: true, globeUnavailableReported: true, globeStageElement: { classList: { remove() {} } }, document: { getElementById: () => ({}) }, initThreeGlobe: () => false, reportGlobeUnavailable: message => messages.push(message), notify: () => { notified = true; } });
  vm.runInContext(functionSource("recoverGlobeContext", "renderThreeGlobe") + "recoverGlobeContext();", context);
  assert.equal(notified, false); assert.equal(context.globeContextLost, true);
  assert.match(messages[0], /still unavailable/);
});

test("context reset releases shared GPU objects once", () => {
  const disposed = { geometry: 0, material: 0, texture: 0, renderer: 0 };
  const texture = { isTexture: true, dispose: () => disposed.texture++ };
  const material = { map: texture, emissiveMap: texture, dispose: () => disposed.material++ };
  const object = { geometry: { dispose: () => disposed.geometry++ }, material };
  const context = vm.createContext({ pauseGlobe() {}, globeScene: { traverse: callback => { callback(object); callback(object); } }, globeLandMask: { value: texture }, globeRenderer: { dispose: () => disposed.renderer++ } });
  vm.runInContext(functionSource("resetGlobeContextResources", "recoverGlobeContext") + "resetGlobeContextResources();", context);
  assert.deepEqual(disposed, { geometry: 1, material: 1, texture: 1, renderer: 1 });
  assert.equal(context.globeLandMask.value, null);
});

test("expensive detail work only applies and starts after interaction settles", () => {
  const calls = { apply: 0, geometry: 0, texture: 0 };
  const state = { globeVisible: true, dragging: true, pinching: false, velocityLon: 0, velocityLat: 0, zoom: 5, targetZoom: 5, targetLon: null };
  const context = vm.createContext({ state, globeContextLost: false, document: { hidden: false }, globeCanvasElement: {}, globeViewportWidth: 390, globeViewportHeight: 440, advanceGlobe() {}, window: { innerWidth: 390 }, applyPendingGlobeDetail: () => calls.apply++, loadDetailGeometry: () => calls.geometry++, loadDetailEarthImagery: () => calls.texture++, globeCloseViewActive: true, renderThreeGlobe: () => true, renderPins() {}, updateGlobeReadout() {}, globeHasMotion: () => false, globeStageElement: { classList: { remove() {} } } });
  vm.runInContext(functionSource("animateGlobe", "focusRegion") + "animateGlobe(100);", context);
  assert.deepEqual(calls, { apply: 0, geometry: 0, texture: 0 });
  state.dragging = false; vm.runInContext("animateGlobe(200)", context);
  assert.deepEqual(calls, { apply: 1, geometry: 1, texture: 1 });
});

test("touch targets stay mounted while moving, then regroup on the release frame", () => {
  let groups = 0; let positions = 0;
  const state = { autoRotate: false, dragging: true, touching: true, pinching: false, velocityLon: 0, velocityLat: 0, targetZoom: 1, zoom: 1, targetLon: null, viewMode: 'aid', selectedId: null };
  const layer = { innerHTML: "old controls", querySelectorAll: () => [] };
  const context = vm.createContext({ state, globeServicePoints: {}, globeStageElement: { classList: { toggle() {} } }, globeHasMotion: state => state.dragging, globeLastPinUpdate: 0, globePinLayerElement: layer, pinSignature: "old", repositionPins: () => positions++, selectedResource: () => null, clusterVisibleResources: () => { groups++; return []; }, placePins() {}, pinElements: new Map(), lastPinClusters: [] });
  vm.runInContext(functionSource("renderPins", "placePins") + "renderPins(390,440,1000);", context);
  assert.equal(positions, 1); assert.equal(groups, 0); assert.equal(layer.innerHTML, "old controls");
  state.dragging = false; state.touching = false;
  vm.runInContext("renderPins(390,440,1001)", context);
  assert.equal(groups, 1); assert.equal(layer.innerHTML, "");
});

test("mobile detail texture has one quarter of the decoded pixels and a bounded download", async () => {
  const bytes = await readFile(new URL("../public/media/earth-blue-marble-mobile.jpg", import.meta.url));
  let offset = 2; let dimensions;
  while (offset < bytes.length) {
    assert.equal(bytes[offset], 0xff);
    const marker = bytes[offset + 1];
    if ([0xc0, 0xc1, 0xc2].includes(marker)) { dimensions = [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)]; break; }
    offset += 2 + bytes.readUInt16BE(offset + 2);
  }
  assert.deepEqual(dimensions, [4096, 2048]);
  assert.ok(bytes.length < 1_000_000, `Mobile texture is ${bytes.length} bytes`);
  assert.match(source, /image\.src = window\.innerWidth <= 600[\s\S]{0,280}earth-blue-marble-mobile\.jpg/);
});


test("retry uses the extension captured before context loss and waits for restoration", () => {
  const f = fixture(); let requests = 0;
  f.context.globeRenderer = { getContext: () => ({ isContextLost: () => true, getExtension: () => null }) };
  f.context.globeContextRecoveryExtension = { restoreContext: () => requests++ };
  f.context.recoverGlobeContext = () => { throw new Error("Must wait for webglcontextrestored"); };
  f.document.getElementById("retryGlobe").dispatch("click");
  assert.equal(requests, 1);
});

function timingFixture(overrides = {}, reduceMotion = false) {
  const state = { targetLon: null, targetLat: null, rotationLon: 0, rotationLat: 0, dragging: false, pinching: false, velocityLon: 0, velocityLat: 0, autoRotate: false, interactionUntil: 0, ambientZoom: 1, zoom: 1, targetZoom: 6, ...overrides };
  const context = vm.createContext({ state, lastFrame: 0, reduceMotion, Math, normalizeLongitude: value => ((value + 540) % 360) - 180, clampGlobeLatitude: value => Math.max(-82, Math.min(82, value)), shortestLongitude: (from, to) => ((to - from + 540) % 360) - 180 });
  vm.runInContext(functionSource("advanceGlobe", "pauseGlobe"), context);
  return { state, advance: now => vm.runInContext(`advanceGlobe(${now})`, context) };
}

test("zoom settling follows wall time at both normal and stalled frame rates", () => {
  const regular = timingFixture(); const stalled = timingFixture();
  for (let i = 1; i <= 60; i++) regular.advance(i * 1000 / 60);
  stalled.advance(500); stalled.advance(1000);
  assert.ok(Math.abs(regular.state.zoom - stalled.state.zoom) < 1e-10);
  assert.ok(Math.abs(stalled.state.targetZoom - stalled.state.zoom) < 0.008);
});

test("a long frame decays inertia without advancing rotation through the whole stall", () => {
  const f = timingFixture({ velocityLon: 36, velocityLat: 20 });
  f.advance(1000);
  assert.ok(Math.abs(f.state.rotationLon - 1.44) < 1e-9);
  assert.ok(Math.abs(f.state.rotationLat - 0.8) < 1e-9);
  assert.ok(Math.abs(f.state.velocityLon - 1.98) < 1e-9);
});

test("focus completes on the current settled frame instead of needing another slow frame", () => {
  const f = timingFixture({ targetLon: 30, targetLat: 20 });
  f.advance(1000);
  assert.equal(f.state.targetLon, null); assert.equal(f.state.targetLat, null);
  assert.equal(f.state.rotationLon, 30); assert.equal(f.state.rotationLat, 20);
});

test("reduced-motion focus and zoom settle immediately", () => {
  const f = timingFixture({ targetLon: 100, targetLat: 40 }, true);
  f.advance(16);
  assert.equal(f.state.targetLon, null); assert.equal(f.state.rotationLon, 100);
  assert.equal(f.state.zoom, f.state.targetZoom);
});

for (const input of ["keyboard", "button"]) test(`${input} resumes rotation immediately after a recent interaction and pauses on a second activation`, () => {
  const f = fixture();
  f.state.autoRotate = false;
  f.state.interactionUntil = 6100;
  const activate = () => input === "keyboard"
    ? f.canvas.dispatch("keydown", { key: " " })
    : f.document.getElementById("toggleMotion").dispatch("click");
  const event = activate();
  assert.equal(f.state.autoRotate, true);
  assert.equal(f.state.interactionUntil, 0, "explicit Resume must cancel the ordinary post-interaction delay");
  assert.equal(f.document.getElementById("toggleMotion").title, "Pause globe rotation");
  assert.ok(f.calls.wake > 0);
  if (input === "keyboard") assert.equal(event.defaultPrevented, true);
  activate();
  assert.equal(f.state.autoRotate, false);
  assert.equal(f.document.getElementById("toggleMotion").title, "Resume globe rotation");
});

test("enabling reduced motion live stops rotation and inertia and settles an active camera transition", () => {
  const f = fixture();
  Object.assign(f.state, { autoRotate: true, interactionUntil: 6100, velocityLon: 36, velocityLat: 20,
    targetLon: 100, targetLat: 40, zoom: 1, targetZoom: 6, ambientZoom: 1 });
  f.motionPreference.dispatch("change", { matches: true });
  assert.equal(f.context.reduceMotion, true);
  assert.equal(f.state.autoRotate, false);
  assert.equal(f.state.velocityLon, 0); assert.equal(f.state.velocityLat, 0);
  assert.equal(f.document.getElementById("toggleMotion").title, "Resume globe rotation");
  assert.equal(f.calls.wake, 1);
  Object.assign(f.context, { lastFrame: 100, shortestLongitude: (from, to) => ((to - from + 540) % 360) - 180 });
  vm.runInContext(functionSource("advanceGlobe", "pauseGlobe") + "\nadvanceGlobe(116);", f.context);
  assert.equal(f.state.rotationLon, 100); assert.equal(f.state.rotationLat, 40);
  assert.equal(f.state.targetLon, null); assert.equal(f.state.zoom, 6);
});

test("returning to normal motion never resumes rotation or inertia without another explicit action", () => {
  const f = fixture();
  f.state.autoRotate = true; f.state.velocityLon = 12; f.state.velocityLat = 8;
  f.motionPreference.dispatch("change", { matches: true });
  const wakes = f.calls.wake;
  f.motionPreference.dispatch("change", { matches: false });
  assert.equal(f.context.reduceMotion, false);
  assert.equal(f.state.autoRotate, false);
  assert.equal(f.state.velocityLon, 0); assert.equal(f.state.velocityLat, 0);
  assert.equal(f.calls.wake, wakes, "normal preference must not restart the idle loop");
  assert.equal(f.document.getElementById("toggleMotion").title, "Resume globe rotation");
});
