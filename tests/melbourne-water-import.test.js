import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { prepareMelbourneWater } from '../scripts/import-melbourne-water.mjs';
import { melbourneWaterResources } from '../src/data/generated/melbourne-water.js';
import { novemberExpansionResources } from '../src/data/november-expansion.js';
import { resources } from '../src/data/resources.js';
import { validateResourceLocation } from '../src/utils/resource-location.js';
import { validateServiceAccess } from '../src/utils/service-access.js';

const fixture = () => ({
  rows: Array.from({ length: 250 }, (_, i) => ({ assetid: String(10000 + i), type: 'Drinking Fountain',
    subtype: 'Drinking Fountain', ownership: 'Owned', locationdescription: `${i} Example Street, Melbourne`,
    roadsegmentdescription: 'Example Street', geo_point_2d: { lat: -37.81, lon: 144.96 } })),
  metadata: { dataset_id: 'drinking-fountains', metas: { default: { records_count: 250,
    license_url: 'https://creativecommons.org/licenses/by/4.0/legalcode', data_processed: '2026-11-04T16:02:37Z' } } },
});
const prepare = ({ rows, metadata }) => prepareMelbourneWater(rows, metadata, '2026-11-25');
test('water import excludes dog bowls, uncertain ownership and reviewed duplicate candidates', () => {
  const data = fixture();
  data.rows[0].subtype = 'Dog Bowl'; data.rows[1].ownership = 'Not Owned'; data.rows[2].assetid = '1360540';
  const before = structuredClone(data), result = prepare(data);
  assert.deepEqual(data, before);
  assert.equal(result.resources.length, 247); assert.equal(result.excluded.length, 3);
  assert.deepEqual(prepare({ ...data, rows: [...data.rows].reverse() }), result);
  assert.equal(result.resources[0].sourceUpdatedAt, '2026-11-04');
  assert.match(result.resources[0].availabilityNote, /not live water flow/);
});
test('water import fails closed on incomplete snapshots, duplicate IDs, changed licences and invalid points', () => {
  for (const mutate of [
    d => d.rows.pop(), d => d.rows[1].assetid = d.rows[0].assetid,
    d => d.metadata.metas.default.license_url = 'https://example.org/private',
    d => d.metadata.metas.default.data_processed = '2022-01-01',
    d => d.rows[0].geo_point_2d.lat = null, d => d.rows[0].geo_point_2d.lon = 0,
    d => d.rows[0].subtype = 'Decorative fountain', d => d.rows[0].locationdescription = '',
    d => d.rows[0].evaluationdate = '2026-02-30',
  ]) { const data = fixture(); mutate(data); assert.throws(() => prepare(data)); }
});
test('reviewed expansion preserves source identities and honest physical access contracts', () => {
  assert.equal(melbourneWaterResources.length, 280);
  assert.equal(novemberExpansionResources.length, 14);
  const ids = new Set(resources.map(r => r.id));
  for (const r of [...melbourneWaterResources, ...novemberExpansionResources]) {
    assert.ok(ids.has(r.id)); assert.equal(validateResourceLocation(r), null);
    assert.equal(validateServiceAccess(r), null);
  }
  for (const id of ['1360540', '1479845', '1636388']) assert.ok(!ids.has(`melbourne-water-${id}`));
  for (const r of novemberExpansionResources.filter(r => r.id.startsWith('nyc-youth-'))) {
    assert.ok(!r.secondaryCategories.includes('shelter'));
    assert.match(r.availabilityNote, /not a promise of an overnight bed/);
  }
  const ri = novemberExpansionResources.find(r => r.id === 'rhode-island-free-clinic');
  assert.match(ri.availabilityNote, /waitlist/);
});

test('redistributed CSV retains city attribution, licence and adaptation notice', async () => {
  const csv = await readFile('dist/directory.csv', 'utf8');
  assert.match(csv.split('\n')[0], /Source owner.*Source attribution and reuse notes.*Source updated/);
  const row = csv.split('\n').find(line => line.includes('melbourne-water-1075229'));
  assert.match(row, /City of Melbourne/);
  assert.match(row, /creativecommons\.org\/licenses\/by\/4\.0\/legalcode/);
  assert.match(row, /RWN selects human drinking-water assets and writes access summaries/);
});
