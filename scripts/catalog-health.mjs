import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resources } from '../src/data/resources.js';
import { validateResourceLocation } from '../src/utils/resource-location.js';
import { createReviewQueue } from '../src/utils/review-schedule.js';

const text = value => String(value || '').trim();
const normalized = value => text(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const countBy = (records, key) => Object.fromEntries([...records.reduce((counts, record) => {
  const value = key(record) || '(missing)';
  counts.set(value, (counts.get(value) || 0) + 1);
  return counts;
}, new Map())].sort(([a], [b]) => a.localeCompare(b)));
const day = value => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value ? time : null;
};
export function validPublicSourceUrl(value) {
  try {
    const url = new URL(value);
    return text(value) === value && url.protocol === 'https:' && !url.username && !url.password
      && url.hostname.includes('.') && !/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(url.hostname)
      && !url.hostname.endsWith('.local') && !url.hostname.startsWith('[');
  } catch { return false; }
}

function duplicates(records, key, reason) {
  const groups = new Map();
  for (const record of records) {
    const value = key(record);
    if (!value) continue;
    const group = groups.get(value) || [];
    group.push(record.id);
    groups.set(value, group);
  }
  return [...groups.values()].filter(ids => ids.length > 1).map(ids => ({ reason, ids }));
}

// Broad sanity bounds flag records for human review; they cannot verify an
// address, service availability, overseas coverage, or border precision.
const bounds = {
  'United Kingdom': [-9, 2.5, 49, 61.5],
  'United States': [-180, 180, 17, 72],
  Australia: [112, 155, -45, -9],
  Canada: [-142, -52, 41, 84],
  Ireland: [-11, -5, 51, 56],
  France: [-5.5, 10, 41, 52],
  Germany: [5, 16, 47, 56],
};
const continents = { 'United Kingdom': 'Europe', 'United States': 'North America', Canada: 'North America', Australia: 'Oceania', Ireland: 'Europe', France: 'Europe', Germany: 'Europe' };
export function createCatalogHealth(records, { asOf = new Date().toISOString().slice(0, 10), source = 'src/data/resources.js', reviewPolicy = {} } = {}) {
  if (!Array.isArray(records)) throw new Error('Catalog resources must be an array.');
  const today = day(asOf);
  if (today === null) throw new Error('asOf must be a real YYYY-MM-DD date.');
  const issues = [], ages = [], reviewNeeded = [];
  for (const record of records) {
    const id = record.id || '(missing id)';
    if (!text(record.id)) issues.push({ id, code: 'missing-id' });
    const error = validateResourceLocation(record);
    if (error) issues.push({ id, code: 'invalid-location', detail: error });
    if (!validPublicSourceUrl(record.sourceUrl)) issues.push({ id, code: 'invalid-source-url' });
    const checked = day(record.lastChecked);
    if (checked === null) issues.push({ id, code: 'invalid-review-date', value: record.lastChecked || null });
    else if (checked > today) issues.push({ id, code: 'future-review-date', value: record.lastChecked });
    else ages.push({ id, days: (today - checked) / 86_400_000, lastChecked: record.lastChecked });
    for (const field of ['validFrom', 'validThrough', 'sourceUpdatedAt']) {
      if (record[field] && day(record[field]) === null) issues.push({ id, code: 'invalid-date', field, value: record[field] });
    }
    if (record.validFrom && record.validThrough && record.validFrom > record.validThrough) issues.push({ id, code: 'reversed-active-period' });
    const box = bounds[record.country];
    if (record.kind === 'direct' && box && Number.isFinite(record.lat) && Number.isFinite(record.lng)
      && (record.lng < box[0] || record.lng > box[1] || record.lat < box[2] || record.lat > box[3])) reviewNeeded.push({ id, reason: 'outside-broad-country-bounds' });
    if (continents[record.country] && record.region !== continents[record.country]) reviewNeeded.push({ id, reason: 'country-region-mismatch', region: record.region });
    if (!text(record.eligibility)) reviewNeeded.push({ id, reason: 'no-structured-eligibility', note: 'Restrictions may exist in availability/access text; human review required.' });
  }
  const duplicateIds = duplicates(records, r => r.id, 'duplicate-id');
  const duplicateCandidates = [
    ...duplicates(records, r => r.name && r.address ? [r.name, r.country, r.address].map(normalized).join('|') : '', 'same-name-country-address'),
    ...duplicates(records, r => r.datasetId && r.sourceRecordId ? `${r.datasetId}:${r.sourceRecordId}` : '', 'same-dataset-record'),
  ];
  const categoryMembership = records.flatMap(r => [...new Set([r.category, ...(r.secondaryCategories || [])])].map(category => ({ category })));
  const olderThan = threshold => ages.filter(entry => entry.days > threshold).length;
  return {
    schemaVersion: 2, asOf, source,
    methodology: 'Operational evidence only. Review dates are read unchanged, never refreshed by this audit. Freshness is elapsed UTC calendar days. Duplicate and location candidates require human review; a reachable source is not verification of its services.',
    totals: {
      listings: records.length, byCountry: countBy(records, r => r.country), primaryCategory: countBy(records, r => r.category),
      categoryMembership: countBy(categoryMembership, r => r.category), listingType: countBy(records, r => r.kind),
      locationPrecision: countBy(records, r => r.locationPrecision || (r.kind === 'direct' ? 'exact (implicit)' : 'coverage (implicit)')),
    },
    freshness: {
      validReviewDates: ages.length, olderThan30Days: olderThan(30), olderThan60Days: olderThan(60), olderThan90Days: olderThan(90),
      oldestReviewDate: ages.length ? ages.reduce((a, b) => a.days > b.days ? a : b).lastChecked : null,
      oldestRecords: ages.filter(entry => entry.days > 90).sort((a, b) => b.days - a.days || a.id.localeCompare(b.id)),
    },
    contact: {
      withoutPhone: records.filter(r => !text(r.phone)).map(r => r.id),
      withoutDirectContact: records.filter(r => !text(r.phone) && !text(r.accessUrl) && !text(r.email)).map(r => r.id),
      withoutSourceOrContact: records.filter(r => !text(r.phone) && !text(r.accessUrl) && !text(r.email) && !validPublicSourceUrl(r.sourceUrl)).map(r => r.id),
      note: 'The official source link is a fallback, not proof that a phone, email, or walk-in service is available.',
    },
    structural: { passed: !issues.length && !duplicateIds.length, issues, duplicateIds },
    reviewNeeded, duplicateCandidates,
    reviewQueue: createReviewQueue(records, { asOf, policy: reviewPolicy }),
    uniqueSourceUrls: [...new Set(records.map(r => r.sourceUrl).filter(validPublicSourceUrl))].length,
    links: { status: 'not-checked', note: 'URL syntax only. Use --check-links for a bounded reachability sample; it never changes review dates.' },
  };
}

// Read-only source sampling is deliberately bounded, optional, and explicit.
// 404/410 are broken-link evidence; blocked, rate-limited, and timed-out URLs
// remain unknown. It is not a provider or factual verification procedure.
export async function sampleSourceLinks(records, { limit = 40, concurrency = 4, fetchImpl = fetch } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Link limit must be 1–200.');
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('Link concurrency must be 1–4.');
  const unique = [...new Set(records.map(r => r.sourceUrl).filter(validPublicSourceUrl))];
  const selected = unique.slice(0, limit), results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, async () => {
    while (next < selected.length) {
      const url = selected[next++];
      let current = url, result;
      try {
        for (let redirects = 0; redirects <= 5; redirects++) {
          if (!validPublicSourceUrl(current)) throw new Error('Non-public or unsupported redirect target');
          let response = await fetchImpl(current, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(10_000) });
          if (response.status === 405) {
            response = await fetchImpl(current, { method: 'GET', headers: { Range: 'bytes=0-0' }, redirect: 'manual', signal: AbortSignal.timeout(10_000) });
            await response.body?.cancel();
          }
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            if (!location) throw new Error('Redirect has no location');
            current = new URL(location, current).href;
            continue;
          }
          result = { url, finalUrl: current, status: response.status, outcome: response.status >= 200 && response.status < 300 ? 'reachable' : [404, 410].includes(response.status) ? 'broken' : 'unknown' };
          break;
        }
        if (!result) result = { url, outcome: 'unknown', reason: 'redirect-limit' };
      } catch (error) { result = { url, outcome: 'unknown', reason: error.name === 'TimeoutError' ? 'timeout' : 'network-or-redirect-error' }; }
      results.push(result);
    }
  }));
  return { status: 'sampled', selection: 'First unique source URLs in catalog order; not random or exhaustive.', uniqueSourceUrls: unique.length, checked: results.length, unchecked: unique.length - results.length, results: results.sort((a, b) => a.url.localeCompare(b.url)) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2), value = flag => args[args.indexOf(flag) + 1];
  const known = new Set(['--input', '--output', '--date', '--source', '--limit', '--check-links', '--review-policy']);
  for (let i = 0; i < args.length; i++) {
    if (!known.has(args[i])) throw new Error(`Unknown option: ${args[i]}`);
    if (args[i] !== '--check-links') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value: ${args[i]}`);
      i++;
    }
  }
  const payload = args.includes('--input') ? JSON.parse(await readFile(value('--input'), 'utf8')) : resources;
  const records = Array.isArray(payload) ? payload : payload.resources;
  const reviewPolicy = args.includes('--review-policy') ? JSON.parse(await readFile(value('--review-policy'), 'utf8')) : {};
  const report = createCatalogHealth(records, { asOf: args.includes('--date') ? value('--date') : undefined, source: args.includes('--source') ? value('--source') : args.includes('--input') ? value('--input') : undefined, reviewPolicy });
  if (args.includes('--check-links')) {
    report.links = await sampleSourceLinks(records, { limit: args.includes('--limit') ? Number(value('--limit')) : 40 });
    report.reviewQueue = createReviewQueue(records, { asOf: report.asOf, policy: reviewPolicy, sourceHealth: report.links.results });
  }
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.includes('--output')) await writeFile(value('--output'), json);
  else process.stdout.write(json);
  if (!report.structural.passed) process.exitCode = 1;
}
