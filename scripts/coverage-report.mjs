import { pathToFileURL } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { resources } from '../src/data/resources.js';

const normalize = value => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
export const priorityCommunities = Object.freeze([
  { id: 'boston-ma', city: 'Boston', region: 'Massachusetts', country: 'United States', aliases: ['Boston'] },
  { id: 'brockton-ma', city: 'Brockton', region: 'Massachusetts', country: 'United States', aliases: ['Brockton'] },
  { id: 'taunton-ma', city: 'Taunton', region: 'Massachusetts', country: 'United States', aliases: ['Taunton'] },
  { id: 'providence-ri', city: 'Providence', region: 'Rhode Island', country: 'United States', aliases: ['Providence'] },
  { id: 'rosarito-bc', city: 'Playas de Rosarito', region: 'Baja California', country: 'Mexico', aliases: ['Rosarito', 'Playas de Rosarito'] },
  { id: 'tijuana-bc', city: 'Tijuana', region: 'Baja California', country: 'Mexico', aliases: ['Tijuana'] },
]);
const needs = {
  meals: record => /\b(meals?|breakfast|lunch|dinner|soup kitchen|comedor|desayuno)\b/i.test([record.accessType, ...(record.services || [])].join(' ')),
  groceries: record => /\b(grocer\w*|pantr\w*|food parcels?|food packages?|despensas?)\b/i.test([record.accessType, ...(record.services || [])].join(' ')),
  shelter: record => [record.category, ...(record.secondaryCategories || [])].includes('shelter'),
  hygiene: record => [record.category, ...(record.secondaryCategories || [])].includes('hygiene'),
  clothingDiapers: record => [record.category, ...(record.secondaryCategories || [])].includes('clothing'),
  health: record => [record.category, ...(record.secondaryCategories || [])].includes('health'),
};

export function physicalSiteKeys(record) {
  if (record.kind !== 'direct' || ['contact-only', 'coverage', 'confidential'].includes(record.locationPrecision)) return [];
  const routes = record.serviceAccess;
  const addresses = Array.isArray(routes)
    ? routes.filter(route => ['walk-in', 'intake'].includes(route.mode)).map(route => route.address)
    : [record.address];
  return [...new Set(addresses.filter(nonempty).map(address => `${normalize(record.country)}|${normalize(address)}`))];
}

export function summarizeCoverage(records) {
  const direct = records.filter(record => record.kind === 'direct');
  return {
    listings: records.length,
    directRecords: direct.length,
    uniquePhysicalAddresses: new Set(records.flatMap(physicalSiteKeys)).size,
    referralOrNetworkRecords: records.filter(record => record.kind === 'locator' || record.kind === 'network').length,
    addressOnlyDirectRecords: direct.filter(record => record.locationPrecision === 'address').length,
    directWithoutStructuredHours: direct.filter(record => !nonempty(record.hours)).length,
    directWithServiceSchedules: direct.filter(record => record.serviceAccess?.some(route => route.schedule?.weekly?.length)).length,
    directWithoutStructuredEligibility: direct.filter(record => !nonempty(record.eligibility) && !record.serviceAccess?.some(route => nonempty(route.eligibility))).length,
    bySource: Object.fromEntries([...records.reduce((map, record) => {
      const key = record.datasetId || record.sourceName || 'Unknown source';
      map.set(key, (map.get(key) || 0) + 1);
      return map;
    }, new Map())].sort(([a], [b]) => a.localeCompare(b))),
  };
}

export function createCoverageReport(records, { asOf = new Date().toISOString().slice(0, 10) } = {}) {
  if (!Array.isArray(records)) throw new Error('Records must be an array.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf) || !Number.isFinite(Date.parse(asOf)) || new Date(asOf).toISOString().slice(0, 10) !== asOf) throw new Error('asOf must be a real date.');
  const communities = priorityCommunities.map(place => {
    const local = records.filter(record => normalize(record.country) === normalize(place.country) && place.aliases.some(alias => normalize(alias) === normalize(record.city)));
    const matrix = Object.fromEntries(Object.entries(needs).map(([need, matches]) => {
      const matching = local.filter(matches);
      const sites = matching.filter(record => record.kind === 'direct');
      return [need, {
        directRecordIds: sites.map(record => record.id).sort(),
        uniquePhysicalAddresses: new Set(sites.flatMap(physicalSiteKeys)).size,
        localReferralIds: matching.filter(record => record.kind !== 'direct').map(record => record.id).sort(),
        gap: sites.length === 0 ? 'No published direct service in this snapshot; this is not evidence that no service exists.' : null,
      }];
    }));
    return { ...place, ...summarizeCoverage(local), matrix };
  });
  return {
    schemaVersion: 1, asOf,
    methodology: 'Published static snapshot only. City aliases are exact and country-qualified; national finders do not count as local physical coverage. Categories describe sourced services, not current capacity. Meal/pantry subsets use explicit service/access text, not a general food tag. Unique physical addresses are normalized source-backed addresses, not people helped or service counts. Different entrances written differently may require manual deduplication.',
    staticSnapshot: summarizeCoverage(records),
    dynamicFeeds: { includedInCounts: false, note: 'The location-triggered USDA seasonal meal feed is queried separately; no live or historical USDA count is added to this snapshot.' },
    communities,
    priorityReview: records.filter(record => record.kind === 'direct' && ['shelter', 'food', 'hygiene'].some(category => [record.category, ...(record.secondaryCategories || [])].includes(category)))
      .map(record => ({ id: record.id, reasons: [...(!nonempty(record.hours) && !record.serviceAccess?.some(route => route.schedule?.weekly?.length) ? ['hours-not-structured'] : []), ...(!nonempty(record.eligibility) && !record.serviceAccess?.some(route => nonempty(route.eligibility)) ? ['eligibility-not-structured'] : [])], lastBroadReview: record.lastChecked, latestScopedReview: record.serviceAccess?.map(route => route.reviewedAt).filter(Boolean).sort().at(-1) || null }))
      .filter(item => item.reasons.length).sort((a, b) => b.reasons.length - a.reasons.length || String(a.lastBroadReview).localeCompare(String(b.lastBroadReview)) || a.id.localeCompare(b.id)),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length % 2 || args.some((arg, i) => i % 2 === 0 && !['--date', '--output'].includes(arg))) throw new Error('Usage: node scripts/coverage-report.mjs [--date YYYY-MM-DD] [--output file]');
  const options = Object.fromEntries(Array.from({ length: args.length / 2 }, (_, i) => [args[i * 2], args[i * 2 + 1]]));
  const result = JSON.stringify(createCoverageReport(resources, { asOf: options['--date'] }), null, 2) + '\n';
  if (options['--output']) await writeFile(options['--output'], result); else process.stdout.write(result);
}
