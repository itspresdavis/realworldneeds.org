import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile('public/saved-services.js', 'utf8');
const start = source.indexOf('  window.addEventListener("pagehide",');
const end = source.indexOf('  syncView(active());', start);
assert.ok(start >= 0 && end > start);

test('worker replacement refreshes a live Saved page but never starts work after departure', () => {
  const events = new Map(), frames = [];
  let refreshes = 0, invalidations = 0, cancellations = 0, restores = 0;
  const context = vm.createContext({
    activePage: true, generation: 0, SAVED_RESOURCES_KEY: 'rwn-saved-resources',
    window: { addEventListener: (name, callback) => events.set(name, callback), requestAnimationFrame: callback => frames.push(callback) },
    navigator: { serviceWorker: { addEventListener: (name, callback) => events.set(name, callback) } },
    loadCatalog: { reset: () => invalidations++, retry: () => cancellations++ },
    render: () => refreshes++, syncView: () => restores++,
  });
  vm.runInContext(source.slice(start, end), context);
  events.get('controllerchange')();
  assert.equal(invalidations, 1, 'old catalog is invalidated immediately');
  assert.equal(refreshes, 0, 'refresh cannot start in the navigation callback');
  events.get('pagehide')();
  frames.shift()();
  assert.equal(refreshes, 0, 'departing documents must not fetch');
  assert.equal(cancellations, 1, 'unfinished requests are cancelled on departure');
  events.get('pageshow')();
  assert.equal(restores, 1, 'a browser-history return restores the view');
  events.get('controllerchange')();
  frames.shift()();
  assert.equal(refreshes, 1, 'a live page still refreshes after an update');
});
