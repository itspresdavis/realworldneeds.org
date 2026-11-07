import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import { versionOfflineAssets, requiredOfflineAssets, moduleDependencies } from '../scripts/version-offline-assets.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 12);
const legacy = await readFile('tests/fixtures/legacy-query-worker.txt', 'utf8');
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rwn-offline-graph-'));
  const put = async (path, value) => { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), value); };
  for (const path of requiredOfflineAssets) await put(path, path === '/directory.js' ? 'import("./directory-geography.js?v=abc");' : path === '/saved-loader.js' ? 'import("./saved-services.js?v=abc");' : `/* ${path} */`);
  await put('/data/release.json', '{}');
  await put('/data/postal-areas.json', '{"02108":[42.36,-71.06]}');
  await put('/directory/index.html', '<head><script src="/language.js?v=abc"></script><script type="module" src="/src/utils/search-intent-entry.js?v=abc"></script><link href="/task-controls.css?v=abc" /></head>');
  await put('/src/utils/search-intent-entry.js', 'import { run } from "./search-intent-controls.js?v=abc"; run();');
  await put('/src/utils/search-intent-controls.js', 'import { value } from "./search-intent.js?v=abc"; export function run() { return value; }');
  await put('/src/utils/search-intent.js', 'export { value } from "./search.js?v=abc"; export const postal = "/data/postal-areas.json";');
  await put('/src/utils/search.js', 'export const value = "before";');
  return { root, put };
}

test('byte-hashes cover the entire explicit public graph and optional postal reference without old-worker interception', async () => {
  const { root } = await fixture();
  try {
    const result = await versionOfflineAssets(root);
    assert.equal(Object.keys(result.assets).length, requiredOfflineAssets.length + 4);
    assert.deepEqual(Object.keys(result.optional), ['/data/postal-areas.json']);
    const handlers = new Map();
    vm.runInNewContext(legacy, { URL, Request, self: { location: { origin: 'https://rwn.test' }, addEventListener: (name, fn) => handlers.set(name, fn) } });
    for (const [canonical, path] of Object.entries({ ...result.assets, ...result.optional })) {
      assert.equal(path, canonical.replace(/\.(js|css|json)$/, `.${hash(await readFile(join(root, path)))}.$1`));
      let intercepted = false;
      handlers.get('fetch')({ request: new Request('https://rwn.test' + path + '?v=old'), respondWith() { intercepted = true; } });
      assert.equal(intercepted, false, path);
    }
    for (const path of Object.keys(result.assets).filter(path => path.startsWith('/src/'))) {
      const source = await readFile(join(root, result.assets[path]), 'utf8');
      for (const child of moduleDependencies(source, result.assets[path], { allowVersioned: true })) assert.ok(Object.values(result.assets).includes(child.canonical), child.canonical);
    }
    assert.ok((await readFile(join(root, result.assets['/src/utils/search-intent.js']), 'utf8')).includes(result.optional['/data/postal-areas.json']));
    const html = await readFile(join(root, '/directory/index.html'), 'utf8');
    assert.ok(html.includes(result.assets['/language.js']));
    assert.ok(html.includes(result.assets['/src/utils/search-intent-entry.js']));
    const preloads = [...html.matchAll(/<link rel="modulepreload" href="([^"]+)" data-rwn-search-preload \/>/g)].map(match => match[1]);
    assert.deepEqual(preloads.sort(), ['search-intent-controls', 'search-intent', 'search'].map(name => result.assets[`/src/utils/${name}.js`] + '?v=abc').sort());
    assert.equal(new Set(preloads).size, preloads.length);
    assert.ok(preloads.every(url => !url.includes('postal-areas')), 'postal reference still requires a deliberate postal query');
    const again = await versionOfflineAssets(root);
    assert.deepEqual(again, result);
    assert.equal(await readFile(join(root, '/directory/index.html'), 'utf8'), html);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('preloads exclude unrelated pages and optional dynamic modules', async () => {
  const { root, put } = await fixture();
  try {
    await put('/about/index.html', '<head><title>About RWN</title></head>');
    await put('/src/utils/search.js', 'export const value = "before"; export const extra = () => import("./extra.js?v=abc");');
    await put('/src/utils/extra.js', 'export const optional = true;');
    const result = await versionOfflineAssets(root);
    assert.ok(result.assets['/src/utils/extra.js'], 'the explicit cache graph still includes declared modules');
    assert.ok(!(await readFile(join(root, '/directory/index.html'), 'utf8')).includes(`href="${result.assets['/src/utils/extra.js']}`));
    assert.ok(!(await readFile(join(root, '/about/index.html'), 'utf8')).includes('modulepreload'));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('leaf and optional-data changes rotate every importing ancestor and already-versioned HTML', async () => {
  const { root, put } = await fixture();
  try {
    const before = await versionOfflineAssets(root);
    await put('/src/utils/search.js', 'export const value = "after";');
    const after = await versionOfflineAssets(root);
    for (const path of Object.keys(before.assets).filter(path => path.startsWith('/src/'))) assert.notEqual(after.assets[path], before.assets[path], path);
    assert.equal(before.assets['/language.js'], after.assets['/language.js']);
    assert.ok((await readFile(join(root, '/directory/index.html'), 'utf8')).includes(after.assets['/src/utils/search-intent-entry.js']));
    await put('/data/postal-areas.json', '{"02108":[42.361,-71.06]}');
    const changedPostal = await versionOfflineAssets(root);
    assert.notEqual(changedPostal.optional['/data/postal-areas.json'], after.optional['/data/postal-areas.json']);
    assert.notEqual(changedPostal.assets['/src/utils/search-intent-entry.js'], after.assets['/src/utils/search-intent-entry.js']);
    assert.equal(changedPostal.assets['/src/utils/search.js'], after.assets['/src/utils/search.js']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('private, external, missing, cyclic and computed dependencies fail the build instead of silently escaping the graph', async () => {
  for (const statement of ['import "/api/account.js";', 'import "../../../server/private.js";', 'import "https://example.org/a.js";', 'import "some-package";', 'import(name);', 'import "./missing.js";', 'import "./search-intent-entry.js";']) {
    const { root, put } = await fixture();
    try {
      await put('/src/utils/search-intent-entry.js', statement);
      await assert.rejects(versionOfflineAssets(root));
      assert.deepEqual(JSON.parse(await readFile(join(root, '/data/release.json'), 'utf8')), {});
    } finally { await rm(root, { recursive: true, force: true }); }
  }
});
