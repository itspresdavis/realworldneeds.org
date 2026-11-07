import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Bowery keeps meal directions separate from shelter intake on generated public surfaces', async () => {
  for (const path of ['dist/service/bowery-mission/index.html', 'dist/directory/index.html']) {
    const html = await readFile(path, 'utf8');
    const content = path.includes('/service/') ? html : html.match(/<article[^>]*id="bowery-mission"[\s\S]*?<\/article>/)?.[0];
    assert.ok(content, path);
    assert.match(content, /Directions to meal service/);
    assert.match(content, /Shelter intake details/);
    assert.match(content, /90 Lafayette/);
    assert.match(content, /Varies by service; see access details/);
    assert.match(content, /<li><strong>Shelter intake<\/strong>/);
    assert.doesNotMatch(content, /(?:destination|query|ll|daddr)=40\.7219/);
  }
});

test('search, CSV and structured data retain service-specific access and stable identity', async () => {
  const index = JSON.parse(await readFile('dist/data/search-index.json', 'utf8'));
  const record = index.records.find(row => row.id === 'bowery-mission');
  assert.ok(record.serviceActions.some(action => action.label === 'Shelter intake details' && action.href === 'https://www.bowery.org/get-help/'));
  assert.match(record.serviceAccessSummary, /90 Lafayette/);
  const csv = await readFile('dist/directory.csv', 'utf8');
  assert.match(csv.split('\n').find(line => line.startsWith('"bowery-mission"')), /Shelter intake.*90 Lafayette/);
  assert.match(csv.split('\n').find(line => line.startsWith('"bowery-mission"')), /"United States","",""/, 'multi-site export must not associate every service with one coordinate');
  const html = await readFile('dist/service/bowery-mission/index.html', 'utf8');
  const graphs = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));
  const channels = graphs.flatMap(graph => graph['@graph'] || [graph]).find(item => item['@id']?.endsWith('#service'))?.availableChannel;
  assert.ok(Array.isArray(channels));
  assert.ok(channels.some(channel => channel.name === 'Shelter intake' && channel.serviceLocation.address.includes('90 Lafayette')));
});

function parseCsv(source) {
  const rows = []; let row = [], value = '', quoted = false;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') { value += '"'; index++; } else quoted = !quoted;
    } else if (!quoted && (character === ',' || character === '\n')) {
      row.push(value); value = '';
      if (character === '\n') { rows.push(row); row = []; }
    } else if (character !== '\r' || quoted) value += character;
  }
  if (value || row.length) { row.push(value); rows.push(row); }
  assert.equal(quoted, false, 'CSV quotation must be complete');
  return rows;
}

test('CSV round trips complete service schedules, field evidence and distinct route identities', async () => {
  const [header, ...rows] = parseCsv(await readFile('dist/directory.csv', 'utf8'));
  const column = header.indexOf('Service access contract (JSON)');
  assert.ok(column >= 0, 'machine-readable route provenance must not be reduced to a prose summary');
  const sources = JSON.parse(await readFile('dist/data/resources.json', 'utf8')).resources;
  for (const id of ['bowery-mission', 'beacon-houston', 'amos-house-providence-meals', 'taunton-community-table-meals']) {
    const record = sources.find(resource => resource.id === id);
    assert.ok(record?.serviceAccess, id);
    const row = rows.find(values => values[0] === id);
    assert.equal(row.length, header.length, `${id}: quoted route JSON cannot shift export columns`);
    const contract = JSON.parse(row[column]);
    assert.deepEqual(contract, record.serviceAccess, `${id}: all addresses, hours, source timestamps and review scopes survive`);
    assert.equal(new Set(contract.map(route => route.id)).size, contract.length);
  }
  const beacon = JSON.parse(rows.find(values => values[0] === 'beacon-houston')[column]);
  assert.equal(beacon.find(route => route.id === 'breakfast').schedule.timeZone, 'America/Chicago');
  assert.match(beacon.find(route => route.id === 'breakfast').fieldEvidence.schedule.scope, /no live capacity confirmation/);
  assert.equal(beacon.find(route => route.id === 'showers-laundry').schedule, undefined, 'unknown end times never become a guessed structured schedule');
});
