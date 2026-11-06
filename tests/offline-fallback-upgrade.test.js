import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile('public/offline-status.js', 'utf8');
const body = source.slice(source.indexOf('  const actionLink ='), source.indexOf('  const setOffline ='));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

for (const outcome of ['success', 'failure']) {
  test(`fallback ignores a superseded catalog ${outcome} after the replacement withdraws the record`, async () => {
    const old = deferred();
    let requests = 0;
    const link = { href: 'https://rwn.test/service/withdrawn', closest: () => null };
    const context = vm.createContext({
      document: { querySelectorAll: () => [link], createElement() { throw new Error('Withdrawn actions must not render'); } },
      catalog: () => ++requests === 1 ? old.promise : Promise.resolve({ records: [] }),
      resultId: () => 'withdrawn', catalogUnavailable: false,
      networkOffline: false, setOffline() {}, status: {},
      unavailableMessage: 'Unavailable', setText(node, value) { node.textContent = value; },
    });
    vm.runInContext(`${body}\nglobalThis.enhance = enhanceSearchActions; globalThis.invalidate = invalidateFallback;`, context);
    const obsolete = context.enhance();
    context.invalidate();
    await context.enhance();
    if (outcome === 'success') old.resolve({ records: [{ id: 'withdrawn', kind: 'direct', lat: 40.7219, lng: -73.9932 }] });
    else old.reject(new Error('Obsolete request failed'));
    await obsolete;
    assert.equal(requests, 2);
    assert.equal(context.catalogUnavailable, false, 'an obsolete error must not replace the newer successful state');
    assert.equal(context.status.textContent, undefined);
  });
}


test('fallback releases detached owned rows before another search or upgrade', async () => {
  const context = vm.createContext({
    document: { querySelectorAll: () => [] },
    catalog() { throw new Error('An empty result list must not request a catalog'); },
    networkOffline: false, setOffline() {},
  });
  vm.runInContext(`${body}
    fallbackRows.set({}, { wrapper: { isConnected: false, replaceWith() { throw new Error("Detached rows must be released"); } }, extras: [] });
    globalThis.enhance = enhanceSearchActions; globalThis.invalidate = invalidateFallback;`, context);
  await context.enhance();
  context.invalidate();
  assert.equal(vm.runInContext('fallbackRows.size', context), 0);
});
