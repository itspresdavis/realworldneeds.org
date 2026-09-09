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
