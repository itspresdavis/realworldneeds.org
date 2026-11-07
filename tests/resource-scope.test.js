import test from 'node:test';
import assert from 'node:assert/strict';
import {resourceScope, sameMunicipality} from '../src/utils/resource-scope.js';

test('a county service is not national even when legacy address copy says nationwide',()=>{
  assert.equal(resourceScope({kind:'locator',city:'Los Angeles County',country:'United States',address:'Nationwide telephone service covering all of Los Angeles County'}).type,'regional');
});
test('reviewed New York naming variants match without merging different Springfields',()=>{
  assert.equal(sameMunicipality({city:'New York',country:'United States'},{city:'New York City',country:'United States'}),true);
  assert.equal(sameMunicipality({city:'Springfield',country:'United States',address:'Main St, MA 01103'},{city:'Springfield',country:'United States',address:'Main St, IL 62701'}),false);
});
test('contact routes and countrywide headquarters produce coverage labels, not a municipal destination',()=>{
  const scope=resourceScope({kind:'locator',city:'Washington, DC',country:'United States',coverageNote:'Countrywide guidance; the marker is geographic context only.'});
  assert.equal(scope.type,'national');
  assert.match(scope.label,/nationwide information or referral/);
});
