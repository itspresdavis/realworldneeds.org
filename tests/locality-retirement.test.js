import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('country placeholders are absent from locality manifests and sitemap with useful permanent legacy routes',async()=>{
  const [manifest,sitemap,config]=await Promise.all([
    readFile('dist/data/resources/local-index.json','utf8').then(JSON.parse),
    readFile('dist/sitemap.xml','utf8'),readFile('vercel.json','utf8').then(JSON.parse)
  ]);
  assert.ok(manifest.cities.every(place=>place.city.toLowerCase()!==place.country.toLowerCase()));
  for(const country of ['united-states','united-kingdom']){
    const old=`/directory/local/${country}/${country}`;
    assert.ok(!sitemap.includes(old));
    assert.ok(!manifest.cities.some(place=>place.path===old));
    const redirect=config.redirects.find(rule=>rule.source===`${old}/:path*`);
    assert.equal(redirect?.destination,`/directory/${country}`);
    assert.equal(redirect?.permanent,true);
  }
});

test('New York naming aliases share one city page while retaining the prior route',async()=>{
  const manifest=JSON.parse(await readFile('dist/data/resources/local-index.json','utf8'));
  const cities=manifest.cities.filter(place=>place.country==='United States'&&['New York','New York City'].includes(place.city));
  assert.equal(cities.length,1);
  assert.equal(cities[0].path,'/directory/local/united-states/new-york-city');
  const html=await readFile(`dist${cities[0].path}/index.html`,'utf8');
  assert.match(html,/rel="canonical" href="https:\/\/www.realworldneeds.org\/directory\/local\/united-states\/new-york-city"/);
});
