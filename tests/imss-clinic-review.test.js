import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareImssClinicCandidates } from '../scripts/review-imss-clinics.mjs';
import { imssBienestarResources } from '../src/data/imss-bienestar-resources.js';
import { validateResourceLocation } from '../src/utils/resource-location.js';
import { physicalSiteKeys } from '../scripts/coverage-report.mjs';
const row = (clues, fields = {}) => ({ clues, entidad: 'Baja California', nomunidad: 'Fixture', tipo_de_vialidad: 'CALLE', vialidad: 'PUBLICA', numero_exterior: '1', tipo_de_asentamiento: 'COLONIA', asentamiento: 'CENTRO', codigo_postal: '22000', observaciones: '', telefono: '6642381264', horario: '07:00-20:00', latitud: '32.527386', longitud: '-117.03782', d_codigo: '22000', ylat: '1.2', xlong: '2.3', ...fields });
const rows = () => [row('BCIMB001731'), row('BCIMB001755')];

test('bounded CLUES review deduplicates postal matches without using their coordinates', () => {
  const input = [...rows(), row('BCIMB001731', { d_codigo: '22001', ylat: '89', xlong: '179' })];
  const before = JSON.stringify(input);
  const candidates = prepareImssClinicCandidates(input);
  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].source.latitud, '32.527386');
  assert.equal(candidates[0].source.longitud, '-117.03782');
  assert.equal(candidates[0].source.ylat, undefined);
  assert.equal(candidates[0].status, 'review-required');
  assert.deepEqual(prepareImssClinicCandidates(input), candidates);
  assert.equal(JSON.stringify(input), before);
});

test('changed source facts are candidates, not silent publication; conflicts and missing rows fail closed', () => {
  const changed = rows(); changed[0].horario = '08:00-16:00';
  assert.equal(prepareImssClinicCandidates(changed)[0].source.horario, '08:00-16:00');
  assert.equal(prepareImssClinicCandidates(changed)[0].status, 'review-required');
  assert.match(imssBienestarResources[0].hours, /07:00–20:00/);
  assert.throws(() => prepareImssClinicCandidates([...rows(), row('BCIMB001731', { telefono: 'changed' })]), /Conflicting/);
  assert.throws(() => prepareImssClinicCandidates([row('BCIMB001731'), row('other')]), /Missing/);
  assert.throws(() => prepareImssClinicCandidates([row('BCIMB001731', { latitud: '95' }), row('BCIMB001755')]), /coordinates/);
  assert.throws(() => prepareImssClinicCandidates([row('BCIMB001731', { vialidad: '<script>alert(1)</script>' }), row('BCIMB001755')]), /Invalid/);
});

test('Baja clinics preserve source identity, free-care eligibility, partial hours and exact clinic coordinates', () => {
  for (const clinic of imssBienestarResources.filter(record => record.kind === 'direct')) {
    assert.equal(validateResourceLocation(clinic), null);
    assert.equal(clinic.costModel, 'free-eligible');
    assert.match(clinic.costNote, /without social security coverage/);
    assert.match(clinic.hours, /days of operation are not supplied/);
    assert.equal(clinic.serviceAccess[0].schedule, undefined);
    assert.equal(clinic.serviceAccess[0].contacts[0].url, 'https://registro.imssbienestar.gob.mx/');
    assert.match(clinic.sourceRecordId, /^BCIMB\d{6}$/);
  }
  assert.equal(imssBienestarResources[0].lat, 32.527386);
  assert.notEqual(imssBienestarResources[0].lat, 32.53109302);
});

test('the national official health finder has no walk-in address or physical-site count', () => {
  const finder = imssBienestarResources.find(record => record.kind === 'locator');
  assert.equal(validateResourceLocation(finder), null);
  assert.deepEqual(physicalSiteKeys(finder), []);
  assert.equal(finder.lat, null);
  assert.equal(finder.lng, null);
  assert.match(finder.coverageNote, /Baja California/);
  assert.doesNotMatch(finder.address, /Gustavo|Campa/);
});
