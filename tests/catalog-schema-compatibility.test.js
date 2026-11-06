import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createCatalogLoader } from '../public/catalog-request.js';
import { renderDirectoryRow } from './helpers/directory-renderer.js';

const compatible = { schemaVersion:'2.0', records:[], scopes:{} };
for(const schemaVersion of [undefined,'1.6','1.5','future',2]) test(`current catalog loader rejects incompatible schema ${schemaVersion} and supports explicit retry`,async()=>{
  const original=globalThis.fetch;let attempts=0;
  globalThis.fetch=async()=>new Response(JSON.stringify(++attempts===1?{...compatible,schemaVersion,records:[{id:'bowery-mission',kind:'direct',lat:40.7219,lng:-73.9932}]}:compatible));
  try{
    const load=createCatalogLoader('/data/search-index.json?v=new',true);
    await assert.rejects(load(),/directory/i);
    load.retry();
    assert.deepEqual(await load(),compatible);
    assert.equal(attempts,2);
  }finally{globalThis.fetch=original;}
});

test('new service-access index suppresses legacy generic maps without changing IDs or source map reference coordinates',async()=>{
  const index=JSON.parse(await readFile('dist/data/search-index.json'));
  assert.equal(index.schemaVersion,'2.0');
  const record=index.records.find(r=>r.id==='bowery-mission');
  assert.equal(record.lat,null);assert.equal(record.lng,null);
  assert.ok(record.serviceActions.some(a=>a.label==='Shelter intake details'));
  const legacy=await readFile('browser-tests/fixtures/legacy-directory-results.js','utf8');
  const row=renderDirectoryRow(legacy,record),walk=node=>[node,...node.children.flatMap(walk)];
  assert.ok(walk(row).some(n=>n.href==='/service/bowery-mission'));
  assert.ok(walk(row).every(n=>!/maps\.apple|google\.com\/maps/.test(n.href||'')));
  const sources=JSON.parse(await readFile('dist/data/resources.json')).resources;
  const map=JSON.parse(await readFile('dist/data/map-index.json')).resources;
  const source=sources.find(r=>r.id===record.id);
  assert.equal(source.lat,40.7219);assert.equal(source.lng,-73.9932);
  assert.equal(map.length,sources.filter(r=>r.locationPrecision!=='contact-only').length);
  for(const indexed of index.records){
    const raw=sources.find(r=>r.id===indexed.id);
    assert.ok(raw,'every compact ID retains its full source record');
    if(raw.serviceAccess||raw.locationPrecision==='contact-only'){
      assert.equal(indexed.lat,null,indexed.id);assert.equal(indexed.lng,null,indexed.id);
    }else{
      assert.equal(indexed.lat,raw.lat,indexed.id);assert.equal(indexed.lng,raw.lng,indexed.id);
    }
    if(raw.locationPrecision!=='contact-only'){
      const marker=map.find(r=>r.id===indexed.id);
      assert.equal(marker.lat,raw.lat,indexed.id);assert.equal(marker.lng,raw.lng,indexed.id);
    }
  }
});
