import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/service-actions.js', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('  const publicDetails ='), source.indexOf('  const fallbackCopy ='));
const row = (label, value, links = []) => ({
  querySelector: selector => selector === 'dt' ? { textContent: label } : selector === 'dd' ? { textContent: value } : links[0] ? { href: links[0] } : null,
  querySelectorAll: () => links.map(href => ({ href })),
  hasAttribute: key => key === 'data-service-location-facts' && label === 'Service locations',
});
const route = (label, rows, evidence = [], actions = []) => ({
  querySelector: () => ({ textContent: label }),
  querySelectorAll: selector => selector === 'dl > div' ? rows : selector === 'details li' ? evidence : actions,
});

test('copied access facts retain each service, entrance, schedule, evidence and non-phone route exactly once', () => {
  const sourceUrl = 'https://example.org/services';
  const evidence = { textContent: 'schedule · 2026-11-07 — Schedule only; no live availability confirmation.', querySelectorAll: () => [{ href: sourceUrl }] };
  const routes = [
    route('Breakfast', [row('Access location', '12 Main Street, Example City'), row('Entrance', 'Use Caroline Street'), row('Hours', 'Tuesday–Saturday 7–9:30 a.m. America/Chicago'), row('Contact', 'Email intake', ['mailto:help@example.org'])], [evidence]),
    route('Shelter intake', [row('Access location', '90 Other Street, Example City'), row('Intake', 'Registration at 3 p.m.; no admission guarantee.')], [], [
      {textContent:'Directions to shelter intake',href:'https://www.google.com/maps/dir/?api=1&destination=90%20Other%20Street'},
      {textContent:'Unsafe injected link',href:'javascript:alert(1)'}
    ]),
  ];
  const record = [row('Service locations', 'Old generic location summary'), row('Cost', 'Free services')];
  const context = vm.createContext({ title: 'Fixture', place: 'Example City', listingUrl: 'https://www.realworldneeds.org/service/fixture', officialSource: sourceUrl,
    document: { querySelector: () => null, querySelectorAll: selector => selector.includes('[data-service-route]') ? routes : record },
  });
  vm.runInContext(`${body}\nglobalThis.copy = publicDetails;`, context);
  const copied = context.copy();
  assert.match(copied, /Breakfast\nAccess location: 12 Main Street/);
  assert.match(copied, /Shelter intake\nAccess location: 90 Other Street/);
  assert.match(copied, /Entrance: Use Caroline Street/);
  assert.match(copied, /Contact: Email intake \(mailto:help@example.org\)/);
  assert.match(copied, /Schedule only; no live availability confirmation/);
  assert.match(copied, /Directions to shelter intake: https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=90%20Other%20Street/);
  assert.doesNotMatch(copied, /Unsafe injected link|javascript:/);
  assert.equal(copied.split('Use Caroline Street').length - 1, 1);
  assert.doesNotMatch(copied, /Old generic location summary/);
});
