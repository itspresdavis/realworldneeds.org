import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareTitleX, preparePhillyFood, phillyHours, holdDuplicateCandidates } from '../scripts/import-public-services.mjs';
import { titleXResources } from '../src/data/generated/title-x.js';
import { phillyFoodResources } from '../src/data/generated/philly-food.js';
import { validateResourceLocation } from '../src/utils/resource-location.js';
import { sourceRegistry } from '../src/data/live-sources.js';

test('Title X membership carries the conditional no-cost route, original physical facts and no invented hours', () => {
  assert.equal(titleXResources.length, 3591);
  assert.equal(new Set(titleXResources.map(r => r.sourceRecordId)).size, titleXResources.length);
  for (const record of titleXResources) {
    assert.equal(record.costModel, 'free-eligible');
    assert.match(record.costNote, /at or below 100%/);
    assert.match(record.availabilityNote, /other care and outside referrals may involve costs/i);
    assert.match(record.hours, /not included/);
    assert.equal(validateResourceLocation(record), null);
    assert.deepEqual(record.services, ['Title X family-planning services']);
    assert.equal(record.sourceUpdatedAt, undefined);
  }
  assert.ok(new Set(titleXResources.map(r => r.administrativeArea)).size >= 50);
});

test('Philadelphia preserves exceptions and does not turn schedule gaps into all-day availability', () => {
  assert.equal(phillyFoodResources.length, 255);
  assert.match(phillyHours({ hours_mon_start1: '11:00', hours_mon_end1: '13:20', hours_mon_exceptions: 'First and third Mondays only' }), /First and third Mondays only/);
  assert.match(phillyHours({}), /No distribution hours supplied/);
  assert.throws(() => phillyHours({ hours_mon_start1: '11:00' }));
  assert.throws(() => phillyHours({ hours_mon_start1: '25:00', hours_mon_end1: '27:00' }));
  for (const record of phillyFoodResources) {
    assert.equal(validateResourceLocation(record), null);
    assert.equal(record.costModel, 'free-eligible');
    assert.match(record.availabilityNote, /not a promise the site is open now/);
  }
});

test('source adapters reject partial, stale and wrong-dataset responses', () => {
  assert.throws(() => prepareTitleX({ clinics: [], results: 3743, offset: 0 }, '2026-11-25'));
  assert.throws(() => prepareTitleX({ clinics: [], results: 0, offset: 10 }, '2026-11-25'));
  assert.throws(() => preparePhillyFood({ features: [], exceededTransferLimit: true }, {}, '2026-11-25'));
  assert.throws(() => preparePhillyFood({ features: [] }, { name: 'other' }, '2026-11-25'));
});

test('duplicate review holds all ambiguous new candidates and respects existing records', () => {
  const base = { category: 'health', kind: 'direct', name: 'Clinic', address: '100 Main St, Boston, MA', phone: '617-555-0100' };
  const a = { ...base, id: 'a', sourceRecordId: 'a' }, b = { ...base, id: 'b', sourceRecordId: 'b', name: 'Different program name' };
  assert.equal(holdDuplicateCandidates([a, b]).resources.length, 0);
  assert.equal(holdDuplicateCandidates([a], [b]).resources.length, 0);
  assert.equal(holdDuplicateCandidates([a, { ...b, category: 'food' }]).resources.length, 2);
  assert.equal(a.name, 'Clinic');
});

test('feed manifests reconcile the shipped snapshots and excluded records', () => {
  for (const [id, resources] of [['hhs-title-x-clinics', titleXResources], ['philadelphia-free-food', phillyFoodResources]]) {
    const source = sourceRegistry.find(s => s.id === id);
    assert.equal(source.recordCount, resources.length);
    assert.equal(source.recordCount + source.excludedForPublicationAtAudit, source.sourceParsedRecordsAtAudit);
    assert.ok(source.reuseBasis && source.accessStandard);
  }
});
