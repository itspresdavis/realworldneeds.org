import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCorrectionPublication } from '../server/correction-publication.js';
import { validateCorrectionAction } from '../server/corrections.js';
const record = { id: 'fixture-only', hours: 'Mondays, 9–12', summary: 'Verified fixture' };
const report = { resourceId: record.id, status: 'applied', appliedRecord: record };
const release = { release: 'abcdef012345', resourceCount: 1 };
const catalog = { resources: [record], resourceCount: 1 };
const response = data => Response.json(data);
function transport(replies, calls = []) { return async (url, options) => { calls.push({ url, options }); return replies.shift(); }; }
test('release verification matches the complete reviewed record and stable manifest at a fixed origin', async () => {
  const calls = [];
  assert.deepEqual(await verifyCorrectionPublication(report, { fetchImpl: transport([response(release), response(catalog), response(release)], calls) }), { record, release: release.release });
  assert.deepEqual(calls.map(call => call.url), ['https://www.realworldneeds.org/data/release.json', 'https://www.realworldneeds.org/data/resources.json', 'https://www.realworldneeds.org/data/release.json']);
  assert.ok(calls.every(({ options }) => options.credentials === 'omit' && options.redirect === 'error' && options.cache === 'no-store' && !options.headers.Authorization));
});
for (const [name, manifest, snapshot, after] of [
  ['old public facts', release, { ...catalog, resources: [{ ...record, hours: 'Old schedule' }] }, release],
  ['removed listing', { ...release, resourceCount: 0 }, { resources: [], resourceCount: 0 }, { ...release, resourceCount: 0 }],
  ['changing release', release, catalog, { ...release, release: 'abcdef012346' }],
  ['duplicate listing', { ...release, resourceCount: 2 }, { resources: [record, record], resourceCount: 2 }, { ...release, resourceCount: 2 }],
  ['incomplete count', release, { ...catalog, resourceCount: 2 }, release],
]) test(`unresolved publication: ${name}`, async () => {
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
