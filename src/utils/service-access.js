import { hasMapCoordinates } from './resource-location.js';
import { evaluateSchedule, scheduleText, validateSchedule, validScheduleTime } from './service-schedule.js';
import { t } from './localization.js';

// One source-backed access contract for build output, finder actions and exports.
// An explicit but invalid contract must never fall back to organization coordinates.
const modes = new Set(['walk-in', 'intake', 'contact', 'confidential', 'unknown', 'delivery']);
const text = (value, max = 1600) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const publicUrl = value => {
  if (!text(value, 2048) || !value.startsWith('https://')) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
};
const fields = new Set(['address', 'entrance', 'eligibility', 'intake', 'capacity', 'contacts', 'instructions', 'schedule', 'hours', 'documents', 'intakeCutoff']);
const verificationStates = new Set(['source-reviewed', 'provider-confirmed', 'link-checked', 'unverified']);
const routeFields = new Set(['id', 'label', 'categories', 'mode', 'instructions', 'sourceUrl', 'reviewedAt', 'address', 'directions', 'fieldEvidence', ...fields]);
const mail = /^mailto:[a-zA-Z0-9.!#$'*+/=_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?\.[a-zA-Z]{2,63}$/;
const sms = /^sms:(?:\+[1-9]\d{6,14}|\d{3,6})$/;
export function isSafeServiceAction(action) {
  return Boolean(action && text(action.label, 100) && (publicUrl(action.href) || action.kind === 'contact' && (mail.test(action.href) || sms.test(action.href))));
}
export function validateFieldEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence) || !publicUrl(evidence.sourceUrl) || !text(evidence.scope, 500) || !verificationStates.has(evidence.verification)) return 'Field evidence needs a source, check scope and verification state.';
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(evidence.checkedAt || '') || !Number.isFinite(Date.parse(evidence.checkedAt)) || new Date(evidence.checkedAt).toISOString().slice(0, 10) !== evidence.checkedAt.slice(0, 10)) return 'Field evidence needs a real UTC checked-at timestamp.';
  return null;
}

export function validateServiceAccess(resource) {
  if (!resource || !Object.hasOwn(resource, 'serviceAccess')) return null;
  if (!Array.isArray(resource.serviceAccess) || !resource.serviceAccess.length || resource.serviceAccess.length > 12) return 'Service access must contain 1–12 reviewed routes.';
  const ids = new Set();
  for (const route of resource.serviceAccess) {
    if (!route || typeof route !== 'object' || Array.isArray(route) || Object.keys(route).some(field => !routeFields.has(field)) || !text(route.id, 80) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(route.id) || ids.has(route.id)) return 'Service access needs supported fields and unique stable route IDs.';
    ids.add(route.id);
    if (!text(route.label, 100) || !modes.has(route.mode) || !text(route.instructions)) return 'Service access needs a label, supported access mode and instructions.';
    if (!Array.isArray(route.categories) || !route.categories.length || route.categories.length > 12 || new Set(route.categories).size !== route.categories.length || route.categories.some(category => ![resource.category, ...(resource.secondaryCategories || [])].includes(category))) return 'Service access needs explicit service categories.';
    if (!publicUrl(route.sourceUrl) || !/^\d{4}-\d{2}-\d{2}$/.test(route.reviewedAt || '') || !Number.isFinite(Date.parse(route.reviewedAt)) || new Date(route.reviewedAt).toISOString().slice(0, 10) !== route.reviewedAt) return 'Service access needs an HTTPS source and substantive review date.';
    if (['walk-in', 'intake'].includes(route.mode)) {
      if (resource.locationPrecision === 'contact-only' || resource.kind !== 'direct') return 'Only direct physical listings can have physical service access.';
      if (!text(route.address, 400) || route.address.length < 8 || !route.address.includes(',') || /^https?:|\bP\.?\s*O\.?\s*Box\b/i.test(route.address)) return 'Physical service access needs a complete source-backed operating address.';
    } else if (route.address != null && route.address !== '') return 'Nonphysical or confidential service access must not publish an address.';
    if (route.directions != null && (typeof route.directions !== 'boolean' || !['walk-in', 'intake'].includes(route.mode))) return 'Directions require an explicit physical service route.';
    for (const field of ['entrance', 'eligibility', 'intake', 'capacity', 'hours']) if (route[field] != null && !text(route[field])) return 'Service access facts must be bounded plain text.';
    if (route.intakeCutoff != null && !validScheduleTime(route.intakeCutoff)) return 'Intake cutoff needs an explicit local HH:MM time.';
    if (route.intakeCutoff && !route.schedule?.timeZone) return 'Intake cutoff needs the service local time zone.';
    if (route.documents != null && (!Array.isArray(route.documents) || route.documents.length > 12 || route.documents.some(value => !text(value, 200)))) return 'Required documents must be a bounded list.';
    if (route.schedule != null && validateSchedule(route.schedule)) return validateSchedule(route.schedule);
    if (route.fieldEvidence != null) {
      if (typeof route.fieldEvidence !== 'object' || Array.isArray(route.fieldEvidence) || Object.keys(route.fieldEvidence).length > fields.size) return 'Field evidence must be a bounded field map.';
      for (const [field, evidence] of Object.entries(route.fieldEvidence)) if (!fields.has(field) || route[field] == null || validateFieldEvidence(evidence)) return 'Service field evidence must describe an existing supported field with a valid source, timestamp and scope.';
    }
    if (route.contacts != null && (!Array.isArray(route.contacts) || route.contacts.length > 8 || route.contacts.some(contact => !contact || !text(contact.label, 100) || !['email', 'sms', 'chat', 'online'].includes(contact.type) || !(contact.type === 'email' ? mail.test(contact.url) : contact.type === 'sms' ? sms.test(contact.url) : publicUrl(contact.url))))) return 'Service contacts need reviewed labels and safe matching contact URLs.';
  }
  return null;
}

const mapUrl = (destination, provider) => provider === 'apple'
  ? `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}&dirflg=d`
  : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;

export function serviceActions(resource, { mapProvider = 'google', locale = 'en' } = {}) {
  if (Object.hasOwn(resource || {}, 'serviceAccess')) {
    if (validateServiceAccess(resource)) return [];
    return resource.serviceAccess.flatMap(route => [{
      label: route.mode === 'walk-in' && route.directions !== false ? t('directionsTo', { service: route.label.charAt(0).toLowerCase() + route.label.slice(1) }, locale) : t('detailsFor', { service: route.label }, locale),
      href: route.mode === 'walk-in' && route.directions !== false ? mapUrl(route.address, mapProvider) : new URL(route.sourceUrl).href,
      kind: route.mode === 'walk-in' && route.directions !== false ? 'directions' : 'details',
      routeId: route.id,
      address: route.address || '',
      instructions: route.instructions,
      categories: route.categories
    }, ...(route.mode === 'intake' && route.directions === true ? [{ label: t('directionsTo', { service: route.label.charAt(0).toLowerCase() + route.label.slice(1) }, locale), href: mapUrl(route.address, mapProvider), kind: 'directions', routeId: route.id }] : []), ...(route.contacts || []).map(contact => ({ label: contact.label, href: contact.url, kind: 'contact', routeId: route.id }))]);
  }
  if (resource?.kind !== 'direct' || (resource.locationPrecision && resource.locationPrecision !== 'exact') || !hasMapCoordinates(resource)) return [];
  return [{ label: t('directions', {}, locale), href: mapUrl(`${resource.lat},${resource.lng}`, mapProvider), kind: 'directions' }];
}

export function beforeYouGoFacts(resource, { locale = 'en' } = {}) {
  if (!resource || typeof resource !== 'object') return [];
  if (!Object.hasOwn(resource, 'serviceAccess')) {
    if (!publicUrl(resource.sourceUrl)) return [];
    const fact = (key, value) => ({ key, label: t(key, {}, locale), value });
    return [{ routeId: 'legacy', label: resource.name || t('providerDetails', {}, locale),
      address: resource.kind === 'direct' ? resource.address || '' : resource.coverageNote || resource.address || resource.country || '',
      addressLabel: t(resource.kind === 'direct' ? 'address' : 'coverage', {}, locale),
      instructions: resource.availabilityNote || '',
      facts: [fact('access', resource.accessType || t('accessUnknown', {}, locale)), fact('eligibility', resource.eligibility || t('eligibilityUnknown', {}, locale)), fact('hours', resource.hours || t('hoursUnknown', {}, locale)), ...(resource.costNote ? [fact('cost', resource.costNote)] : [])],
      fieldEvidence: {}, sourceUrl: resource.sourceUrl, reviewedAt: resource.lastChecked || '',
    }];
  }
  if (validateServiceAccess(resource)) return [];
  return resource.serviceAccess.map(route => {
    const facts = [];
    const add = (key, value) => { if (value) facts.push({ key, label: t(key, {}, locale), value }); };
    add('entrance', route.entrance); add('eligibility', route.eligibility); add('intake', route.intake);
    add('documents', route.documents?.join('; '));
    add('hours', route.schedule ? scheduleText(route.schedule, { locale, nextDay: t('nextDay', {}, locale), exceptions: t('exceptions', {}, locale), season: t('season', {}, locale) }) : route.hours || t('hoursUnknown', {}, locale));
    add('intakeCutoff', route.intakeCutoff ? `${route.intakeCutoff} (${route.schedule.timeZone})` : ''); add('capacity', route.capacity);
    add('contact', route.contacts?.map(contact => `${contact.label}: ${contact.url}`).join('; '));
    return { routeId: route.id, label: route.label, address: route.address || '', instructions: route.instructions, facts, fieldEvidence: route.fieldEvidence || {}, sourceUrl: route.sourceUrl, reviewedAt: route.reviewedAt };
  });
}

export function serviceScheduleStatus(route, { now = new Date(), locale = 'en' } = {}) {
  const evidence = route?.fieldEvidence?.schedule;
  const verified = evidence && !validateFieldEvidence(evidence) && ['source-reviewed', 'provider-confirmed'].includes(evidence.verification);
  const status = evaluateSchedule(route?.schedule, { now, verified });
  return { ...status, label: t(status.state === 'scheduled-open' ? 'scheduledOpen' : status.state === 'scheduled-closed' ? 'scheduledClosed' : 'scheduleUnknown', {}, locale) };
}

export function serviceAccessSummary(resource, { locale = 'en' } = {}) {
  if (!resource?.serviceAccess || validateServiceAccess(resource)) return '';
  return beforeYouGoFacts(resource, { locale }).map(route => `${route.label}: ${[route.address, route.instructions, ...route.facts.filter(fact => fact.key !== 'hours' || resource.serviceAccess.some(item => item.id === route.routeId && (item.schedule || item.hours))).map(fact => `${fact.label}: ${fact.value}`)].filter(Boolean).join('. ')} ${t('source', {}, locale)}: ${route.sourceUrl} (${t('reviewed', {}, locale).toLowerCase()} ${route.reviewedAt}).`).join(' | ');
}

export function serviceAccessNotice(resource, { locale = 'en' } = {}) {
  return Object.hasOwn(resource || {}, 'serviceAccess') ? t('serviceRoutesNotice', {}, locale) : '';
}
