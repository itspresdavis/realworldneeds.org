// Planning proposals, not approved service guarantees or staffing commitments.
// This module is pure: fetching, building and calculating a due date never edit
// source evidence, publication state, or provider confirmation.
const DAY = 86_400_000;
const defaults = Object.freeze({ shelter: 14, changingAccess: 30, stableOfficialDataset: 90, other: 30 });
const date = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
};
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null;

export function reviewPolicy(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('Review policy must be an object.');
  for (const key of Object.keys(overrides)) if (key !== 'intervals') throw new Error(`Unknown policy field: ${key}`);
  const input = overrides.intervals ?? {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Review intervals must be an object.');
  const intervals = { ...defaults };
  for (const [key, days] of Object.entries(input)) {
    if (!Object.hasOwn(defaults, key)) throw new Error(`Unknown review interval: ${key}`);
    if (!Number.isInteger(days) || days < 1 || days > 365) throw new Error('Review interval must be an integer from 1 to 365 days.');
    intervals[key] = days;
  }
  return { intervals };
}

export function reviewSchedule(record, { asOf = new Date().toISOString().slice(0, 10), policy = {} } = {}) {
  const today = date(asOf);
  if (today === null) throw new Error('asOf must be a real YYYY-MM-DD date.');
  const { intervals } = reviewPolicy(policy);
  const categories = [record.category, ...(record.secondaryCategories || [])];
  const risk = categories.includes('shelter') ? 'shelter'
    : record.freshnessRisk === 'stable-official-dataset' ? 'stableOfficialDataset'
      : categories.some(category => ['food', 'hygiene', 'water'].includes(category)) ? 'changingAccess' : 'other';
  const input = record.reviewEvidence || {};
  const pastDate = value => date(value) !== null && date(value) <= today ? value : null;
  const evidence = {
    sourceUrl: text(record.sourceUrl),
    sourcePublishedAt: pastDate(input.sourcePublishedAt ?? record.sourceUpdatedAt),
    sourceFetchedAt: pastDate(input.sourceFetchedAt),
    reviewedAt: pastDate(input.reviewedAt),
    providerConfirmedAt: pastDate(input.providerConfirmedAt),
    legacySourceCheckedAt: pastDate(record.lastChecked),
    verificationMethod: text(input.verificationMethod),
    evidenceReference: text(input.evidenceReference),
  };
  // Legacy checks may be source retrieval dates. Retain that uncertainty instead
  // of relabeling them as substantive reviews or provider verification.
  const hasExplicitReview = Object.hasOwn(input, 'reviewedAt');
  const anchor = hasExplicitReview ? evidence.reviewedAt : evidence.legacySourceCheckedAt;
  const anchorKind = hasExplicitReview ? 'substantive-review' : 'legacy-source-check';
  let due = anchor ? date(anchor) + intervals[risk] * DAY : null;
  // An editor's earlier due date may accelerate review; it never lengthens the
  // risk interval. Invalid evidence cannot be repaired by a declared due date.
  const declaredDue = date(input.nextReviewDue);
  if (due !== null && declaredDue !== null) due = Math.min(due, declaredDue);
  const daysOverdue = due === null ? null : Math.max(0, (today - due) / DAY);
  return {
    policyStatus: 'proposed', risk, intervalDays: intervals[risk], anchorKind,
    nextReviewDue: due === null ? null : new Date(due).toISOString().slice(0, 10),
    state: due === null ? 'unknown' : due < today ? 'overdue' : due === today ? 'due' : 'current',
    daysOverdue, evidence,
    note: 'Proposed review cadence pending operations approval. Age alone does not establish closure or change publication status.',
  };
}

export function createReviewQueue(records, { asOf = new Date().toISOString().slice(0, 10), policy = {}, sourceHealth = [] } = {}) {
  const validatedPolicy = reviewPolicy(policy);
  // Validate the date even for an empty catalog.
  if (date(asOf) === null) throw new Error('asOf must be a real YYYY-MM-DD date.');
  const health = new Map(sourceHealth.map(result => [result.url, result]));
  const candidates = [];
  for (const record of records) {
    const schedule = reviewSchedule(record, { asOf, policy: validatedPolicy });
    const reasons = [];
    if (schedule.state !== 'current') reasons.push(schedule.state === 'unknown' ? 'review-evidence-missing' : 'scheduled-review');
    if (date(record.validThrough) !== null && record.validThrough < asOf) reasons.push('expired-season');
    const source = health.get(record.sourceUrl);
    if (source?.outcome === 'broken') reasons.push('broken-source');
    if (source?.finalUrl && source.finalUrl !== source.url) reasons.push('source-redirected');
    if (source?.contentChanged === true) reasons.push('source-content-changed');
    if (!reasons.length) continue;
    candidates.push({
      resourceId: record.id,
      risk: schedule.risk,
      priority: reasons.some(reason => ['broken-source', 'expired-season'].includes(reason)) || schedule.risk === 'shelter' ? 'high' : 'normal',
      reasons,
      nextReviewDue: schedule.nextReviewDue,
      daysOverdue: schedule.daysOverdue,
      evidence: schedule.evidence,
      anchorKind: schedule.anchorKind,
      publicationStatus: record.published === false ? 'withheld' : text(record.publicationStatus) || 'published-snapshot',
      assignedTo: null,
      decision: 'pending-review',
      requiredDecision: 'Record a source-backed decision, evidence reference and reason in the existing editorial review/history workflow before publishing a change.',
    });
  }
  candidates.sort((a, b) => (a.priority === 'high' ? 0 : 1) - (b.priority === 'high' ? 0 : 1)
    || (b.daysOverdue ?? Infinity) - (a.daysOverdue ?? Infinity) || String(a.resourceId).localeCompare(String(b.resourceId)));
  return {
    policyStatus: 'proposed', policy: validatedPolicy, asOf,
    note: 'Unassigned planning candidates, not a staffed queue or publication decision. HTTP success is not provider verification. Preserve reviewed evidence and use the publication gate.',
    candidates,
  };
}
