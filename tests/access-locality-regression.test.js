import test from 'node:test';
import assert from 'node:assert/strict';
import { relatedResources } from '../scripts/related-resources.mjs';
import { groupLocalities } from '../scripts/locality-groups.mjs';
import { resources } from '../src/data/resources.js';

test('Bowery related help excludes unrelated distant municipal services', () => {
  const bowery = resources.find(item => item.id === 'bowery-mission');
  const related = relatedResources(bowery, resources).map(({ candidate }) => candidate);
  assert.ok(related.length > 0);
  for (const id of ['boston-homeless-services', 'seattle-cid-resource-guide', 'st-anthony-san-francisco', 'blanchet-house-portland']) {
    assert.ok(!related.some(item => item.id === id), id);
  }
  assert.ok(related.every(item => ['New York', 'New York City', 'United States'].includes(item.city) || /Countrywide/.test(item.coverageNote || '')), related.map(item => `${item.id}: ${item.city}`).join(', '));
});

test('national, regional and online placeholders never generate municipal pages', () => {
  const fixtures = [
    { id:'national', city:'United States', country:'United States', kind:'locator' },
    { id:'national-case', city:'UNITED STATES', country:'United States', kind:'locator' },
    { id:'national-text', city:'Washington, DC', country:'United States', kind:'locator', coverageNote:'Countrywide guidance; a representative map point.' },
    { id:'online', city:'Online', country:'Canada', kind:'network' },
    { id:'regional', city:'Los Angeles County', country:'United States', kind:'locator' },
    { id:'real', city:'Boston', country:'United States', kind:'direct', address:'1 Main Street, Boston, MA 02108' },
  ];
  assert.deepEqual(groupLocalities(fixtures).flatMap(group => group.items.map(item => item.id)), ['real']);
});

test('national finders are offered after relevant local help, without padding with distant sites', () => {
  const source={id:'source',name:'Source',category:'shelter',kind:'direct',city:'Boston',country:'United States',address:'Boston, MA 02108',lat:42.36,lng:-71.06};
  const local={...source,id:'local',name:'Local',lat:42.37};
  const distant={...source,id:'distant',name:'Distant',city:'Seattle',lat:47.61,lng:-122.33};
  const wrongCityFinder={...distant,id:'seattle-finder',kind:'locator',locationPrecision:'coverage'};
  const national={...source,id:'national',name:'National',kind:'locator',city:'United States',locationPrecision:'coverage'};
  assert.deepEqual(relatedResources(source,[distant,wrongCityFinder,national,local]).map(({candidate})=>candidate.id),['local','national']);
});
