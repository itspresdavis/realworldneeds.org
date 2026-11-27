import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {organizationPages} from '../src/data/organization-content.js';

test('organization pages publish complete bilingual approved copy with canonical and sitemap paths',async()=>{
  const sitemap=await readFile('dist/sitemap.xml','utf8');
  for(const page of organizationPages){
    const html=await readFile(`dist${page.path}.html`,'utf8');
    assert.match(html,/<main id="content">/);
    assert.equal((html.match(/<h1\b/g)||[]).length,1);
    assert.ok(html.includes(`rel="canonical" href="https://www.realworldneeds.org${page.path}"`));
    assert.ok(sitemap.includes(`<loc>https://www.realworldneeds.org${page.path}</loc>`));
    assert.ok(page.sections.every(section=>section.title.en&&section.title.es&&section.body.en&&section.body.es));
    assert.match(html,/data-i18n-es=/);
    assert.doesNotMatch(html,/\{\{|\bTODO\b|mailto:|<form|type="submit"/);
  }
});

test('organizational participation and contact copy does not promise an unoperated process',()=>{
  const text=organizationPages.flatMap(page=>page.sections.map(section=>section.body.en)).join('\n');
  assert.match(text,/directory is one RWN program/);
  assert.match(text,/Listed providers are independent organizations/);
  assert.doesNotMatch(text,/\b501\(c\)|tax.deductible|EIN:|24.hour response|registered charity/i);
});
