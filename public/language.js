import { LANGUAGE_KEY, getLocale, t, setLocale, readLanguagePreference, clearLanguagePreference, formatDate } from '../src/utils/localization.js';
import { translateInterfaceText } from '../src/utils/interface-copy.js';

// This adapter translates allowlisted interface copy, never query/form values or
// arbitrary provider prose. Existing elements stay in place to retain focus,
// native handlers, Saved IDs, selection, composition and browser history.
const originalText = new WeakMap(), originalAttributes = new WeakMap();
const providerSelector = '[data-provider-text], .resource-row__service strong, .resource-row__place, .resource-row__access, .directory-record__summary, .directory-record > header h2 a, .directory-record > header span, .directory-record__facts strong, .directory-record__facts p, .directory-global-result > span > strong, .directory-global-result > span > span, #service .legal-hero h1, #service .legal-hero__lede, .service-facts dd, .service-before-you-go dd';
const ignoredSelector = 'script, style, noscript, textarea, input, code, pre, [data-language-control], [data-language-notice], [data-i18n-en], [data-i18n], [data-rwn-label]';
let scheduled = false, pending = new Set(), languageClearFailed = false;
const originalTitle = document.title;

function translateNode(node) {
  const parent = node.parentElement;
  if (!parent || !node.textContent.trim()) return;
  const old = originalText.get(node), current = node.textContent;
  const source = old && current === old.rendered ? old.source : current;
  if (!old && getLocale() === 'en') return;
  const rendered = parent.closest('.is-access-details') ? source.replace(/^(.+) details$/, (_, service) => t('detailsFor', {service})) : parent.closest('.resource-row__aid, .directory-global-result > small')
    ? source.split(/( · )/).map(part => translateInterfaceText(part, getLocale())).join('')
    : translateInterfaceText(source, getLocale());
  if (rendered === current && !old) return;
  if (parent.closest(ignoredSelector) || parent.closest(providerSelector)) return;
  originalText.set(node, { source, rendered });
  if (current !== rendered) { node.textContent = rendered; parent.lang = getLocale(); }
}
function translateAttributes(element) {
  if (element.closest('[data-provider-text], [data-language-control]')) return;
  let values = originalAttributes.get(element);
  if (!values) { values = new Map(); originalAttributes.set(element, values); }
  for (const name of ['aria-label', 'placeholder', 'title']) {
    const current = element.getAttribute(name);
    if (current === null) continue;
    const old = values.get(name), source = old && current === old.rendered ? old.source : current;
    const rendered = translateInterfaceText(source, getLocale());
    values.set(name, { source, rendered });
    if (current !== rendered) element.setAttribute(name, rendered);
  }
}
function localize(root) {
  if (!root?.isConnected) return;
  if (root.nodeType === Node.TEXT_NODE) { translateNode(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE && root.nodeType !== Node.DOCUMENT_NODE) return;
  for (const provider of root.querySelectorAll(providerSelector)) if (!provider.hasAttribute('lang')) provider.lang = 'en';
  for (const option of root.querySelectorAll('option:not([value])')) option.value = option.textContent;
  const selector = '[aria-label], [placeholder], [title], [data-i18n], [data-i18n-en], time[datetime]';
  const elements = root.nodeType === Node.ELEMENT_NODE ? [root, ...root.querySelectorAll(selector)] : [...root.querySelectorAll(selector)];
  for (const element of elements) {
    if (element.matches('[data-language-control], [data-language-control] *')) continue;
    // Preserve implicit <option> values before changing their displayed label.
    if (element.tagName === 'OPTION' && !element.hasAttribute('value')) element.value = element.textContent;
    const key = element.dataset?.i18n;
    const explicit = getLocale() === 'es' ? element.dataset?.i18nEs : element.dataset?.i18nEn;
    if (key || explicit !== undefined) {
      const value = key ? t(key) : explicit;
      element.lang = getLocale();
      const attribute = element.dataset.i18nAttr;
      if (attribute && ['aria-label', 'placeholder', 'title'].includes(attribute)) { if (element.getAttribute(attribute) !== value) element.setAttribute(attribute, value); }
      else if (element.textContent !== value) element.textContent = value;
    }
    translateAttributes(element);
    if (element.matches('time[data-local-date][datetime], time.resource-row__reviewed[datetime]')) { const value = formatDate(element.getAttribute('datetime')); if (element.textContent !== value) element.textContent = value; }
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) translateNode(walker.currentNode);
}
function bindLanguage(select) {
  if (select.dataset.languageBound) return;
  select.dataset.languageBound = 'true'; select.disabled = false;
  select.addEventListener('change', () => { languageClearFailed = false; setLocale(select.value); });
}
function ensureControl() {
  const select = document.querySelector('[data-language-control] select');
  if (select) bindLanguage(select);
}

function update() {
  scheduled = false;
  // A search promise can change results after the observer queued this update.
  // Drain those mutations before disconnecting so their new copy is not lost.
  for (const change of observer.takeRecords()) pending.add(change.target);
  observer.disconnect(); ensureControl();
  document.title = originalTitle.split(' | ').map(part => translateInterfaceText(part, getLocale())).join(' | ');
  for (const root of pending) localize(root);
  pending.clear();
  const select = document.querySelector('[data-language-control] select'); if (select) select.value = getLocale();
  const notice = document.querySelector('[data-language-notice]');
  if (notice) { const value = t(languageClearFailed ? 'languageClearFailed' : 'translationScope'); if (notice.textContent !== value) notice.textContent = value; notice.hidden = false; }
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'placeholder', 'title'] });
}
function queue(root) { if (root) pending.add(root); if (!scheduled) { scheduled = true; queueMicrotask(update); } }
function interfaceOriginalText(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let value = '';
  while (walker.nextNode()) {
    const node = walker.currentNode, previous = originalText.get(node);
    value += previous && previous.rendered === node.textContent ? previous.source : node.textContent;
  }
  return value;
}
window.RWNLanguage = Object.freeze({ t, getLocale, originalText: interfaceOriginalText, translate: (value) => translateInterfaceText(value, getLocale()) });
window.addEventListener('rwn:languagechange', () => queue(document.body));
window.addEventListener('storage', event => { if (event.key === LANGUAGE_KEY || event.key === null) setLocale(readLanguagePreference(), { persist: false }); });
document.addEventListener('click', event => {
  if (event.target.closest?.('#clearBrowserData') && (languageClearFailed = !clearLanguagePreference())) {
    const notice = document.querySelector('[data-language-notice]');
    if (notice) { notice.hidden = false; notice.textContent = t('languageClearFailed'); }
  }
});
const observer = new MutationObserver(changes => {
  for (const change of changes) {
    if (change.type === 'childList') for (const node of change.addedNodes) queue(node);
    else queue(change.target);
  }
});
setLocale(readLanguagePreference(), { persist: false });
queue(document.body);
observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['aria-label', 'placeholder', 'title'] });
