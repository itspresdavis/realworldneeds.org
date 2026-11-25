import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const worker = await readFile('public/sw.js', 'utf8');
for (const path of ['/corrections?resourceId=bowery-mission', '/corrections/', '/corrections.html', '/api/corrections', '/api/correction-review']) {
  test(`correction route ${path} never receives an offline directory substitute or enters its cache`, async () => {
    const handlers = new Map();
    let intercepted = false, opened = 0, requested = 0, pending;
    vm.runInNewContext(worker, {
      URL, Request, Response,
      self: { location: { origin: 'https://rwn.test' }, addEventListener: (name, handler) => handlers.set(name, handler) },
      caches: { async open() { opened++; return { async match() {}, async put() {} }; } },
      fetch: async () => { requested++; return new Response('Public directory substitute'); },
    });
    handlers.get('fetch')({
      request: { url: 'https://rwn.test' + path, method: 'GET', mode: 'navigate' },
      respondWith(value) { intercepted = true; pending = value; },
    });
    await pending;
    assert.equal(intercepted, false, 'Private submission/review navigation must go directly to the network');
    assert.equal(opened, 0);
    assert.equal(requested, 0);
  });
}
