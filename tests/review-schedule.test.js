import assert from 'node:assert/strict';
import test from 'node:test';
import { reviewSchedule, createReviewQueue, reviewPolicy } from '../src/utils/review-schedule.js';

const asOf = '2026-11-06';
const record = (fields = {}) => ({ id: 'service', category: 'food', lastChecked: '2026-10-01', sourceUrl: 'https://example.org/help', ...fields });

test('proposed schedules prioritize shelter access and distinguish stable official datasets', () => {
  assert.equal(reviewSchedule(record({ secondaryCategories: ['shelter'] }), { asOf }).intervalDays, 14);
  assert.equal(reviewSchedule(record(), { asOf }).intervalDays, 30);
  assert.equal(reviewSchedule(record({ freshnessRisk: 'stable-official-dataset' }), { asOf }).intervalDays, 90);
  assert.equal(reviewSchedule(record({ freshnessRisk: 'stable-official-dataset', category: 'shelter' }), { asOf }).intervalDays, 14);
  assert.equal(reviewSchedule(record({ datasetId: 'unknown-feed' }), { asOf }).intervalDays, 30);
  assert.equal(reviewSchedule(record(), { asOf }).policyStatus, 'proposed');
});

test('fetch and publication dates never advance substantive review, provider confirmation or legacy dates', () => {
  const r = record({ reviewEvidence: { sourcePublishedAt: '2026-11-04', sourceFetchedAt: '2026-11-06', reviewedAt: '2026-09-01', verificationMethod: 'official-source-review', evidenceReference: 'review-123' } });
  const before = structuredClone(r);
  const result = reviewSchedule(r, { asOf });
  assert.equal(result.nextReviewDue, '2026-10-01');
  assert.equal(result.daysOverdue, 36);
  assert.equal(result.evidence.providerConfirmedAt, null);
  assert.equal(result.evidence.sourceFetchedAt, '2026-11-06');
  assert.deepEqual(r, before);
  const legacy = reviewSchedule(record({ sourceUpdatedAt: '2026-11-05' }), { asOf });
  assert.equal(legacy.evidence.reviewedAt, null);
  assert.equal(legacy.evidence.legacySourceCheckedAt, '2026-10-01');
  assert.equal(legacy.anchorKind, 'legacy-source-check');
});

test('cadences are configurable and validated without implying an approved staffing commitment', () => {
  const policy = reviewPolicy({ intervals: { shelter: 7, changingAccess: 21 } });
  assert.equal(reviewSchedule(record({ category: 'shelter' }), { asOf, policy }).nextReviewDue, '2026-10-08');
  for (const invalid of [0, -1, 1.5, 366, '14']) assert.throws(() => reviewPolicy({ intervals: { shelter: invalid } }), /integer/);
  assert.throws(() => reviewPolicy({ intervals: { typo: 5 } }), /Unknown/);
  assert.throws(() => reviewPolicy({ status: 'approved' }), /Unknown/);
});

test('invalid and future review evidence needs review and does not fall back to a misleading recent date', () => {
  for (const reviewedAt of ['2026-02-30', '2027-01-01', '']) {
    const result = reviewSchedule(record({ reviewEvidence: { reviewedAt } }), { asOf });
    assert.equal(result.state, 'unknown');
    assert.equal(result.nextReviewDue, null);
    assert.equal(result.evidence.reviewedAt, null);
  }
  assert.throws(() => reviewSchedule(record(), { asOf: '2026-02-30' }), /real/);
  assert.equal(reviewSchedule(record({ lastChecked: '2024-02-29' }), { asOf: '2024-03-30' }).state, 'due');
});

test('queue is deterministic, actionable, unassigned and never changes publication state', () => {
  const records = [record({ id: 'food' }), record({ id: 'shelter', category: 'shelter', published: false }), record({ id: 'current', lastChecked: asOf })];
  const before = structuredClone(records);
  const queue = createReviewQueue(records, { asOf });
  assert.deepEqual(queue.candidates.map(c => c.resourceId), ['shelter', 'food']);
  assert.equal(queue.candidates[0].publicationStatus, 'withheld');
  assert.equal(queue.candidates[0].assignedTo, null);
  assert.equal(queue.candidates[0].evidence.sourceUrl, 'https://example.org/help');
  assert.match(queue.candidates[0].requiredDecision, /source-backed/);
  assert.deepEqual(queue, createReviewQueue([...records].reverse(), { asOf }));
  assert.deepEqual(records, before);
});

test('expired seasons and source changes create candidates even before scheduled reviews', () => {
  const records = [record({ id: 'expired', lastChecked: asOf, validThrough: '2026-11-05' }), record({ id: 'changed', lastChecked: asOf, sourceUrl: 'https://example.org/changed' })];
  const queue = createReviewQueue(records, { asOf, sourceHealth: [{ url: 'https://example.org/changed', outcome: 'reachable', finalUrl: 'https://example.org/new' }] });
  assert.deepEqual(queue.candidates.find(c => c.resourceId === 'expired').reasons, ['expired-season']);
  assert.deepEqual(queue.candidates.find(c => c.resourceId === 'changed').reasons, ['source-redirected']);
  assert.equal(queue.candidates.find(c => c.resourceId === 'changed').evidence.providerConfirmedAt, null);
});
