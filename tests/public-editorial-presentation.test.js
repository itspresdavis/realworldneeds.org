import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source=await readFile('scripts/professional-seo.mjs','utf8');
const context=vm.createContext({resources:[],URL});
vm.runInContext(source.slice(0,source.indexOf('const releasePath =')).replace(/^import .*;\n/gm,''),context);
const hrefs=html=>[...html.matchAll(/\bhref="([^"]+)"/g)].map(match=>match[1]).sort();
const schemas=html=>[...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/g)].map(match=>match[0]);

test('moving service and source breadcrumbs preserves every destination and structured fact',async()=>{
 for(const [path,file] of [['/service/whitechapel-mission','dist/service/whitechapel-mission/index.html'],['/sources','dist/sources/index.html']]){
  const before=await readFile(file,'utf8'),after=context.refineEditorialPage(before,path);
  assert.deepEqual(hrefs(after),hrefs(before));
  assert.deepEqual(schemas(after),schemas(before));
  assert.equal((after.match(/aria-label="Breadcrumb"/g)||[]).length,1);
  assert.ok(after.indexOf('aria-label="Breadcrumb"')<after.indexOf('<h1>'));
  assert.equal(context.refineEditorialPage(after,path),after,'the transform is idempotent');
  if(path.startsWith('/service/')){
   const record=html=>html.match(/<article class="directory-record"[\s\S]*?<\/article>/)?.[0];
   assert.ok(record(before));assert.equal(record(after),record(before),'all service details remain intact');
  }
 }
});

test('source summary keeps all counts once and preserves its distinct review range',async()=>{
 const before=await readFile('dist/sources/index.html','utf8'),after=context.refineEditorialPage(before,'/sources');
 assert.match(after,/<h1>Sources<\/h1>/);
 const metric=html=>html.match(/<div class="transparency-metrics">[\s\S]*?<div class="policy-note">/)?.[0];
 assert.ok(metric(before));assert.equal(metric(after),metric(before));
 const meta=after.match(/<div class="legal-meta">([\s\S]*?)<\/div>/)?.[1]||'';
 assert.equal((meta.match(/<span>/g)||[]).length,1);assert.match(meta,/Listing source checks/);
 assert.equal((after.match(/source-ledger-card/g)||[]).length,(before.match(/source-ledger-card/g)||[]).length);
});

test('concise document headings do not alter policy text or links',async()=>{
 for(const [path,heading] of [['privacy','Privacy'],['terms','Terms of use'],['editorial-policy','How we check listings'],['accessibility','Accessibility']]){
  const before=await readFile(`public/${path}.html`,'utf8'),after=context.refineEditorialPage(before,`/${path}`);
  assert.ok(after.includes(`<h1>${heading}</h1>`));assert.deepEqual(hrefs(after),hrefs(before));
  const article=html=>html.match(/<article class="legal-content">[\s\S]*?<\/article>/)?.[0];
  assert.ok(article(before));assert.equal(article(after),article(before));
 }
});

test('footer brand has no special first-letter color and compact mobile mastheads can hide the tagline',async()=>{
 const [legal,professional,navigation]=await Promise.all(['public/legal.css','public/professional-pages.css','public/navigation-actions.css'].map(path=>readFile(path,'utf8')));
 assert.doesNotMatch(legal,/\.legal-footer p::first-letter/);
 assert.match(professional,/\.legal-footer\s*>\s*p\s*\{[^}]*color:var\(--page-ink-strong\)/);
 assert.doesNotMatch(navigation,/\.legal-brand small\{display:block!important\}/);
 assert.match(professional,/@media\s*\(max-width:430px\)[\s\S]*?\.legal-brand small\s*\{display:none/);
});

test('Join puts the account task before supplementary guidance while retaining every account control',async()=>{
 const html=await readFile('public/join.html','utf8');
 assert.match(html,/<h1>Contribute to the directory<\/h1>/);
 assert.ok(html.indexOf('class="account-panel"')<html.indexOf('class="join-guidance"'));
 assert.doesNotMatch(html,/care-drawing|drawing-caption|Someone’s next step/);
 for(const id of ['accountTitle','accountIntro','accountForm','accountSubmit','accountStatus','passwordLabel','signupSwitch','recoverSwitch'])assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,id);
 assert.match(html,/type="email"[\s\S]*?name="email"[\s\S]*?autocomplete="email"/);
 assert.match(html,/type="password"[\s\S]*?name="password"[\s\S]*?autocomplete="current-password"/);
 assert.match(html,/id="accountStatus" role="status" aria-live="polite"/);
 assert.match(html,/id="accountTitle">Sign in<\/h2>/);
 assert.match(html,/id="accountIntro">Sign in to review listings and add a note\.<\/p>/);
});

test('public presentation retains existing stylesheet budgets',async()=>{
 for(const [path,limit] of [['public/professional-pages.css',32000],['public/navigation-actions.css',12000],['public/directory-enhancements.css',18000]])assert.ok((await stat(path)).size<limit,`${path} exceeds its existing budget`);
});

test('public Join has the full shared menu with Contribute current and unchanged account form',async()=>{
 const before=await readFile('public/join.html','utf8');
 const after=context.enhanceGeneratedPage(before,'abcdef123456');
 const menu=after.match(/<nav class="rwn-page-nav"[^>]*>([\s\S]*?)<\/nav>/)?.[1]||'';
 assert.deepEqual([...menu.matchAll(/href="([^"]+)"/g)].map(match=>match[1]),['/','/directory','/editorial-policy','/sources','/shop','/join']);
 assert.match(menu,/href="\/join" aria-current="page">Contribute/);
 assert.equal((menu.match(/aria-current/g)||[]).length,1);
 assert.match(after,/class="rwn-page-menu"/);
 assert.match(after,/class="rwn-saved-link" href="\/directory#saved"/);
 assert.match(after,/src="\/page-menu\.js\?v=abcdef123456"/);
 assert.doesNotMatch(after,/<header class="contributor-header"|rel="canonical"/);
 assert.match(after,/name="robots" content="noindex,follow"/);
 const form=html=>html.match(/<form id="accountForm">[\s\S]*?<\/form>/)?.[0];
 assert.ok(form(before));assert.equal(form(after),form(before));
});
