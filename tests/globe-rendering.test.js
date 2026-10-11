import test from 'node:test';
import assert from 'node:assert/strict';
import { frameBufferMatches, globeHasMotion, globePointVisible } from '../src/utils/globe-rendering.js';

test('fractional CSS sizes match the drawing buffer without reallocating it', () => {
  assert.equal(frameBufferMatches({width: 1000, height: 788}, 571.7, 450.3, 1.75), true);
  assert.equal(frameBufferMatches({width: 999, height: 788}, 571.7, 450.3, 1.75), false);
});

test('a stationary map needs no continuous frames but all camera motion does', () => {
  const still = {autoRotate:false, dragging:false, pinching:false, targetLon:null, velocityLon:0, velocityLat:0, zoom:1, targetZoom:1};
  assert.equal(globeHasMotion(still), false);
  for (const change of [{autoRotate:true},{dragging:true},{pinching:true},{targetLon:0},{velocityLon:0.1},{velocityLat:0.1},{targetZoom:2}]) {
    assert.equal(globeHasMotion({...still,...change}), true);
  }
});

test('perspective horizon excludes far-side controls, including close zoom', () => {
  assert.equal(globePointVisible(0.1, 3.2), false);
  assert.equal(globePointVisible(0.5, 3.2), true);
  assert.equal(globePointVisible(0.6, 1.4), false);
  assert.equal(globePointVisible(0.8, 1.4), true);
});


test('moving frames keep elapsed rendering time while waking from rest resets it', async () => {
  const { readFile } = await import('node:fs/promises');
  const { runInNewContext } = await import('node:vm');
  const source = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  const scheduler = source.slice(source.indexOf('function wakeGlobe('), source.indexOf('function focusRegion('));
  const callbacks = [];
  const context = {
    globeFrameHandle: null, globeContextLost: false, lastFrame: 0,
    globeRenderer: null, pendingDetailGeometry: null, pendingDetailImage: null,
    state: { globeVisible: true, dragging: false, pinching: false, velocityLon: 0, velocityLat: 0, zoom: 1, targetZoom: 1, targetLon: null },
    document: { hidden: false }, window: { innerWidth: 1440, requestAnimationFrame: callback => { callbacks.push(callback); return callbacks.length; } },
    performance: { now: () => context.clock }, clock: 1000,
    globeCanvasElement: {}, globeViewportWidth: 800, globeViewportHeight: 800,
    globeCloseViewActive: false, globeStageElement: { classList: { remove() {} } },
    advanceGlobe: now => { context.deltas.push(now - context.lastFrame); context.lastFrame = now; },
    renderThreeGlobe: () => { context.clock += 12; return true; },
    renderPins() {}, updateGlobeReadout() {},
    globeHasMotion: () => context.moving, moving: true, deltas: []
  };
  runInNewContext(scheduler, context);
  context.wakeGlobe();
  context.clock = 1016;
  callbacks.shift()(1016);
  context.clock = 1032;
  context.moving = false;
  callbacks.shift()(1032);
  assert.deepEqual(context.deltas, [16, 16], 'render work must count toward the next animation step');
  assert.equal(callbacks.length, 0, 'stationary maps stop scheduling frames');
  context.clock = 5000;
  context.wakeGlobe();
  callbacks.shift()(5016);
  assert.deepEqual(context.deltas, [16, 16, 16], 'resuming must not integrate time spent asleep');
});
