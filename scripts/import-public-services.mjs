import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { titleXRecord, phillyFoodRecord } from '../src/data/public-service-feeds.js';

const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const key = value => clean(value).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]/g, '');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value || '') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function reviewDate(date) {
  if (!validDate(date) || date > new Date().toISOString().slice(0, 10)) throw new Error('Invalid review date.');
}

// Hold every member of an ambiguous group. Never merge contacts, pick a winner
// by array order, delete an existing listing or re-publish a withheld record.
export function holdDuplicateCandidates(records, existing = []) {
  const signatures = record => [
    `${record.category}|${key(record.name.replace(/ — Title X$/, ''))}|${key(record.address)}`,
    ...(record.phone && record.kind === 'direct' ? [`${record.category}|${key(record.address)}|${key(record.phone)}`] : []),
  ];
  const groups = new Map();
  for (const record of records) for (const signature of signatures(record)) {
    const group = groups.get(signature) || [];
    group.push(record.id); groups.set(signature, group);
  }
  const held = new Set([...groups.values()].filter(group => group.length > 1).flat());
  const old = new Set(existing.flatMap(signatures));
  for (const record of records) if (signatures(record).some(signature => old.has(signature))) held.add(record.id);
  return {
    resources: records.filter(record => !held.has(record.id)),
    excluded: records.filter(record => held.has(record.id)).map(record => ({ sourceRecordId: record.sourceRecordId, reason: 'Possible same-service name/address or address/phone duplicate; review before publication.' })),
  };
}

export function prepareTitleX(snapshot, reviewedAt, existing = []) {
  reviewDate(reviewedAt);
  if (!Array.isArray(snapshot?.clinics) || snapshot.offset !== 0 || snapshot.clinics.length !== snapshot.results || snapshot.results < 3000 || snapshot.results > 5000)
    throw new Error('Incomplete or unexpectedly sized Title X snapshot.');
  const ids = new Set(), records = [], excluded = [];
  for (const clinic of [...snapshot.clinics].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    const id = clean(clinic.id);
    if (!uuid.test(id) || ids.has(id)) throw new Error('Missing or duplicate Title X source identity.');
    ids.add(id);
    const { latitude: lat, longitude: lng } = clinic;
    const name = clean(clinic.name), city = clean(clinic.addressPhysicalCity), state = clean(clinic.addressPhysicalState), zip = clean(clinic.addressPhysicalZip);
    const street = [clean(clinic.addressPhysicalStreet1), clean(clinic.addressPhysicalStreet2)].filter(Boolean).join(', ');
    if (!name || !city || !/^[A-Z]{2}$/.test(state) || !/^\d{5}(?:-\d{4})?$/.test(zip) || !street || /\bP\.?\s*O\.?\s*Box\b/i.test(street)) {
      excluded.push({ sourceRecordId: id, reason: 'Incomplete or mailing-only physical destination.' }); continue;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 17 || lat > 72 || lng < -180 || lng > -60) {
      excluded.push({ sourceRecordId: id, reason: 'Missing or out-of-coverage source coordinates.' }); continue;
    }
    records.push(titleXRecord([id, name, street, city, state, zip, lat, lng, clean(clinic.phone)], reviewedAt));
  }
  const dedup = holdDuplicateCandidates(records, existing);
  return { resources: dedup.resources, excluded: [...excluded, ...dedup.excluded], sourceRows: snapshot.results, reviewedAt };
}

const days = [['mon', 'Monday'], ['tues', 'Tuesday'], ['wed', 'Wednesday'], ['thurs', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
export function phillyHours(row) {
  const schedule = [];
  for (const [day, label] of days) {
    const windows = [];
    for (let index = 1; index <= 3; index++) {
      const start = clean(row[`hours_${day}_start${index}`]), end = clean(row[`hours_${day}_end${index}`]);
      if (Boolean(start) !== Boolean(end) || start && (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(start) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(end))) throw new Error('Incomplete or invalid distribution hours.');
      if (start) windows.push(`${start}–${end}`);
    }
    const exception = clean(row[`hours_${day}_exceptions`]);
    if (windows.length || exception) schedule.push(`${label}: ${windows.join(', ')}${exception ? ` (${exception})` : ''}`);
  }
  return schedule.length ? `${schedule.join('; ')}. America/New_York local time; confirm before visiting.` : 'No distribution hours supplied in the city feed. Check the official finder or call before visiting.';
}

export function preparePhillyFood(snapshot, metadata, reviewedAt, existing = []) {
  reviewDate(reviewedAt);
  if (metadata?.name !== 'free_meal_sites' || metadata?.serviceItemId !== '5825a32bb8844bb097f7a16d4fbf4f23' || snapshot?.exceededTransferLimit || !Array.isArray(snapshot?.features) || snapshot.features.length < 200 || snapshot.features.length > 800 || snapshot.spatialReference?.wkid !== 4326)
    throw new Error('Incomplete or unexpected Philadelphia snapshot.');
  const edited = metadata.editingInfo?.dataLastEditDate;
  if (!Number.isFinite(edited)) throw new Error('Missing publisher edit date.');
  const sourceUpdatedAt = new Date(edited).toISOString().slice(0, 10);
  if (sourceUpdatedAt > reviewedAt || Date.parse(reviewedAt) - edited > 90 * 86400000) throw new Error('Stale or future publisher edit date.');
  const ids = new Set(), records = [], excluded = [];
  for (const { attributes: row, geometry } of snapshot.features) {
    const id = row?.objectid;
    if (!Number.isSafeInteger(id) || id < 1 || ids.has(id)) throw new Error('Missing or duplicate Philadelphia source identity.');
    ids.add(id);
    const reason = row.status !== 'Active' ? 'Not active.'
      : clean(row.temporary_closure) || /yes/i.test(row.seasonally_closed || '') ? 'Temporary or seasonal closure.'
      : !['Food Site', 'General Meal Site'].includes(row.category_type) ? 'Benefits-only, senior-specific or seasonal student program needs separate eligibility review.' : '';
    if (reason) { excluded.push({ sourceRecordId: String(id), reason }); continue; }
    const name = clean(row.site_name), address = clean(row.address), zip = String(row.zip_code || '');
    const lat = geometry?.y, lng = geometry?.x;
    if (!name || !address || !/^191\d{2}$/.test(zip) || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < 39.8 || lat > 40.2 || lng < -75.3 || lng > -74.9) {
      excluded.push({ sourceRecordId: String(id), reason: 'Incomplete or out-of-city physical destination.' }); continue;
    }
    let hours;
    try { hours = phillyHours(row); } catch { excluded.push({ sourceRecordId: String(id), reason: 'Malformed schedule; needs provider review.' }); continue; }
    const phone = clean(row.phone_number);
    const eligibility = `Ask the site about intake and distribution requirements.${clean(row.zip_code_exceptions) ? ` The city lists these ZIP codes for access: ${clean(row.zip_code_exceptions)}.` : ' The feed does not provide a complete individual eligibility assessment.'}`;
    records.push(phillyFoodRecord([id, name, address, zip, lat, lng, /^[+\d(][\d\s().+x-]{5,40}$/.test(phone) ? phone : '', row.category_type, hours, eligibility], reviewedAt, sourceUpdatedAt));
  }
  const dedup = holdDuplicateCandidates(records, existing);
  return { resources: dedup.resources, excluded: [...excluded, ...dedup.excluded], sourceRows: snapshot.features.length, reviewedAt, sourceUpdatedAt };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [kind, input, metadataPath, reviewedAt, output] = process.argv.slice(2);
  if (!['title-x', 'philly-food'].includes(kind) || !output) throw new Error('Usage: node scripts/import-public-services.mjs title-x|philly-food SNAPSHOT METADATA YYYY-MM-DD OUTPUT');
  const bytes = await readFile(input), metadataBytes = await readFile(metadataPath);
  const candidate = kind === 'title-x' ? prepareTitleX(JSON.parse(bytes), reviewedAt) : preparePhillyFood(JSON.parse(bytes), JSON.parse(metadataBytes), reviewedAt);
  candidate.provenance = { snapshotSha256: createHash('sha256').update(bytes).digest('hex'), metadataSha256: createHash('sha256').update(metadataBytes).digest('hex') };
  await writeFile(output, JSON.stringify(candidate, null, 2) + '\n', { flag: 'wx' });
  console.log(`Prepared ${candidate.resources.length} candidates; held ${candidate.excluded.length}. No database change.`);
}
