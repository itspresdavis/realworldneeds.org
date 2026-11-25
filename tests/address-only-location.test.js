import test from 'node:test';
import assert from 'node:assert/strict';
import { resources } from '../src/data/resources.js';
import { hasMapCoordinates, validateResourceLocation } from '../src/utils/resource-location.js';
import { serviceActions } from '../src/utils/service-access.js';
import { resourceDistanceKm } from '../src/utils/geo.js';
import { serviceContactMarkup } from '../scripts/service-contact.mjs';

test('reviewed address gives a physical route but does not justify a pin or a distance', () => {
  const examples = resources.filter(row => row.locationPrecision === 'address');
  for (const id of ['amos-house-providence-meals', 'taunton-community-table-meals']) assert.ok(examples.some(row => row.id === id));
  for (const row of examples) {
    assert.equal(validateResourceLocation(row), null);
    assert.equal(hasMapCoordinates(row), false);
    assert.equal(resourceDistanceKm({ lat: 41.9, lng: -71.1 }, row), null);
    assert.match(serviceContactMarkup(row), /Choose service access/);
    if (row.serviceAccess.some(route => route.mode === 'walk-in' || route.mode === 'intake' && route.directions === true)) {
      assert.ok(serviceActions(row).some(action => new URL(action.href).searchParams.get('destination') === row.address));
    } else {
      assert.ok(serviceActions(row).every(action => action.href === row.sourceUrl), 'Appointment-only access opens provider intake; it must not invent walk-in directions');
    }
    assert.doesNotMatch(serviceContactMarkup(row), /Interactive map|not a walk-in location|null%2Cnull/);
    for (const variant of [{ lat: 41.9 }, { kind: 'locator' }, { address: 'PO Box 5, Taunton' }, { serviceAccess: [] }]) {
      assert.notEqual(validateResourceLocation({ ...row, ...variant }), null);
    }
  }
});
