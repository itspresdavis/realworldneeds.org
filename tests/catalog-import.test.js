import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareCatalogImport } from '../scripts/prepare-catalog-import.mjs';

const record = extra => ({ id: 'fixture', costModel: 'free', ...extra });
test('insert preparation rejects duplicate identities and malformed batches', () => {
  for (const batch of [[], [record(), record()], [record({ costModel: 'paid' })],
    [record({ datasetId: 'provider' })],
    [record({ datasetId: 'provider', sourceRecordId: '1' }), record({ id: 'other', datasetId: 'provider', sourceRecordId: '1' })],
  ]) assert.throws(() => prepareCatalogImport(batch));
});
test('insert SQL preserves text literally and refuses editorial/withholding changes', () => {
  const sql = prepareCatalogImport([record({ summary: "St. Mary's $rwn_import$ \\ path" })]);
  assert.match(sql, /St\. Mary''s \$rwn_import\$ \\\\ path/);
  assert.match(sql, /do \$rwn_import_\$/);
  assert.match(sql, /r\.record is distinct from c or not r\.published/);
  assert.match(sql, /lock table public\.rwn_locations in share row exclusive mode/);
  assert.doesNotMatch(sql, /on conflict.*update|delete from|truncate/i);
});
