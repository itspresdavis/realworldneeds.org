import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resources } from '../src/data/resources.js';
import { resourceSearchScore, resourceSearchText, createIndexedSearchMatcher, searchGeographyChoices, querySearchTokens, normalizeSearch } from '../src/utils/search.js';
import { geographyChoices, renderGeographyHint } from '../public/directory-geography.js';

const cases = JSON.parse(await readFile(new URL('./fixtures/search-safety-cases.json', import.meta.url)));
const compact = r => ({ id:r.id, name:r.name, place:`${r.city}, ${r.country}`, country:r.country, kind:r.kind, category:r.category, categories:[r.category,...r.secondaryCategories||[]], search:resourceSearchText(r) });
const index=resources.map(compact), matcher=createIndexedSearchMatcher();
const rank=(items,q,score=resourceSearchScore)=>items.filter(r=>score(r,q)>=0).sort((a,b)=>score(b,q)-score(a,q)||a.name.localeCompare(b.name));
const ids=rows=>rows.map(r=>r.id);

for(const scenario of cases) test(`${scenario.id}: ${scenario.query} — ${scenario.expectation}`,()=>{
  const rows=rank(resources,scenario.query), indexed=rank(index,scenario.query,matcher.score);
  assert.deepEqual(ids(indexed),ids(rows),'Homepage and compact directory retain ranking parity');
  if(scenario.exactIds) assert.deepEqual(ids(rows).sort(),[...scenario.exactIds].sort());
  for(const id of scenario.includes||[]) assert.ok(rows.some(r=>r.id===id),`Catalog-derived provider ${id}`);
  if(scenario.firstId) assert.equal(rows[0]?.id,scenario.firstId);
  if(scenario.country) assert.ok(rows.length&&rows.every(r=>r.country===scenario.country));
  if(scenario.sameAs) assert.deepEqual(ids(rows),ids(rank(resources,scenario.sameAs)));
  if(scenario.everyMealEvidence) assert.ok(rows.length&&rows.every(r=>(r.services||[]).some(s=>/\bmeals?\b/i.test(s))),'Meal intent requires service evidence; WIC food benefits alone are not a meal service');
  if(scenario.everyWicEvidence) assert.ok(rows.length&&rows.every(r=>/\bWIC\b/i.test([r.name,r.summary,...r.services].join(' '))));
  const choices=searchGeographyChoices(rows,scenario.query);
  assert.deepEqual(geographyChoices(indexed,querySearchTokens(scenario.query),normalizeSearch),choices);
  if(scenario.ambiguityCountries) assert.deepEqual(choices.map(c=>c.country).sort(),scenario.ambiguityCountries);
});

test('water and meal need evidence does not confuse names/streets, while literal provider/address queries survive',()=>{
  const incidental={id:'name-only',name:'Water Street Mission',city:'Boston',country:'United States',kind:'direct',category:'shelter',address:'10 Water Street, Boston, MA 02111',services:['Overnight shelter']};
  const noWater={...incidental,id:'negative',name:'Community center',summary:'No drinking water available',services:['No meals available']};
  const meal={...incidental,id:'meal',name:'Daily support',services:['Daily hot meals']};
  const water={...incidental,id:'water',name:'Public fountain',category:'water',services:['Free drinking water']};
  for(const convert of [r=>r,compact]) {
    for(const q of ['water Boston','drinking water Boston','agua Boston']) {
      assert.equal(resourceSearchScore(convert(incidental),q),-1,q);
      assert.equal(resourceSearchScore(convert(noWater),q),-1,q);
      assert.ok(resourceSearchScore(convert(water),q)>=0,q);
    }
    for(const q of ['meals Boston','meal Boston']) {
      assert.equal(resourceSearchScore(convert(incidental),q),-1,q);
      assert.equal(resourceSearchScore(convert(noWater),q),-1,q);
      assert.ok(resourceSearchScore(convert(meal),q)>=0,q);
    }
    for(const q of ['Water Street Mission','Water Street','10 Water Street']) assert.ok(resourceSearchScore(convert(incidental),q)>=0,q);
  }
  assert.equal(rank(resources,'Bridge Over Troubled Waters')[0]?.id,'bridge-over-troubled-waters');
});

test('Mexico country/city ambiguity has explicit text and respects manual country filtering',()=>{
  const matches=rank(resources,'Mexico'),tokens=querySearchTokens('Mexico');
  let notice;
  const document={createElement:()=>({setAttribute(){}})};
  const prior=globalThis.document;globalThis.document=document;
  try{
    const root={querySelector:()=>notice,prepend:node=>{notice=node;}};
    renderGeographyHint(root,matches,tokens,normalizeSearch);
    assert.match(notice.textContent,/country Mexico/);
    assert.match(notice.textContent,/Mexico, United States/);
    assert.equal(notice.hidden,false);
    renderGeographyHint(root,matches.filter(r=>r.country==='Mexico'),tokens,normalizeSearch);
    assert.equal(notice.hidden,true);
    assert.deepEqual(searchGeographyChoices(matches.filter(r=>r.country==='Mexico'),'Mexico'),[]);
  }finally{globalThis.document=prior;}
});

test('medication refills and IV hydration are not silently reclassified as drinking water',()=>{
  for(const convert of [r=>r,compact]) {
    const refills=convert({name:'Community clinic',city:'London',country:'United Kingdom',category:'health',services:['Prescription refills']});
    const hydration=convert({name:'Day clinic',city:'London',country:'United Kingdom',category:'health',services:['IV hydration']});
    assert.ok(resourceSearchScore(refills,'refill London')>=0,'Literal medication refill query retains previous prefix recall');
    assert.ok(resourceSearchScore(hydration,'hydration London')>=0,'Literal health hydration query remains searchable');
    for(const record of [refills,hydration]) for(const q of ['water London','drinking water London','agua London','eau London']) assert.equal(resourceSearchScore(record,q),-1,`Health services alone do not evidence ${q}`);
  }
});
