import { getLocale, setLocale, readLanguagePreference } from '/src/utils/localization.js';
import { translateContributorText } from './contributor-copy.js';

// This module is loaded only by account/workspace pages. It never fetches,
// persists, logs or exports account fields, notes, record values or draft text.
const originals = new WeakMap(), attributes = new WeakMap();
const excluded = 'script,style,noscript,input,textarea,code,pre,[data-provider-text],.record-facts,[data-correction-review],[data-language-control],[data-language-notice],[data-contributor-language]';
const excludedAttributes = excluded.replace('input,textarea,','');
let observer, queued = false;
const pending = new Set();
function text(node) {
  const parent = node.parentElement;
  if (!parent || parent.closest(excluded)) return;
  const current = node.textContent, old = originals.get(node);
  const source = old?.rendered === current ? old.source : current;
  const rendered = translateContributorText(source, getLocale());
  originals.set(node, {source, rendered});
  if (rendered !== current) { node.textContent = rendered; parent.lang = getLocale(); }
}
function localize(root) {
  if (!root?.isConnected) return;
  if (root.nodeType === Node.TEXT_NODE) { text(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) text(walker.currentNode);
  for (const element of [root, ...root.querySelectorAll('[aria-label],[placeholder],[alt],time[datetime]')]) {
    if (element.closest(excludedAttributes)) continue;
    let values = attributes.get(element); if (!values) { values = new Map(); attributes.set(element, values); }
    for (const name of ['aria-label','placeholder','alt']) {
      const current = element.getAttribute(name); if (current === null) continue;
      const old = values.get(name), source = old?.rendered === current ? old.source : current;
      const rendered = translateContributorText(source, getLocale()); values.set(name,{source,rendered});
      if (current !== rendered) element.setAttribute(name,rendered);
    }
    if (element.matches('time[datetime]')) {
      const date = new Date(element.dateTime);
      if (Number.isFinite(date.valueOf())) element.textContent = new Intl.DateTimeFormat(getLocale(),{dateStyle:'medium',timeStyle:'short'}).format(date);
    }
  }
}
function update() {
  queued = false; observer.disconnect();
  for (const root of pending) localize(root); pending.clear();
  const control = document.querySelector('[data-contributor-language] select'); if (control) control.value = getLocale();
  const note = document.querySelector('[data-contributor-language] p');
  if (note) note.textContent = getLocale() === 'es' ? 'Interfaz en español. Las fichas, las notas y los campos conservan su idioma original.' : 'Interface language only. Listings, notes and record values retain their original language.';
  const title = document.querySelector('title'); if (title?.firstChild) text(title.firstChild);
  observer.observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['aria-label','placeholder','alt']});
}
function queue(root) { pending.add(root); if (!queued) { queued = true; queueMicrotask(update); } }
function install() {
  if (!['join','workspace','workspace-unavailable'].includes(document.body?.dataset.page)) return;
  if (!document.querySelector('[data-language-control]')) {
    const bar = document.createElement('nav'); bar.className = 'contributor-language'; bar.dataset.contributorLanguage = ''; bar.setAttribute('aria-label','Language / Idioma');
    const label = document.createElement('label'); label.textContent = 'Language / Idioma ';
    const select = document.createElement('select');
    for (const [value,name] of [['en','English'],['es','Español']]) { const option = document.createElement('option'); option.value=value; option.lang=value; option.textContent=name; select.append(option); }
    select.addEventListener('change',()=>setLocale(select.value)); label.append(select);
    const note = document.createElement('p'); bar.append(label,note);
    const header = document.querySelector('header'); if (header) header.after(bar); else document.body.prepend(bar);
  }
  observer = new MutationObserver(changes=>{for (const change of changes) { if (change.type === 'childList') for (const node of change.addedNodes) queue(node); else queue(change.target); }});
  window.addEventListener('rwn:languagechange',()=>queue(document.body));
  window.addEventListener('storage',event=>{if(event.key === 'rwn-language' || event.key === null) setLocale(readLanguagePreference(),{persist:false});});
  setLocale(readLanguagePreference(),{persist:false}); queue(document.body);
}
if (typeof document !== 'undefined') install();
