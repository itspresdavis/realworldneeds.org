import { hasMapCoordinates } from './resource-location.js';

// One source-backed access contract for build output, finder actions and exports.
// An explicit but invalid contract must never fall back to organization coordinates.
const modes = new Set(['walk-in', 'intake', 'contact', 'confidential', 'unknown', 'delivery']);
const text = (value, max = 1600) => typeof value === 'string' && value.trim() === value && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const publicUrl = value => {
  if (!text(value, 2048) || !value.startsWith('https://')) return false;
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
};

export function validateServiceAccess(resource) {
  if (!resource || !Object.hasOwn(resource, 'serviceAccess')) return null;
  if (!Array.isArray(resource.serviceAccess) || !resource.serviceAccess.length || resource.serviceAccess.length > 12) return 'Service access must contain 1–12 reviewed routes.';
  const ids = new Set();
  for (const route of resource.serviceAccess) {
    if (!route || typeof route !== 'object' || !text(route.id, 80) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(route.id) || ids.has(route.id)) return 'Service access needs unique stable route IDs.';
    ids.add(route.id);
    if (!text(route.label, 100) || !modes.has(route.mode) || !text(route.instructions)) return 'Service access needs a label, supported access mode and instructions.';
    if (!Array.isArray(route.categories) || !route.categories.length || route.categories.length > 12 || new Set(route.categories).size !== route.categories.length || route.categories.some(category => ![resource.category, ...(resource.secondaryCategories || [])].includes(category))) return 'Service access needs explicit service categories.';
    if (!publicUrl(route.sourceUrl) || !/^\d{4}-\d{2}-\d{2}$/.test(route.reviewedAt || '') || !Number.isFinite(Date.parse(route.reviewedAt)) || new Date(route.reviewedAt).toISOString().slice(0, 10) !== route.reviewedAt) return 'Service access needs an HTTPS source and substantive review date.';
    if (['walk-in', 'intake'].includes(route.mode)) {
      if (resource.locationPrecision === 'contact-only' || resource.kind !== 'direct') return 'Only direct physical listings can have physical service access.';
      if (!text(route.address, 400)) return 'Physical service access needs a source-backed address.';
    } else if (route.address != null && route.address !== '') return 'Nonphysical or confidential service access must not publish an address.';
  }
  return null;
}

const mapUrl = (destination, provider) => provider === 'apple'
  ? `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}&dirflg=d`
  : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;

export function serviceActions(resource, { mapProvider = 'google' } = {}) {
  if (Object.hasOwn(resource || {}, 'serviceAccess')) {
    if (validateServiceAccess(resource)) return [];
    return resource.serviceAccess.map(route => ({
      label: route.mode === 'walk-in' ? `Directions to ${route.label.charAt(0).toLowerCase()}${route.label.slice(1)}` : `${route.label} details`,
      href: route.mode === 'walk-in' ? mapUrl(route.address, mapProvider) : new URL(route.sourceUrl).href,
      kind: route.mode === 'walk-in' ? 'directions' : 'details',
      address: route.address || '',
      instructions: route.instructions,
      categories: route.categories
    }));
  }
  if (resource?.kind !== 'direct' || (resource.locationPrecision && resource.locationPrecision !== 'exact') || !hasMapCoordinates(resource)) return [];
  return [{ label: 'Directions', href: mapUrl(`${resource.lat},${resource.lng}`, mapProvider), kind: 'directions' }];
}

export function serviceAccessSummary(resource) {
  if (!resource?.serviceAccess || validateServiceAccess(resource)) return '';
  return resource.serviceAccess.map(route => `${route.label}: ${[route.address, route.instructions].filter(Boolean).join('. ')} Source: ${route.sourceUrl} (reviewed ${route.reviewedAt}).`).join(' | ');
}

export function serviceAccessNotice(resource) {
  return Object.hasOwn(resource || {}, 'serviceAccess') ? 'Services use different access routes. Choose the service you need and check its intake details before traveling.' : '';
}
