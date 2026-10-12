import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resources,curatedResources} from '../src/data/resources.js';
import {withheldLocationIds} from '../src/data/generated/editorial-overrides.js';
const review=JSON.parse(await readFile(new URL('../docs/catalog-reviews/2026-10-12-provider-corrections.json',import.meta.url)));

test('scoped provider corrections match their reviewed fields and keep original review, cost and coordinate evidence',()=>{
  assert.equal(review.changes.length,8);
  for(const change of review.changes){
    const record=resources.find(r=>r.id===change.id);
    if(change.action==='reversible-withhold'){
      assert.equal(record,undefined);
      assert.ok(withheldLocationIds.includes(change.id));
      const original=curatedResources.find(r=>r.id===change.id);
      assert.ok(original,'Original source record remains recoverable');
      for(const [key,value] of Object.entries(change.preserved)) assert.deepEqual(original[key],value);
      continue;
    }
    assert.ok(record);
    for(const [key,field] of Object.entries(change.fields)) assert.deepEqual(record[key],field.after,`${change.id}.${key}`);
    for(const [key,value] of Object.entries(change.preserved)) assert.deepEqual(record[key],value,`${change.id}.${key} preserved`);
    assert.match(record.sourceDetail,/original broader review date/i);
    assert.ok(change.sources.every(url=>new URL(url).protocol==='https:'));
  }
});

test('contact and schedule corrections preserve material access limits',()=>{
  const byId=new Map(resources.map(r=>[r.id,r]));
  assert.equal(byId.get('boston-night-center').phone,'857-296-0322');
  assert.equal(byId.get('capuchin-day-centre').address,'29 Bow Street, Dublin 7, D07 HP7Y');
  assert.match(byId.get('doctors-of-the-world-uk-advice-line').availabilityNote,/undergoing work.*clinic@doctorsoftheworld\.org\.uk/);
  assert.match(byId.get('doctors-of-the-world-uk-advice-line').eligibility,/non-clinical/);
  assert.match(byId.get('healthdirect-australia').availabilityNote,/Mobile call charges may apply/);
  assert.match(byId.get('healthdirect-australia').sourceDetail,/September 2023/);
  assert.match(byId.get('whitechapel-mission').hours,/Weekend breakfast availability is unclear.*shower hours and booking instructions differ/);
  assert.match(byId.get('whitechapel-mission').availabilityNote,/conflicting.*appointment/);
  assert.match(byId.get('third-space-brisbane').eligibility,/catchment.*appointment.*Centrelink/);
});
