import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';
import { runtimePatternFor, manifestIdentity } from '../scripts/browser-asset-upgrade.mjs';

// The asset fixture exports its pure contract helpers without starting a browser.
// Inspect the other fixture declarations without executing their entrypoint.
const assetFixture = await readFile('scripts/browser-asset-upgrade.mjs', 'utf8');
const cacheFixture = await readFile('scripts/browser-cache-upgrade.mjs', 'utf8');
const worker = await readFile('public/sw.js', 'utf8');
const builtWorker = await readFile('dist/sw.js', 'utf8');
const release = JSON.parse(await readFile('dist/data/release.json', 'utf8'));
const declaration = (source, pattern, label) => {
  const match = source.match(pattern);
  assert.ok(match, `${label} must remain inspectable without launching a browser`);
  return vm.runInNewContext(match[1]);
};
const runtimePattern = runtimePatternFor(release.offlineAssets, release.offlineOptionalAssets);
const workerPattern = vm.runInNewContext(builtWorker + '\nruntimePattern', {
  URL, Request, Response, self: { location: { origin: 'https://fixture.test' }, addEventListener() {} },
});
const fixturePaths = Array.from(declaration(cacheFixture, /for \(const path of (\[[^\n]+\])\) \{\s*fixtureFiles\.set/, 'Browser cache fixture asset list'), path => `/${path}`);
const corePaths = Array.from(declaration(worker, /const CORE_ASSETS = (\[[\s\S]*?\n\]);/, 'Production required core assets'));
const fixtureHtml = declaration(cacheFixture, /const fixtureHtml = (`[\s\S]*?`);/, 'Browser cache fixture HTML');

test('browser asset-upgrade allowlist accepts every actual required and optional public asset with its exact byte hash', async () => {
  assert.ok(release.offlineAssets['/page-menu.js']);
  for (const path of Object.values({ ...release.offlineAssets, ...release.offlineOptionalAssets })) {
    const match = path.match(runtimePattern);
    assert.ok(match, `Browser fixture rejects built required runtime ${path}`);
    const hash = createHash('sha256').update(await readFile(`dist${path}`)).digest('hex').slice(0, 12);
    assert.equal(match[1], hash, `Browser fixture must check the true content identity: ${path}`);
  }
});

test('browser archive and actual built worker agree on declared paths and reject unrelated or private paths', () => {
  for (const [canonical, path] of Object.entries({ ...release.offlineAssets, ...release.offlineOptionalAssets })) {
    assert.equal(runtimePattern.test(path), true, path);
    assert.equal(workerPattern.test(path), true, path);
    const oldVersion = path.replace(/\.[a-f0-9]{12}\./, '.123456789abc.');
    assert.equal(runtimePattern.test(oldVersion), true, canonical + ' supports its prior content identity');
    assert.equal(workerPattern.test(oldVersion), true, canonical + ' supports its prior content identity');
    const wrongType = path.replace(/\.(?:js|css|json)$/, path.endsWith('.json') ? '.css' : '.json');
    assert.equal(runtimePattern.test(wrongType), false, wrongType);
    // Older workers admitted CSS/JS stems interchangeably. The new typed
    // graph manifest must reject the wrong extension on every admitted stem.
    if (release.offlineOptionalAssets) assert.equal(workerPattern.test(wrongType), false, wrongType);
  }
  for (const path of ['/directory', '/data/search-index.json', '/page-menu.js', '/unrecognized.123456789abc.js',
    '/page-menu.123456789ab.js', '/page-menu.123456789abcd.js', '/page-menu.123456789abg.js',
    '/nested/page-menu.123456789abc.js', '/page-menu.123456789abc.html', '/page-menu.123456789abc.js?query=private',
    '/api/account.123456789abc.js', '/server/workspace.123456789abc.js',
    '/src/utils/unlisted.123456789abc.js', '/data/private.123456789abc.json']) {
    assert.equal(runtimePattern.test(path), false, path);
    assert.equal(workerPattern.test(path), false, path);
  }
});

test('manifest-derived fixture rejects unsafe, undeclared and mismatched mappings before reading files', () => {
  const valid = { '/src/utils/search-intent-entry.js': '/src/utils/search-intent-entry.123456789abc.js' };
  const optional = { '/data/postal-areas.json': '/data/postal-areas.123456789abc.json' };
  const accepted = runtimePatternFor(valid, optional);
  assert.equal(accepted.test(valid['/src/utils/search-intent-entry.js']), true);
  assert.equal(accepted.test(optional['/data/postal-areas.json']), true);
  for (const [canonical, path] of [
    ['/api/account.js', '/api/account.123456789abc.js'],
    ['/src/../server/private.js', '/src/../server/private.123456789abc.js'],
    ['/src/utils/%2e%2e/private.js', '/src/utils/%2e%2e/private.123456789abc.js'],
    ['/src/utils/search-intent.js', '/src/utils/search-intent.123456789abc.json'],
    ['/src/utils/search-intent.js', 'https://untrusted.example/src/utils/search-intent.123456789abc.js'],
    ['/src/utils/search-intent.js', '/src/utils/search-intent.123456789abc.js?private=yes'],
  ]) assert.throws(() => runtimePatternFor({ [canonical]: path }), canonical);
  assert.throws(() => runtimePatternFor({}, { '/data/private.json': '/data/private.123456789abc.json' }));
  assert.notEqual(manifestIdentity(valid, optional), manifestIdentity(valid, {}), 'Optional data identity participates without becoming a required precache');
  assert.equal(manifestIdentity(valid), createHash('sha256').update(JSON.stringify(valid)).digest('hex').slice(0, 12), 'Legacy manifest identity remains unchanged');
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

test('cache-upgrade fixture retains the actual directory live status and Retry control', async () => {
  const production = await readFile('scripts/enhance-generated-pages.mjs', 'utf8');
  for (const html of [fixtureHtml, production]) {
    const retry = html.match(/<button\b[^>]*data-directory-retry[^>]*>([^<]+)<\/button>/)?.[0];
    assert.ok(retry, 'Upgrade fixture must offer the production recovery action');
    assert.match(retry, /type="button"/);
    assert.match(retry, /aria-disabled="false"/);
    assert.match(retry, /\bhidden\b/);
    assert.match(retry, />Retry search</);
    const status = html.match(/<(?:span|p)\b[^>]*data-directory-count[^>]*>/)?.[0];
    assert.match(status, /role="status"/);
    assert.match(status, /aria-live="polite"/);
  }
});
