import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fingerprint } from './catalog-sync-core.mjs';

// An explicit insert-only batch. Never use an upsert to replace reviewed facts,
// restore withheld records, or silently hide a source-identity collision.
export function prepareCatalogImport(records) {
  if (!Array.isArray(records) || !records.length || records.length > 500) throw new Error('Use 1–500 reviewed records per batch.');
  const ids = new Set(), sourceKeys = new Set();
  for (const record of records) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(record.id || '') || record.id.length > 160 || ids.has(record.id)) throw new Error('Invalid or duplicate RWN identity.');
    ids.add(record.id);
    if (!['free', 'free-eligible', 'free-option', 'free-navigation'].includes(record.costModel)) throw new Error('A reviewed free-access model is required.');
    if (Object.hasOwn(record, 'datasetId') || Object.hasOwn(record, 'sourceRecordId')) {
      for (const field of ['datasetId', 'sourceRecordId']) if (typeof record[field] !== 'string' || !record[field] || record[field] !== record[field].trim() || record[field].length > 160) throw new Error('Invalid source identity.');
      const key = JSON.stringify([record.datasetId, record.sourceRecordId]);
      if (sourceKeys.has(key)) throw new Error('Duplicate source identity.');
      sourceKeys.add(key);
    }
  }
  const hash = fingerprint(records), json = JSON.stringify(records);
  if (Buffer.byteLength(json) > 1_500_000) throw new Error('Batch exceeds the reviewed import size limit.');
  let delimiter = '$rwn_import$';
  while (json.includes(delimiter)) delimiter = delimiter.slice(0, -1) + '_$';
  return `-- Reviewed insert-only catalog batch: ${records.length} records; SHA-256 ${hash}
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
set local standard_conforming_strings = on;
lock table public.rwn_locations in share row exclusive mode;
do ${delimiter}
declare candidates jsonb := '${json.replaceAll("'", "''")}'::jsonb;
begin
  if exists (
    select 1 from jsonb_array_elements(candidates) c
    join public.rwn_locations r on r.id=c->>'id'
    where r.record is distinct from c or not r.published
  ) then raise exception 'Import conflicts with existing editorial facts or withholding; reconcile manually'; end if;
  insert into public.rwn_locations(id, record, published)
    select c->>'id', c, true from jsonb_array_elements(candidates) c
    where not exists (select 1 from public.rwn_locations r where r.id=c->>'id');
end ${delimiter};
commit;
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output] = process.argv.slice(2);
  if (!input || !output) throw new Error('Usage: node scripts/prepare-catalog-import.mjs REVIEWED_RECORDS.json INSERT_ONLY.sql');
  const records = JSON.parse(await readFile(input, 'utf8'));
  await writeFile(output, prepareCatalogImport(records), { flag: 'wx' });
  console.log(`Prepared ${records.length} records. No database change was made.`);
}
