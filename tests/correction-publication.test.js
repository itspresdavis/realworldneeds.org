import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { verifyCorrectionPublication } from '../server/correction-publication.js';
import { validateCorrectionAction } from '../server/corrections.js';
const record = { id: 'fixture-only', hours: 'Mondays, 9–12', summary: 'Verified fixture' };
const report = { resourceId: record.id, status: 'applied', appliedRecord: record };
const catalog = { resources: [record], resourceCount: 1 };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const manifestFor = snapshot => ({ release: 'abcdef012345', resourceCount: snapshot.resourceCount, catalogSha256: hash(JSON.stringify(snapshot)) });
const release = manifestFor(catalog);
const response = data => Response.json(data);
function transport(replies, calls = []) { return async (url, options) => { calls.push({ url, options }); return replies.shift(); }; }
test('release verification matches the complete reviewed record and stable manifest at a fixed origin', async () => {
  const calls = [];
  assert.deepEqual(await verifyCorrectionPublication(report, { fetchImpl: transport([response(release), response(catalog), response(release)], calls) }), { record, release: release.release });
  assert.deepEqual(calls.map(call => call.url), ['https://www.realworldneeds.org/data/release.json', 'https://www.realworldneeds.org/data/resources.json', 'https://www.realworldneeds.org/data/release.json']);
  assert.ok(calls.every(({ options }) => options.credentials === 'omit' && options.redirect === 'error' && options.cache === 'no-store' && !options.headers.Authorization));
});
for (const [name, snapshot, afterOverride] of [
  ['old public facts', { ...catalog, resources: [{ ...record, hours: 'Old schedule' }] }],
  ['removed listing', { resources: [], resourceCount: 0 }],
  ['changing release', catalog, { release: 'abcdef012346' }],
  ['duplicate listing', { resources: [record, record], resourceCount: 2 }],
  ['incomplete count', { ...catalog, resourceCount: 2 }],
]) test(`unresolved publication: ${name}`, async () => {
  const manifest = manifestFor(snapshot);
  const after = { ...manifest, ...afterOverride };
  await assert.rejects(verifyCorrectionPublication(report, { fetchImpl: transport([response(manifest), response(snapshot), response(after)]) }), error => error.status === 409);
});
for (const stage of ['declared oversize', 'streamed oversize', 'redirect', 'stalled headers', 'stalled body', 'wrong content type']) test(`publication fetch fails safely: ${stage}`, async () => {
  let signal;
  const fetchImpl = async (_, options) => {
    signal = options.signal;
    if (stage === 'stalled headers') return new Promise(() => {});
    if (stage === 'stalled body') return new Response(new ReadableStream({ start() {} }), { headers: { 'content-type': 'application/json' } });
    if (stage === 'redirect') return new Response('', { status: 302, headers: { location: 'http://127.0.0.1/private' } });
    if (stage === 'wrong content type') return new Response('{}', { headers: { 'content-type': 'text/html' } });
    return new Response('x'.repeat(stage === 'streamed oversize' ? 64001 : 0), { headers: { 'content-type': 'application/json', ...(stage === 'declared oversize' ? { 'content-length': '64001' } : {}) } });
  };
  await assert.rejects(verifyCorrectionPublication(report, { fetchImpl, timeout: 15 }), error => error.status === 503);
  if (stage.startsWith('stalled')) assert.equal(signal.aborted, true);
});
test('review actions cannot accept arbitrary URLs, publication claims, provider routes or broad freshness updates', () => {
  const action = { action: 'apply', id: 'a0b744f5-cc43-40b6-8b94-edc28e89830e', revision: 1, catalogUpdatedAt: '2026-11-07T00:00:00Z', changes: { hours: 'Verified schedule' }, reason: 'Checked official source.', evidenceUrl: 'https://example.invalid/source' };
  assert.equal(validateCorrectionAction(action), null);
  for (const extra of [{ changes: { lastChecked: '2026-11-07' } }, { changes: { serviceAccess: [] } }, { changes: { hours: '' } }, { releaseUrl: 'http://127.0.0.1/private' }, { changes: { phone: 'x'.repeat(1001) } }, { action: 'resolve', release: 'abcdef012345' }]) assert.ok(validateCorrectionAction({ ...action, ...extra }));
  assert.equal(validateCorrectionAction({ action: 'resolve', id: action.id, revision: 1 }), null);
});

// Two separately cached endpoints can share a count while representing different releases.
test('same-count stale catalog cannot be recorded as the stable current release', async () => {
  const currentCatalog = { ...catalog, resources: [{ ...record, hours: 'Newer reviewed hours' }] };
  const currentRelease = { ...release, release: 'bbbbbbbbbbbb', catalogSha256: createHash('sha256').update(JSON.stringify(currentCatalog)).digest('hex') };
  await assert.rejects(verifyCorrectionPublication(report, { fetchImpl: transport([response(currentRelease), response(catalog), response(currentRelease)]) }), error => error.status === 409);
});

for (const catalogSha256 of [undefined, '', 'f'.repeat(63), 'z'.repeat(64), '0'.repeat(64)]) test(`catalog integrity evidence fails closed: ${catalogSha256 || 'missing'}`, async () => {
  const manifest = { ...release, catalogSha256 };
  await assert.rejects(verifyCorrectionPublication(report, { fetchImpl: transport([response(manifest), response(catalog), response(manifest)]) }), error => error.status === 409);
});
test('catalog hash rejects corrupted bytes before parsing JSON', async () => {
  await assert.rejects(verifyCorrectionPublication(report, { fetchImpl: transport([response(release), new Response('{', { headers: { 'content-type': 'application/json' } }), response(release)]) }), error => error.status === 409);
});
test('verification hashes exact streamed UTF-8 bytes, including formatting and trailing newline', async () => {
  const unicodeRecord = { ...record, summary: 'Información revisada' };
  const snapshot = { ...catalog, resources: [unicodeRecord] };
  const bytes = Buffer.from(JSON.stringify(snapshot, null, 2) + '\n');
  const manifest = { ...release, catalogSha256: hash(bytes) };
  const body = new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } });
  assert.deepEqual(await verifyCorrectionPublication({ ...report, appliedRecord: unicodeRecord }, { fetchImpl: transport([response(manifest), new Response(body, { headers: { 'content-type': 'application/json' } }), response(manifest)]) }), { record: unicodeRecord, release: manifest.release });
  await assert.rejects(verifyCorrectionPublication({ ...report, appliedRecord: unicodeRecord }, { fetchImpl: transport([response(manifest), response(snapshot), response(manifest)]) }), error => error.status === 409);
});
test('generated release binds its exact emitted public catalog bytes', async () => {
  const bytes = await readFile('dist/data/resources.json');
  const manifest = JSON.parse(await readFile('dist/data/release.json', 'utf8'));
  assert.equal(manifest.catalogSha256, hash(bytes));
  const snapshot = JSON.parse(bytes.toString('utf8'));
  assert.equal(manifest.resourceCount, snapshot.resources.length);
  const sample = snapshot.resources[0];
  assert.deepEqual(await verifyCorrectionPublication({ status: 'applied', resourceId: sample.id, appliedRecord: sample }, { fetchImpl: transport([response(manifest), new Response(bytes, { headers: { 'content-type': 'application/json' } }), response(manifest)]) }), { record: sample, release: manifest.release });
});
