import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { melbourneWaterRecord, MELBOURNE_SOURCE, MELBOURNE_LICENSE as LICENSE } from '../src/data/melbourne-water.js';
// Conservative exclusions, not a claim that distinct city asset IDs are identical.
const REVIEW_HOLDS = new Map([
  ['1360540', 'Possible duplicate of 1075236: same destination, positions 0.3 m apart; hold for provider review.'],
  ['1479845', 'Possible duplicate of 1075230: positions 2.6 m apart; hold for provider review.'],
]);
const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

// Offline transformation only: no builds or refreshes silently change membership,
// existing editorial facts, publication status, or database records.
export function prepareMelbourneWater(rows, metadata, reviewedAt) {
  if (!day(reviewedAt) || reviewedAt > new Date().toISOString().slice(0, 10)) throw new Error('Invalid review date.');
  const meta = metadata?.metas?.default;
  if (metadata?.dataset_id !== 'drinking-fountains' || meta?.license_url !== LICENSE)
    throw new Error('Unexpected dataset identity or reuse licence.');
  if (!Array.isArray(rows) || rows.length < 250 || rows.length > 600 || rows.length !== meta.records_count)
    throw new Error('Incomplete or unexpectedly sized source snapshot.');
  const processedAt = meta.data_processed?.slice(0, 10);
  if (!day(processedAt) || processedAt > reviewedAt || Date.parse(reviewedAt) - Date.parse(processedAt) > 90 * 86400000)
    throw new Error('Missing, future or stale publisher processing date.');
  const ids = new Set(), resources = [], excluded = [];
  for (const row of [...rows].sort((a, b) => String(a.assetid).localeCompare(String(b.assetid)))) {
    const id = clean(row.assetid);
    if (!/^\d{1,12}$/.test(id) || ids.has(id)) throw new Error('Missing or duplicate source asset identity.');
    ids.add(id);
    if (row.type !== 'Drinking Fountain' || !['Drinking Fountain', 'Bottle Refill Tap', 'Dog Bowl'].includes(row.subtype))
      throw new Error(`Unknown water asset type: ${id}`);
    let reason = row.subtype === 'Dog Bowl' ? 'Dog bowl; not a human drinking-water service.'
      : row.ownership !== 'Owned' ? 'City ownership not established.' : REVIEW_HOLDS.get(id);
    if (reason) { excluded.push({ sourceRecordId: id, reason }); continue; }
    const address = clean(row.locationdescription), lat = row.geo_point_2d?.lat, lng = row.geo_point_2d?.lon;
    if (!address || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -37.86 || lat > -37.77 || lng < 144.89 || lng > 145.01)
      throw new Error(`Unusable location: ${id}`);
    if (row.evaluationdate && (!day(row.evaluationdate) || row.evaluationdate > reviewedAt)) throw new Error(`Invalid asset evaluation date: ${id}`);
    const place = clean(row.propertyname) || clean(row.roadsegmentdescription) || address;
    const refill = row.subtype === 'Bottle Refill Tap';
    resources.push(melbourneWaterRecord([id, place, address, lat, lng, refill, row.evaluationdate], reviewedAt, processedAt));
  }
  return { resources, excluded, sourceRows: rows.length, reviewedAt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [snapshot, metadata, reviewedAt, output] = process.argv.slice(2);
  if (!snapshot || !metadata || !reviewedAt || !output) throw new Error('Usage: node scripts/import-melbourne-water.mjs SNAPSHOT.json METADATA.json YYYY-MM-DD CANDIDATE.json');
  const bytes = await readFile(snapshot), metadataBytes = await readFile(metadata);
  const candidate = prepareMelbourneWater(JSON.parse(bytes), JSON.parse(metadataBytes), reviewedAt);
  candidate.provenance = { sourceUrl: MELBOURNE_SOURCE, licenseUrl: LICENSE,
    snapshotSha256: createHash('sha256').update(bytes).digest('hex'),
    metadataSha256: createHash('sha256').update(metadataBytes).digest('hex') };
  // Never overwrite a prior review receipt or the published generated module.
  await writeFile(output, JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx' });
  console.log(`Prepared ${candidate.resources.length} candidates; excluded ${candidate.excluded.length}. No catalog or database was changed.`);
}
