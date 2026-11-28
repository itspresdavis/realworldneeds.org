import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { MAX_PUBLISHED_CATALOG_BYTES } from '../server/catalog-limits.js';
import { verifyCorrectionPublication } from '../server/correction-publication.js';

const record = { id: 'limit-fixture', summary: 'Reviewed fixture' };
const report = { status: 'applied', resourceId: record.id, appliedRecord: record };
const snapshot = JSON.stringify({ resources: [record], resourceCount: 1 });

for (const declaredLength of [undefined, '1024', '16000000']) {
  test(`catalog at existing 16 MB build budget verifies (Content-Length: ${declaredLength})`, async () => {
    // JSON whitespace changes byte size without inventing records or service facts.
    const bytes = Buffer.alloc(16_000_000, ' ');
    bytes.write(snapshot);
    assert.equal(MAX_PUBLISHED_CATALOG_BYTES, bytes.length);
    const manifest = {
      release: 'abcdef012345', resourceCount: 1,
      catalogSha256: createHash('sha256').update(bytes).digest('hex'),
    };
    const headers = { 'content-type': 'application/json' };
    if (declaredLength !== undefined) headers['content-length'] = declaredLength;
    const replies = [Response.json(manifest), new Response(bytes, { headers }), Response.json(manifest)];
    const result = await verifyCorrectionPublication(report, { fetchImpl: async () => replies.shift() });
    assert.deepEqual(result, { record, release: manifest.release });
    assert.equal(replies.length, 0);
  });
}

for (const mode of ['declared', 'streamed', 'understated header']) {
  test(`catalog over 16 MB is cancelled and rejected: ${mode}`, async () => {
    let cancelled = false;
    let pulls = 0;
    let requests = 0;
    const body = new ReadableStream({
      pull(controller) {
        pulls += 1;
        controller.enqueue(new Uint8Array(pulls === 1 ? 16_000_000 : 1));
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    const headers = { 'content-type': 'application/json' };
    if (mode === 'declared') headers['content-length'] = '16000001';
    if (mode === 'understated header') headers['content-length'] = '1';
    const fetchImpl = async () => {
      requests += 1;
      if (requests === 1) return Response.json({ release: 'abcdef012345' });
      assert.equal(requests, 2, 'must stop before reading the second manifest');
      return new Response(body, { headers });
    };
    await assert.rejects(verifyCorrectionPublication(report, { fetchImpl }), error => error.status === 503);
    assert.equal(requests, 2);
    assert.equal(cancelled, true);
    assert.equal(pulls, mode === 'declared' ? 0 : 2);
  });
}
