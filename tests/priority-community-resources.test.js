import test from 'node:test';
import assert from 'node:assert/strict';
import { resources } from '../src/data/resources.js';
import { priorityCommunityResources } from '../src/data/priority-community-resources.js';
import { createCoverageReport } from '../scripts/coverage-report.mjs';

const find = id => resources.find(record => record.id === id);

test('reviewed priority additions are actual address-only meal sites, not coverage centroids or food benefits', () => {
  assert.equal(priorityCommunityResources.length, 2);
  for (const record of priorityCommunityResources) {
    assert.equal(record.kind, 'direct');
    assert.equal(record.locationPrecision, 'address');
    assert.equal(record.lat, null);
    assert.equal(record.lng, null);
    assert.equal(record.costModel, 'free');
    assert.match(record.costNote, /free/i);
    assert.equal(record.serviceAccess.every(route => route.address === record.address), true);
    assert.equal(find(record.id).id, record.id);
  }
});

test('Amos monthly Saturday exception never becomes an unconditional weekly opening', () => {
  const record = find('amos-house-providence-meals');
  const route = record.serviceAccess[0];
  assert.match(record.hours, /first Saturday/);
  assert.equal(route.schedule.complete, false);
  assert.equal(route.schedule.weekly.some(interval => interval.days.includes(6)), false);
  assert.match(route.schedule.text, /first Saturday/);
  assert.match(route.eligibility, /No identification or proof/);
});

test('Taunton keeps weekday pickup, monthly dinner, and mailing address distinctions', () => {
  const record = find('taunton-community-table-meals');
  const lunch = record.serviceAccess.find(route => route.id === 'weekday-lunch');
  const dinner = record.serviceAccess.find(route => route.id === 'monthly-dinner');
  assert.deepEqual(lunch.schedule.weekly[0].days, [1, 2, 3, 4]);
  assert.match(lunch.instructions, /12:15–12:30/);
  assert.match(dinner.instructions, /Last Thursday of each month only/);
  assert.equal(dinner.schedule, undefined);
  assert.match(lunch.entrance, /annex/);
  assert.doesNotMatch(lunch.address, /PO Box/);
});

test('Beacon uses Caroline entrance and separate meal times while unknown hygiene hours remain unknown', () => {
  const beacon = find('beacon-houston');
  assert.equal(beacon.lastChecked, '2026-08-04');
  assert.match(beacon.serviceAccess.find(route => route.id === 'breakfast').entrance, /Caroline/);
  assert.equal(beacon.serviceAccess.find(route => route.id === 'breakfast').schedule.weekly[0].opens, '07:00');
  assert.equal(beacon.serviceAccess.find(route => route.id === 'lunch').schedule.weekly[0].closes, '12:00');
  assert.equal(beacon.serviceAccess.find(route => route.id === 'showers-laundry').schedule, undefined);
  assert.match(beacon.serviceAccess.find(route => route.id === 'housing-assessment').intake, /first 25/);
  assert.equal(beacon.serviceAccess.find(route => route.id === 'housing-assessment').intakeCutoff, undefined);
});

test('Bowery retains identity and separate destinations without inventing meal end times or refreshing broad review', () => {
  const bowery = find('bowery-mission');
  assert.equal(bowery.lastChecked, '2026-08-04');
  assert.equal(bowery.serviceAccess.find(route => route.id === 'meals').address, '227 Bowery, New York, NY 10002');
  assert.equal(bowery.serviceAccess.find(route => route.id === 'shelter').address, '90 Lafayette Street, New York, NY 10013');
  assert.equal(bowery.serviceAccess.find(route => route.id === 'meals').schedule, undefined);
  assert.match(bowery.serviceAccess.find(route => route.id === 'meals').eligibility, /no ID required/);
  assert.equal(bowery.serviceAccess.find(route => route.id === 'medical').schedule.timeZone, 'America/New_York');
});

test('actual priority coverage reports new meals without counting UK Taunton or national finders as local sites', () => {
  const report = createCoverageReport(resources, { asOf: '2026-11-07' });
  assert.deepEqual(report.communities.find(place => place.id === 'taunton-ma').matrix.meals.directRecordIds, ['taunton-community-table-meals']);
  assert.deepEqual(report.communities.find(place => place.id === 'providence-ri').matrix.meals.directRecordIds, ['amos-house-providence-meals']);
  assert.equal(report.communities.find(place => place.id === 'rosarito-bc').directRecords, 0);
  assert.equal(report.dynamicFeeds.includedInCounts, false);
});
