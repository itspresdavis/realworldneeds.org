import { readFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Deliberately bounded to the reviewed tranche. This prepares candidates only;
// source changes never overwrite the authored published module automatically.
export const clinicSelection = Object.freeze([
  { clues: 'BCIMB001731', id: 'imss-bienestar-tijuana-centro', city: 'Tijuana' },
  { clues: 'BCIMB001755', id: 'imss-bienestar-rosarito-urbano', city: 'Playas de Rosarito' },
]);
const fields = ['clues', 'entidad', 'nomunidad', 'tipo_de_vialidad', 'vialidad', 'numero_exterior', 'tipo_de_asentamiento', 'asentamiento', 'codigo_postal', 'observaciones', 'telefono', 'horario', 'latitud', 'longitud'];
const safe = value => typeof value === 'string' && value.trim() === value && value.length <= 500 && !/[<>\u0000-\u001f\u007f]/.test(value);
export function prepareImssClinicCandidates(rows) {
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 1000) throw new Error('Expected 2–1,000 source rows.');
  return clinicSelection.map(selection => {
    const matches = rows.filter(row => row?.clues === selection.clues);
    if (!matches.length) throw new Error(`Missing reviewed CLUES: ${selection.clues}`);
    const selected = matches.map(row => Object.fromEntries(fields.map(field => {
      if (!safe(row[field])) throw new Error(`Invalid ${field} for ${selection.clues}`);
      return [field, row[field]];
    })));
    if (new Set(selected.map(row => JSON.stringify(row))).size !== 1) throw new Error(`Conflicting source facts for ${selection.clues}`);
    const record = selected[0];
    if (record.entidad !== 'Baja California' || !/^22\d{3}$/.test(record.codigo_postal)) throw new Error(`Unexpected source region for ${selection.clues}`);
    // latitud/longitud are clinic positions. ylat/xlong are postal reference
    // points and are intentionally never read or emitted as site coordinates.
    if (!/^-?\d+(?:\.\d+)?$/.test(record.latitud) || !/^-?\d+(?:\.\d+)?$/.test(record.longitud)
      || Math.abs(Number(record.latitud)) > 90 || Math.abs(Number(record.longitud)) > 180) throw new Error('Invalid clinic coordinates.');
    return { ...selection, status: 'review-required', source: record };
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--input' || args[2] !== '--output' || args[1] === args[3]) throw new Error('Usage: node scripts/review-imss-clinics.mjs --input source.json --output private-candidates.json');
  const content = await readFile(args[1]);
  if (content.length > 1_000_000) throw new Error('Source exceeds 1 MB.');
  const candidates = prepareImssClinicCandidates(JSON.parse(content));
  await writeFile(args[3], JSON.stringify({ schemaVersion: 1, publication: 'manual-reviewed-decision-required', candidates }, null, 2) + '\n', { flag: 'wx' });
  console.log(`Prepared ${candidates.length} unpublished candidates; public source files were not changed.`);
}
