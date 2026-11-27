import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../scripts/browser-globe-touch-v4.mjs', import.meta.url), 'utf8');
const predicate = source.slice(source.indexOf('function returnedGlobeReady('), source.indexOf('\nasync function run()'));

function fixture() {
  const input = { value: 'London' }, readout = { innerText: '' };
  const root = { dataset: { globeStartup: 'loading' } };
  let reveals = 0, unavailable = false;
  const canvas = { dataset: {}, scrollIntoView: () => { reveals++; }, getContext() { throw Error('Readiness must not create a graphics context'); } };
  const elements = { resourceSearch: input, globeReadout: readout, globeCanvas: canvas };
  const document = { documentElement: root, getElementById: id => elements[id], querySelector: () => ({ classList: { contains: () => unavailable } }) };
  const context = vm.createContext({ document });
  vm.runInContext(predicate, context);
  return { input, readout, root, canvas, ready: () => context.returnedGlobeReady('London'), reveals: () => reveals, unavailable: () => { unavailable = true; } };
}

test('a restored query and live capability context do not certify an uninitialized globe', () => {
  const f = fixture();
  assert.equal(f.ready(), false);
  assert.equal(f.reveals(), 1);
  assert.equal(f.ready(), false);
  assert.equal(f.reveals(), 1, 'readiness polling must not repeatedly scroll the page');
  f.root.dataset.globeStartup = 'ready';
  f.canvas.dataset.rwnContextRecovery = 'true';
  assert.equal(f.ready(), false, 'an empty first-frame readout is still pending');
  f.readout.innerText = 'World view · 1.00×';
  assert.equal(f.ready(), true);
});

test('incorrect restored search never triggers map exploration', () => {
  const f = fixture(); f.input.value = 'Paris';
  assert.equal(f.ready(), false);
  assert.equal(f.reveals(), 0);
});

test('unavailable, unbound and invalid zoom states cannot pass return readiness', () => {
  const f = fixture(); f.root.dataset.globeStartup = 'ready'; f.readout.innerText = '2.50×';
  assert.equal(f.ready(), false);
  f.canvas.dataset.rwnContextRecovery = 'true';
  assert.equal(f.ready(), true);
  for (const text of ['', 'World view', '0×', 'NaN×', 'Infinity×']) {
    f.readout.innerText = text; assert.equal(f.ready(), false, text);
  }
  f.readout.innerText = '2.50×'; f.unavailable();
  assert.equal(f.ready(), false);
});

test('a permanently pending return still fails within the unchanged 100-observation budget', async () => {
  const waitSource = source.slice(source.indexOf('async function waitForExpression('), source.indexOf('\nconst touchPoint'));
  let observations = 0, waits = 0;
  const context = vm.createContext({ evaluate: async () => { observations++; return false; }, sleep: async ms => { assert.equal(ms, 100); waits++; } });
  vm.runInContext(waitSource, context);
  await assert.rejects(context.waitForExpression({}, 'pending', 'Return never initialized'), /Return never initialized/);
  assert.equal(observations, 100); assert.equal(waits, 100);
});
