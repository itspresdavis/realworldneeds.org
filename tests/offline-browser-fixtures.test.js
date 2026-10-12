import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Inspect the exact fixture declarations without importing browser entrypoints:
// importing either script would start its server/browser run.
const assetFixture = await readFile('scripts/browser-asset-upgrade.mjs', 'utf8');
const cacheFixture = await readFile('scripts/browser-cache-upgrade.mjs', 'utf8');
const worker = await readFile('public/sw.js', 'utf8');
const release = JSON.parse(await readFile('dist/data/release.json', 'utf8'));
const declaration = (source, pattern, label) => {
  const match = source.match(pattern);
  assert.ok(match, `${label} must remain inspectable without launching a browser`);
  return vm.runInNewContext(match[1]);
};
const runtimePattern = declaration(assetFixture, /const RUNTIME_PATTERN = (\/[^\n]+\/);/, 'Browser asset allowlist');
const workerPattern = declaration(worker, /const runtimePattern = (\/[^\n]+\/);/, 'Production runtime allowlist');
const fixturePaths = Array.from(declaration(cacheFixture, /for \(const path of (\[[^\n]+\])\) \{\s*fixtureFiles\.set/, 'Browser cache fixture asset list'), path => `/${path}`);
const corePaths = Array.from(declaration(worker, /const CORE_ASSETS = (\[[\s\S]*?\n\]);/, 'Production required core assets'));
const fixtureHtml = declaration(cacheFixture, /const fixtureHtml = (`[\s\S]*?`);/, 'Browser cache fixture HTML');

test('browser asset-upgrade allowlist accepts every actual built runtime, including page-menu, with its exact byte hash', async () => {
  assert.ok(release.offlineAssets['/page-menu.js']);
  for (const path of Object.values(release.offlineAssets)) {
    const match = path.match(runtimePattern);
    assert.ok(match, `Browser fixture rejects built required runtime ${path}`);
    const hash = createHash('sha256').update(await readFile(`dist${path}`)).digest('hex').slice(0, 12);
    assert.equal(match[1], hash, `Browser fixture must check the true content identity: ${path}`);
  }
});

test('browser archive allowlist stays exactly aligned with the production worker and rejects non-runtime paths', () => {
  assert.equal(runtimePattern.source, workerPattern.source);
  assert.equal(runtimePattern.flags, workerPattern.flags);
  for (const path of ['/directory', '/data/search-index.json', '/page-menu.js', '/unrecognized.123456789abc.js',
    '/page-menu.123456789ab.js', '/page-menu.123456789abcd.js', '/page-menu.123456789abg.js',
    '/nested/page-menu.123456789abc.js', '/page-menu.123456789abc.html', '/page-menu.123456789abc.js?query=private']) {
    assert.equal(runtimePattern.test(path), false, path);
  }
});

test('browser cache-upgrade fixture serves every canonical asset required by its actual production worker', async () => {
  assert.match(cacheFixture, /if \(pathname === "\/directory"\)/, 'The HTML core path has its dedicated fixture handler');
  assert.deepEqual([...fixturePaths].sort(), corePaths.filter(path => path !== '/directory').sort());
  for (const path of fixturePaths) assert.ok((await readFile(`dist${path}`)).length > 0, `Missing fixture bytes: ${path}`);
});

test('production worker really installs against the browser cache fixture asset set, without a socket or permissive fetch stub', async () => {
  const origin = 'https://fixture.test';
  const files = new Map(await Promise.all(fixturePaths.map(async path => [path, await readFile(`dist${path}`)])));
  files.set('/directory', fixtureHtml);
  const handlers = new Map(), stores = new Map(), requests = [];
  let skipped = false;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async put(request, response) { entries.set(request.url, response.clone()); },
        async match(request) { return entries.get(request.url)?.clone(); }
      };
    },
    async delete(name) { return stores.delete(name); }
  };
  vm.runInNewContext(worker.replaceAll('__RWN_OFFLINE_RELEASE__', 'browser-fixture-test'), {
    URL, Request, Response, caches,
    self: { location: { origin }, addEventListener: (name, callback) => handlers.set(name, callback), async skipWaiting() { skipped = true; } },
    fetch: async path => {
      requests.push(path);
      // Match the real fixture route map: a missing canonical file is a 404,
      // never a fabricated successful response that hides required-asset gaps.
      return files.has(path) ? new Response(files.get(path)) : new Response('Fixture route not found', { status: 404 });
    }
  });
  let installing;
  handlers.get('install')({ waitUntil(promise) { installing = promise; } });
  await installing;
  assert.equal(skipped, true);
  assert.deepEqual(requests.sort(), [...corePaths].sort());
  const installed = stores.get('rwn-offline-browser-fixture-test');
  assert.equal(installed.size, corePaths.length);
  assert.equal(await installed.get(`${origin}/page-menu.js`).text(), await readFile('dist/page-menu.js', 'utf8'));
});
