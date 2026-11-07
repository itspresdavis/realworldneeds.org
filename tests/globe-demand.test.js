import test from 'node:test';
import assert from 'node:assert/strict';
import { startGlobeWhenNeeded } from '../src/utils/globe-demand.js';

function fixture({ top = 900, supported = true, observer = true, hidden = false, viewportHeight = 600, canvasHeight = 400 } = {}) {
  const win = new EventTarget(), doc = new EventTarget(), stage = new EventTarget();
  const frames = new Map(); let frameId = 0, starts = 0, probes = 0, disconnected = 0, observe;
  Object.assign(win, { innerWidth: 390, innerHeight: viewportHeight,
    requestAnimationFrame(callback) { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame(id) { frames.delete(id); } });
  if (observer) win.IntersectionObserver = class { constructor(callback) { observe = callback; } observe() {} disconnect() { disconnected++; } };
  const canvas = { closest: selector => { assert.equal(selector, '.globe-stage'); return stage; },
    getContext(type, options) { probes++; assert.equal(type, 'webgl2'); assert.equal(options.alpha, true); return supported ? {} : null; },
    getBoundingClientRect: () => ({ left: 0, right: 390, width: 390, top, bottom: top + canvasHeight, height: canvasHeight }) };
  Object.assign(doc, { getElementById: () => canvas, documentElement: { dataset: {} }, visibilityState: hidden ? 'hidden' : 'visible' });
  const cleanup = startGlobeWhenNeeded(() => { starts++; doc.documentElement.dataset.globeStartup = supported ? 'ready' : 'unavailable'; }, { document: doc, window: win });
  return { win, doc, stage, frames, cleanup, get starts() { return starts; }, get probes() { return probes; }, get disconnected() { return disconnected; },
    move(value) { top = value; }, intersection() { observe?.([]); }, frame() { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn()); } };
}

test('offscreen or barely visible maps do not start optional rendering work', () => {
  for (const top of [900, 599, 520]) {
    const f = fixture({ top });
    assert.equal(f.starts, 0); assert.equal(f.probes, 1);
    assert.equal(f.doc.documentElement.dataset.globeStartup, 'deferred');
    f.intersection(); assert.equal(f.starts, 0);
  }
});
test('a meaningfully visible map starts once and releases listeners and observation', () => {
  const f = fixture({ top: 450 });
  assert.equal(f.starts, 1); assert.equal(f.disconnected, 1);
  f.stage.dispatchEvent(new Event('pointerdown')); f.stage.dispatchEvent(new Event('focusin')); f.intersection();
  f.win.dispatchEvent(new Event('scroll')); f.frame(); assert.equal(f.starts, 1); assert.equal(f.frames.size, 0);
});
for (const event of ['pointerdown', 'focusin']) test(`intentional ${event} starts an offscreen map exactly once`, () => {
  const f = fixture(); f.stage.dispatchEvent(new Event(event)); f.stage.dispatchEvent(new Event(event));
  assert.equal(f.starts, 1); assert.equal(f.disconnected, 1);
});
test('scroll/resize fallback coalesces layout work and supports browsers without observers', () => {
  const f = fixture({ observer: false }); f.move(300);
  f.win.dispatchEvent(new Event('scroll')); f.win.dispatchEvent(new Event('scroll')); f.win.dispatchEvent(new Event('resize'));
  assert.equal(f.frames.size, 1); assert.equal(f.starts, 0); f.frame(); assert.equal(f.starts, 1);
});
test('short landscape viewports can explore a larger canvas without requiring impossible visibility', () => {
  const f = fixture({ top: 50, viewportHeight: 240, canvasHeight: 900 });
  assert.equal(f.starts, 1);
});
test('hidden tabs wait for visible map demand and cleanup cancels scheduled checks', () => {
  const f = fixture({ top: 100, hidden: true }); f.stage.dispatchEvent(new Event('focusin')); assert.equal(f.starts, 0);
  f.doc.visibilityState = 'visible'; f.doc.dispatchEvent(new Event('visibilitychange')); assert.equal(f.starts, 1);
  const canceled = fixture(); canceled.win.dispatchEvent(new Event('scroll')); assert.equal(canceled.frames.size, 1);
  canceled.cleanup(); assert.equal(canceled.frames.size, 0); canceled.move(100); canceled.win.dispatchEvent(new Event('scroll')); canceled.frame(); canceled.intersection(); assert.equal(canceled.starts, 0);
});
test('unavailable WebGL keeps its existing immediate text fallback regardless of viewport', () => {
  const f = fixture({ supported: false }); assert.equal(f.starts, 1); assert.equal(f.doc.documentElement.dataset.globeStartup, 'unavailable');
});
