import { readFile, writeFile } from 'node:fs/promises';
import { organizationPages } from '../src/data/organization-content.js';

const origin='https://www.realworldneeds.org';
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const bilingual=(tag,value)=>`<${tag} data-i18n-en="${escape(value.en)}" data-i18n-es="${escape(value.es)}">${escape(value.en)}</${tag}>`;
const labels=new Map(organizationPages.map(page=>[page.path,page.title]));
for(const [path,en,es] of [['/directory','Find help','Encuentra ayuda'],['/transparency','Transparency','Transparencia'],['/sources','Sources','Fuentes'],['/join','Contributor workspace','Espacio para colaboradores'],['/corrections','Reporting availability','Disponibilidad de informes'],['/accessibility','Accessibility','Accesibilidad']])labels.set(path,{en,es});
for(const page of organizationPages){
  const html=`<!doctype html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title data-i18n-en="${escape(page.title.en)} | Real World Needs" data-i18n-es="${escape(page.title.es)} | Real World Needs">${escape(page.title.en)} | Real World Needs</title>
<meta name="description" content="${escape(page.description.en)}" /><meta name="robots" content="index, follow" /><meta name="theme-color" content="#071926" />
<link rel="canonical" href="${origin}${page.path}" /><link rel="stylesheet" href="/legal.css" />
<meta property="og:type" content="website" /><meta property="og:title" content="${escape(page.title.en)} | Real World Needs" /><meta property="og:description" content="${escape(page.description.en)}" /><meta property="og:url" content="${origin}${page.path}" />
<script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@type':page.path==='/about'?'AboutPage':page.path==='/contact'?'ContactPage':'WebPage',name:page.title.en,url:origin+page.path,description:page.description.en,isPartOf:{'@id':origin+'/#website'}}).replaceAll('<','\\u003c')}</script>
</head><body><a class="skip-link" href="#content">Skip to content</a>
<header class="legal-header"><a class="legal-brand" href="/">Real World Needs</a><nav aria-label="Primary navigation"><a href="/">Find help</a><a href="/directory">Directory</a><a href="/about">About RWN</a></nav></header>
<main id="content"><section class="legal-hero"><div class="legal-hero__inner">${bilingual('h1',page.title)}${bilingual('p',page.introduction)}</div></section>
<div class="legal-layout"><nav class="legal-toc" aria-label="About RWN">${organizationPages.map(item=>`<a href="${item.path}"${item.path===page.path?' aria-current="page"':''} data-i18n-en="${escape(item.title.en)}" data-i18n-es="${escape(item.title.es)}">${escape(item.title.en)}</a>`).join('')}</nav>
<article class="legal-content">${page.sections.map(section=>`<section>${bilingual('h2',section.title)}${bilingual('p',section.body)}</section>`).join('')}
<nav class="directory-downloads" aria-label="Useful next steps">${page.links.map(path=>`<a href="${path}" data-i18n-en="${escape(labels.get(path).en)}" data-i18n-es="${escape(labels.get(path).es)}">${escape(labels.get(path).en)}</a>`).join('')}</nav></article></div></main>
<footer class="legal-footer"><p>Real World Needs</p><nav><a href="/directory">Find help</a><a href="/privacy">Privacy</a><a href="/transparency">Transparency</a></nav></footer></body></html>`;
  await writeFile(`dist${page.path}.html`,html+'\n');
}
const sitemap=await readFile('dist/sitemap.xml','utf8');
await writeFile('dist/sitemap.xml',sitemap.replace('</urlset>',organizationPages.map(page=>`  <url><loc>${origin}${page.path}</loc></url>`).join('\n')+'\n</urlset>'));
