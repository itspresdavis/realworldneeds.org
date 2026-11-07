import test from 'node:test';
import assert from 'node:assert/strict';
import { createCoverageReport, physicalSiteKeys, summarizeCoverage } from '../scripts/coverage-report.mjs';
const direct = { id: 'site', name: 'Fixture', country: 'United States', city: 'Boston', kind: 'direct', category: 'food', services: ['Meals'], address: '1 Main Street, Boston, MA 02108', lastChecked: '2026-10-01' };

test('multiple services at one address count once, separate verified sites count separately', () => {
  const record = { ...direct, serviceAccess: [{ mode: 'walk-in', address: direct.address }, { mode: 'intake', address: direct.address }, { mode: 'intake', address: '2 Main Street, Boston, MA 02108' }, { mode: 'confidential' }] };
  assert.equal(physicalSiteKeys(record).length, 2);
  assert.equal(summarizeCoverage([record, { ...record, id: 'other-service' }]).uniquePhysicalAddresses, 2);
  assert.equal(summarizeCoverage([record]).directRecords, 1);
});

test('coverage markers, contact-only resources, and national finders cannot inflate physical counts', () => {
  for (const kind of ['locator', 'network']) assert.deepEqual(physicalSiteKeys({ ...direct, kind }), []);
  const report = createCoverageReport([direct, { ...direct, id: 'national', city: 'United States', kind: 'locator' }, { ...direct, id: 'uk', country: 'United Kingdom' }], { asOf: '2026-11-07' });
  const boston = report.communities.find(place => place.id === 'boston-ma');
  assert.equal(boston.directRecords, 1);
  assert.deepEqual(boston.matrix.meals.directRecordIds, ['site']);
  assert.equal(report.dynamicFeeds.includedInCounts, false);
});

test('food benefits do not become meals or groceries merely through category tags', () => {
  const benefit = { ...direct, id: 'wic', services: ['Nutrition education', 'WIC food benefits'], accessType: 'Eligibility appointment' };
  const boston = createCoverageReport([benefit], { asOf: '2026-11-07' }).communities[0];
  assert.equal(boston.matrix.meals.directRecordIds.length, 0);
  assert.equal(boston.matrix.groceries.directRecordIds.length, 0);
  assert.match(boston.matrix.meals.gap, /not evidence/);
});

test('field-level review does not refresh the broad review and reporting never mutates records', () => {
  const record = { ...direct, serviceAccess: [{ reviewedAt: '2026-11-07', mode: 'walk-in', address: direct.address, eligibility: 'Adults', schedule: { weekly: [{ days: [1], opens: '09:00', closes: '10:00' }] } }] };
  const before = JSON.stringify(record);
  const report = createCoverageReport([record], { asOf: '2026-11-07' });
  assert.equal(report.staticSnapshot.directWithServiceSchedules, 1);
  assert.equal(report.staticSnapshot.directWithoutStructuredEligibility, 0);
  assert.equal(JSON.stringify(record), before);
  assert.equal(record.lastChecked, '2026-10-01');
  assert.deepEqual(report, createCoverageReport([record], { asOf: '2026-11-07' }));
});

test('address-only direct sites are counted without creating coordinates', () => {
  const record = { ...direct, locationPrecision: 'address', lat: null, lng: null };
  assert.equal(summarizeCoverage([record]).addressOnlyDirectRecords, 1);
  assert.equal(physicalSiteKeys(record).length, 1);
  assert.equal(record.lat, null);
});

test('reject impossible report dates', () => assert.throws(() => createCoverageReport([], { asOf: '2026-02-30' }), /real date/));
