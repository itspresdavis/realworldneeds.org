import assert from 'node:assert/strict';
import test from 'node:test';
import { createCatalogHealth, sampleSourceLinks, validPublicSourceUrl } from '../scripts/catalog-health.mjs';
const fixture = (fields = {}) => ({ id: 'fixture', name: 'Fixture provider', city: 'Boston', country: 'United States', region: 'North America', kind: 'direct', lat: 42.36, lng: -71.06, address: '1 Main Street', category: 'food', secondaryCategories: ['referral'], lastChecked: '2026-08-04', sourceUrl: 'https://example.org/help', ...fields });
const report = records => createCatalogHealth(records, { asOf: '2026-11-05', source: 'isolated fixtures' });

test('health reports preserve review evidence and count primary and secondary coverage separately', () => {
  const records = [fixture(), fixture({ id: 'second', name: 'Second provider', category: 'hygiene', phone: '123', lastChecked: '2026-11-05' })];
  const before = structuredClone(records), r = report(records);
  assert.deepEqual(records, before);
  assert.equal(r.structural.passed, true);
  assert.deepEqual(r.totals.primaryCategory, { food: 1, hygiene: 1 });
  assert.deepEqual(r.totals.categoryMembership, { food: 1, hygiene: 1, referral: 2 });
  assert.equal(r.freshness.olderThan90Days, 1);
  assert.equal(r.freshness.oldestRecords[0].days, 93);
  assert.deepEqual(r.contact.withoutDirectContact, ['fixture']);
  assert.deepEqual(r.contact.withoutSourceOrContact, []);
  assert.equal(r.links.status, 'not-checked');
  assert.equal(r.reviewQueue.policyStatus, 'proposed');
  assert.deepEqual(r.reviewQueue.candidates.map(candidate => candidate.resourceId), ['fixture']);
  assert.equal(r.reviewQueue.candidates[0].nextReviewDue, '2026-09-03');
});

test('health review planning accepts explicit cadence configuration without altering evidence', () => {
  const r = createCatalogHealth([fixture({ category: 'shelter', lastChecked: '2026-10-20' })], {
    asOf: '2026-11-05', reviewPolicy: { intervals: { shelter: 7 } },
  });
  assert.equal(r.reviewQueue.candidates[0].nextReviewDue, '2026-10-27');
  assert.equal(r.reviewQueue.candidates[0].evidence.reviewedAt, null);
});

test('impossible, absent and future dates are reported rather than normalized into verification', () => {
  const records = ['2026-02-30', '', '2026-11-06'].map((lastChecked, i) => fixture({ id: String(i), lastChecked }));
  const r = report(records);
  assert.equal(r.structural.passed, false);
  assert.equal(r.freshness.validReviewDates, 0);
  assert.deepEqual(r.structural.issues.map(issue => issue.code), ['invalid-review-date', 'invalid-review-date', 'future-review-date']);
  assert.throws(() => createCatalogHealth([], { asOf: '2026-02-30' }), /real/);
  assert.equal(createCatalogHealth([fixture({ lastChecked: '2024-02-29' })], { asOf: '2024-03-01' }).freshness.validReviewDates, 1);
});

test('structural errors and human review candidates remain distinct', () => {
  const r = report([fixture(), fixture({ lat: 95 }), fixture({ id: 'same-provider' }), fixture({ id: 'wrong-continent', region: 'Europe', lat: -40 })]);
  assert.equal(r.structural.passed, false);
  assert.equal(r.structural.duplicateIds.length, 1);
  assert.ok(r.structural.issues.some(issue => issue.code === 'invalid-location'));
  assert.ok(r.duplicateCandidates.some(group => group.reason === 'same-name-country-address'));
  assert.ok(r.reviewNeeded.some(issue => issue.reason === 'outside-broad-country-bounds'));
  assert.ok(r.reviewNeeded.some(issue => issue.reason === 'country-region-mismatch'));
});

test('source URL validation rejects malformed, credentialed and obvious private targets', () => {
  for (const url of ['http://example.org', 'javascript:alert(1)', 'https://user:secret@example.org', 'https://127.0.0.1', 'https://10.0.0.1', 'https://172.16.0.1', 'https://192.168.1.2', 'https://localhost', 'https://server.local', 'https://[::1]', ' https://example.org']) assert.equal(validPublicSourceUrl(url), false, url);
  assert.equal(validPublicSourceUrl('https://example.org/help?q=1'), true);
});

test('bounded source sampling distinguishes broken links from blocking and transport uncertainty', async () => {
  const codes = [200, 404, 410, 403, 429, 503];
  const records = codes.map(code => fixture({ sourceUrl: `https://example.org/${code}` }));
  let active = 0, peak = 0;
  const links = await sampleSourceLinks(records, { limit: 5, concurrency: 2, fetchImpl: async url => {
    active++; peak = Math.max(active, peak);
    await Promise.resolve(); active--;
    return { status: Number(url.split('/').at(-1)), headers: new Headers() };
  } });
  assert.equal(links.checked, 5);
  assert.equal(links.unchecked, 1);
  assert.ok(peak <= 2);
  assert.deepEqual(links.results.map(result => result.outcome), ['reachable', 'unknown', 'broken', 'broken', 'unknown']);
  assert.equal(records[0].lastChecked, '2026-08-04');
});

test('sampling handles method restrictions, cancels response bodies and refuses private redirect targets', async () => {
  let cancelled = 0;
  const calls = [];
  const links = await sampleSourceLinks([fixture()], { fetchImpl: async (url, options) => {
    calls.push([url, options.method]);
    return options.method === 'HEAD' ? { status: 405 } : { status: 200, body: { cancel: async () => { cancelled++; } } };
  } });
  assert.equal(links.results[0].outcome, 'reachable');
  assert.deepEqual(calls.map(call => call[1]), ['HEAD', 'GET']);
  assert.equal(cancelled, 1);
  let redirects = 0;
  const rejected = await sampleSourceLinks([fixture()], { fetchImpl: async () => { redirects++; return { status: 302, headers: new Headers({ location: 'https://127.0.0.1/private' }) }; } });
  assert.equal(redirects, 1);
  assert.equal(rejected.results[0].outcome, 'unknown');
  await assert.rejects(sampleSourceLinks([], { limit: 201 }), /1–200/);
});
