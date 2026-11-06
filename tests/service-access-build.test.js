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
