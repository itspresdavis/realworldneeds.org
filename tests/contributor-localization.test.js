import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, stat } from 'node:fs/promises';
import { translateContributorText, contributorCopy } from '../public/contributor-copy.js';

test('account and reviewer states expose reviewed Spanish copy with truthful service-unavailable semantics', () => {
  assert.equal(translateContributorText('Account services are temporarily unavailable. Please try again. The public directory is still available.', 'es'), 'Los servicios de cuenta no están disponibles temporalmente. Inténtalo de nuevo. El directorio público sigue disponible.');
  assert.equal(translateContributorText('Another editor changed this listing. Reopen it before saving.', 'es'), 'Otro editor cambió esta ficha. Vuelve a abrirla antes de guardar.');
  assert.equal(translateContributorText('Check your inbox for the next step. Open the link in this browser.', 'es'), 'Consulta tu correo para el siguiente paso. Abre el enlace en este navegador.');
  assert.equal(translateContributorText('Page 2 of 51', 'es'), 'Página 2 de 51');
  assert.equal(translateContributorText('1 listing in the database.', 'es'), '1 ficha en la base de datos.');
  assert.match(translateContributorText('Proposed next review: 2026-11-07 (due; 14-day shelter access cadence).', 'es'), /vence hoy; cada 14 días/);
});
test('contributor copy leaves arbitrary provider text and private values unchanged', () => {
  for (const value of ['Atención solo a mujeres', 'Example Provider, Boston', '<script>alert(1)</script>', 'mi contraseña privada', '']) assert.equal(translateContributorText(value, 'es'), value);
  assert.equal(translateContributorText('Save review note', 'en'), 'Save review note');
  for (const [en, es] of contributorCopy) { assert.ok(en && es); assert.equal(typeof es, 'string'); }
});
test('account-only localization stays bounded and contains no transport or persistent private-data API', async () => {
  const source = await readFile('public/contributor-localization.js', 'utf8');
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|sendBeacon|indexedDB|sessionStorage|localStorage/);
  assert.ok((await stat('public/contributor-copy.js')).size < 22_000);
  assert.ok(Buffer.byteLength(source) < 5_500);
});
