import { matchDirectorySuggestions, parseSuggestionArea } from './directory-suggestions.js';
import { createCatalogLoader } from './catalog-request.js';

const $ = selector => document.querySelector(selector);
const authForm = $('#personalAuth');
const form = $('#preferencesForm');
const status = $('#preferencesStatus');
const results = $('#personalSuggestions');
const catalog = createCatalogLoader('/data/search-index.json', true);
let mode = 'signin';
let generation = 0;
let saving = false;
const requests = new Set();
async function request(path, body) {
  const controller = new AbortController();
  requests.add(controller);
  try {
    const response = await fetch(path, {
      method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(16000)]),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data.error || 'Please try again.');
      error.status = response.status;
      throw error;
    }
    return data;
  } finally { requests.delete(controller); }
}
const errorMessage = error => ['TypeError', 'TimeoutError', 'AbortError'].includes(error.name)
  ? 'Connection interrupted. Please try again.' : error.message;
function clearView() {
  generation++;
  results.replaceChildren();
  status.textContent = '';
}
function clearPrivateView() {
  clearView(); form.reset(); authForm.reset();
  $('#personalIdentity').textContent = '';
  $('#preferencesPanel').hidden = true;
  $('#personalPasswordForm').reset();
  $('#personalSettingsStatus').textContent = '';
}
function setMode(next) {
  mode = next;
  const recover = mode === 'recover';
  $('#signinTitle').textContent = recover ? 'Reset your password' : mode === 'signup' ? 'Create an optional account' : 'Sign in';
  $('#personalAuthSubmit').textContent = recover ? 'Send reset link' : mode === 'signup' ? 'Create account' : 'Sign in';
  $('#personalPasswordLabel').hidden = recover;
  authForm.elements.password.disabled = recover;
  authForm.elements.password.minLength = mode === 'signup' ? 12 : 1;
  authForm.elements.password.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  authForm.elements.password.value = '';
  $('#personalSignup').textContent = mode === 'signin' ? 'Create an account' : 'Back to sign in';
  $('#personalAuthStatus').textContent = '';
}
async function suggest(topics, area, prefix = '') {
  const current = generation;
  if (!topics.length) { status.textContent = prefix + ' Choose a topic when you want suggestions.'; return; }
  if (navigator.onLine === false) { status.textContent = prefix + ' Connect to load suggestions, or browse the directory.'; return; }
  try {
    const payload = await catalog();
    if (current !== generation) return;
    const matches = matchDirectorySuggestions(payload.records, topics, parseSuggestionArea(area));
    for (const { record, reasons } of matches) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `/service/${encodeURIComponent(record.id)}`;
      link.textContent = record.name;
      const detail = document.createElement('p');
      detail.textContent = `${record.place} · Matches your topics: ${reasons.join(', ')}`;
      item.append(link, detail); results.append(item);
    }
    status.textContent = prefix + (matches.length ? ` ${matches.length} suggestions. Check each provider’s requirements.` : ' No matches for these choices. Try the full directory or a different place.');
  } catch { if (current === generation) status.textContent = prefix + ' Suggestions could not load. You can still browse the directory.'; }
}
async function loadAccount() {
  const availability = await request('/api/preferences?action=availability');
  if (!availability.enabled) {
    $('#accountAvailability').textContent = 'Optional accounts are coming soon. You can use suggestions in the directory now without signing up.';
    return;
  }
  $('#accountAvailability').textContent = '';
  let account;
  try { account = await request('/api/account'); }
  catch (error) { if (error.status !== 401) throw error; $('#signinPanel').hidden = false; return; }
  const { preferences } = await request('/api/preferences');
  $('#signinPanel').hidden = true;
  $('#preferencesPanel').hidden = false;
  $('#personalIdentity').textContent = `Signed in as ${account.user.email}`;
  for (const input of form.querySelectorAll('[name="topic"]')) input.checked = preferences?.topics.includes(input.value) || false;
  form.elements.area.value = preferences?.area || '';
  // Saving edited answers always requires a fresh, explicit agreement.
  form.elements.consent.checked = false;
  if (preferences) await suggest(preferences.topics, preferences.area, 'Your saved answers are loaded.');
}
$('#personalSignup').addEventListener('click', () => setMode(mode === 'signin' ? 'signup' : 'signin'));
$('#personalRecover').addEventListener('click', () => setMode('recover'));
authForm.addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('#personalAuthSubmit'); button.disabled = true;
  try {
    const data = await request('/api/account', { action: mode, audience: 'personal', email: authForm.elements.email.value.trim(), password: authForm.elements.password.value });
    authForm.elements.password.value = '';
    if (mode === 'signin' || data.signedIn) await loadAccount();
    else $('#personalAuthStatus').textContent = data.message;
  } catch (error) { $('#personalAuthStatus').textContent = errorMessage(error); }
  finally { button.disabled = false; }
});
form.addEventListener('input', clearView);
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (saving) return;
  clearView();
  const topics = [...form.querySelectorAll('[name="topic"]:checked')].map(input => input.value);
  const area = form.elements.area.value.trim();
  if (!parseSuggestionArea(area)) { status.textContent = 'Enter a city, city and country, or 5-digit U.S. ZIP.'; form.elements.area.focus(); return; }
  saving = true;
  const button = form.querySelector('button'); button.disabled = true;
  const current = generation;
  try {
    await request('/api/preferences', { action: 'save', preferences: { topics, area, consent: form.elements.consent.checked } });
    if (current === generation) { form.elements.consent.checked = false; await suggest(topics, area, 'Answers saved.'); }
  } catch (error) { if (current === generation) status.textContent = errorMessage(error); }
  finally { saving = false; button.disabled = false; }
});
$('#clearPreferences').addEventListener('click', async event => {
  if (saving) { status.textContent = 'Please wait for the save to finish before deleting your answers.'; return; }
  saving = true; event.currentTarget.disabled = true;
  clearView();
  try { await request('/api/preferences', { action: 'clear' }); form.reset(); status.textContent = 'Your saved answers have been deleted.'; }
  catch (error) { status.textContent = errorMessage(error); }
  finally { saving = false; $('#clearPreferences').disabled = false; }
});
$('#downloadPreferences').addEventListener('click', async () => {
  try {
    const data = await request('/api/preferences');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'rwn-resource-preferences.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { status.textContent = errorMessage(error); }
});
$('#personalSignout').addEventListener('click', async () => {
  try { await request('/api/account', { action: 'signout' }); clearPrivateView(); $('#signinPanel').hidden = false; }
  catch (error) { status.textContent = errorMessage(error); }
});
$('#personalPasswordForm').addEventListener('submit', async event => {
  event.preventDefault();
  const passwordForm = event.currentTarget;
  try { await request('/api/account', { action: 'password', password: passwordForm.elements.password.value }); passwordForm.reset(); $('#personalSettingsStatus').textContent = 'Password updated.'; }
  catch (error) { $('#personalSettingsStatus').textContent = errorMessage(error); }
});
$('#deletePersonalAccount').addEventListener('click', async () => {
  try { const data = await request('/api/account', { action: 'delete-request' }); $('#personalSettingsStatus').textContent = data.message; }
  catch (error) { $('#personalSettingsStatus').textContent = errorMessage(error); }
});
window.addEventListener('pagehide', () => { for (const request of requests) request.abort(); clearPrivateView(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
for (const event of ['offline', 'online']) window.addEventListener(event, () => { catalog.reset(); clearView(); });
navigator.serviceWorker?.addEventListener('controllerchange', () => { catalog.reset(); clearView(); });
if (new URLSearchParams(location.search).has('notice')) $('#personalAuthStatus').textContent = 'That link expired. Request a new link and open it in this browser.';
loadAccount().catch(error => { $('#accountAvailability').textContent = errorMessage(error); });
