import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceBeforeYouGoMarkup } from '../scripts/service-before-you-go.mjs';
import { resources } from '../src/data/resources.js';

const routeMarkup = (html, id) => html.match(new RegExp(`<article data-service-route="${id}">([\\s\\S]*?)</article>`))?.[1] || '';

test('route actions follow the matching intake facts, with distinct Bowery destinations', () => {
  const html = serviceBeforeYouGoMarkup(resources.find(resource => resource.id === 'bowery-mission'));
  const meal = routeMarkup(html, 'meals'), shelter = routeMarkup(html, 'shelter');
  assert.match(meal, /Directions to meal service/);
  assert.match(meal, /destination=227%20Bowery%2C%20New%20York%2C%20NY%2010002/);
  assert.doesNotMatch(meal, /destination=90%20Lafayette/);
  assert.match(shelter, /Shelter intake details/);
  assert.match(shelter, /Directions to shelter intake/);
  assert.match(shelter, /destination=90%20Lafayette%20Street%2C%20New%20York%2C%20NY%2010013/);
  assert.doesNotMatch(shelter, /destination=227%20Bowery/);
  assert.ok(shelter.indexOf('data-service-route-actions') > shelter.indexOf('</dl>'), 'intake facts precede the decision to travel');
  assert.doesNotMatch(html, /href="tel:/, 'a general organization phone cannot be guessed as a route-specific intake contact');
});

test('Beacon actions retain their own meal or housing instructions and Spanish interface labels', () => {
  const html = serviceBeforeYouGoMarkup(resources.find(resource => resource.id === 'beacon-houston'));
  const breakfast = routeMarkup(html, 'breakfast'), housing = routeMarkup(html, 'housing-assessment');
  assert.match(breakfast, /Caroline Street/);
  assert.match(breakfast, /Directions to breakfast/);
  assert.match(breakfast, /data-i18n-es="Cómo llegar a breakfast"/);
  assert.doesNotMatch(breakfast, /Housing assessment intake details/);
  assert.match(housing, /first 25 people/);
  assert.match(housing, /Housing assessment intake details/);
  assert.doesNotMatch(housing, /Directions to breakfast/);
});

test('malformed explicit routes fail closed while valid provider labels and URLs are escaped', () => {
  const original = resources.find(resource => resource.id === 'beacon-houston');
  const item = structuredClone(original);
  item.serviceAccess = [item.serviceAccess[0]];
  item.serviceAccess[0].label = 'Breakfast <img src=x onerror=alert(1)> & lunch';
  item.serviceAccess[0].sourceUrl = 'https://example.org/help?name="one"&meal=two';
  const html = serviceBeforeYouGoMarkup(item);
  assert.doesNotMatch(html, /<img|name="one"/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &amp; lunch/);
  assert.match(html, /name=&quot;one&quot;&amp;meal=two/);
  item.serviceAccess[0].sourceUrl = 'javascript:alert(1)';
  assert.equal(serviceBeforeYouGoMarkup(item), '');
});
