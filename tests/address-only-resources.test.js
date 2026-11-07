import test from 'node:test';
import assert from 'node:assert/strict';
import { validateResourceLocation, hasMapCoordinates, isContactOnly } from '../src/utils/resource-location.js';
import { validateServiceAccess, serviceActions } from '../src/utils/service-access.js';
import { resourceDistanceKm } from '../src/utils/geo.js';

const site = {
  id: 'reviewed-address-fixture', kind: 'direct', locationPrecision: 'address', lat: null, lng: null,
  city: 'Example City', country: 'United States', address: '12 Main Street, Example City, MA 02108', category: 'food',
  serviceAccess: [{ id: 'meals', label: 'Meals', categories: ['food'], mode: 'walk-in', address: '12 Main Street, Example City, MA 02108', instructions: 'Check the published meal hours.', sourceUrl: 'https://example.org/meals', reviewedAt: '2026-11-07' }],
};

test('a reviewed physical address provides directions without inventing coordinates or finder classification', () => {
  assert.equal(validateResourceLocation(site), null);
  assert.equal(validateServiceAccess(site), null);
  assert.equal(isContactOnly(site), false);
  assert.equal(hasMapCoordinates(site), false);
  assert.equal(resourceDistanceKm({ lat: 42.3, lng: -71.1 }, site), null);
  assert.equal(new URL(serviceActions(site)[0].href).searchParams.get('destination'), site.address);
  assert.equal(hasMapCoordinates({ ...site, lat: 0, lng: 0 }), false, 'stale coordinates cannot enter the globe');
});

test('address-only sites reject coordinate fabrication, mailing addresses and generic unreviewed routes', () => {
  for (const changes of [{ kind: 'locator' }, { lat: 0 }, { lng: 0 }, { city: '' }, { country: '' }, { address: 'Boston' }, { address: 'PO Box 12, Example City' }, { serviceAccess: undefined }, { serviceAccess: [{ ...site.serviceAccess[0], address: 'Other Street, Example City' }] }]) assert.ok(validateResourceLocation({ ...site, ...changes }), JSON.stringify(changes));
  for (const changes of [{ sourceUrl: 'javascript:alert(1)' }, { address: 'Main Street' }, { address: 'P.O. Box 12, Example City' }]) assert.ok(validateServiceAccess({ ...site, serviceAccess: [{ ...site.serviceAccess[0], ...changes }] }));
});
