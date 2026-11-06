import test from 'node:test';
import assert from 'node:assert/strict';
import { serviceActions, serviceAccessSummary, validateServiceAccess } from '../src/utils/service-access.js';

const route = (changes = {}) => ({ id: 'meals', label: 'Meal service', categories: ['food'], mode: 'walk-in', address: '227 Bowery, New York, NY 10002', sourceUrl: 'https://www.bowery.org/get-help/', reviewedAt: '2026-11-06', instructions: 'Confirm current hours before traveling.', ...changes });
const resource = (changes = {}) => ({ id: 'multi-site', name: 'Example organization', kind: 'direct', category: 'food', secondaryCategories: ['shelter'], lat: 40.72, lng: -73.99, serviceAccess: [route(), route({ id: 'shelter', label: 'Shelter intake', categories: ['shelter'], mode: 'intake', address: '90 Lafayette Street, New York, NY', instructions: 'Check intake times and availability.' })], ...changes });

test('multi-site organization offers labeled service choices without using organization coordinates', () => {
  const item = resource();
  assert.equal(validateServiceAccess(item), null);
  const actions = serviceActions(item);
  assert.equal(actions[0].label, 'Directions to meal service');
  assert.equal(new URL(actions[0].href).searchParams.get('destination'), item.serviceAccess[0].address);
  assert.equal(actions[1].label, 'Shelter intake details');
  assert.equal(actions[1].href, item.serviceAccess[1].sourceUrl);
  assert.ok(actions.every(action => !action.href.includes('40.72')));
  assert.match(serviceAccessSummary(item), /Meal service: 227 Bowery/);
  assert.match(serviceAccessSummary(item), /Shelter intake: 90 Lafayette/);
});

test('changed source-backed addresses are authoritative even without coordinates', () => {
  const item = resource({ lat: null, lng: null });
  item.serviceAccess[0].address = '5 New Street, Example City';
  assert.equal(new URL(serviceActions(item)[0].href).searchParams.get('destination'), '5 New Street, Example City');
  assert.equal(new URL(serviceActions(item, { mapProvider: 'apple' })[0].href).searchParams.get('daddr'), '5 New Street, Example City');
});

test('contact, confidential, delivery and unknown access never create directions', () => {
  for (const mode of ['contact', 'confidential', 'delivery', 'unknown']) {
    const item = resource({ serviceAccess: [route({ mode, address: undefined })] });
    assert.equal(validateServiceAccess(item), null);
    assert.ok(serviceActions(item).every(action => action.kind === 'details'));
    assert.doesNotMatch(serviceAccessSummary(item), /227 Bowery|40.72/);
  }
});

test('invalid explicit access fails closed instead of reviving organization directions', () => {
  for (const access of [[], null, {}, [route({ sourceUrl: 'javascript:alert(1)' })], [route({ sourceUrl: 'https://user:password@example.org' })], [route({ sourceUrl: 'https://example.org/\nsecret' })], [route({ address: '227\nBowery' })], [route({ mode: 'confidential' })], [route({ address: '' })], [route({ mode: 'unsupported' })], [route({ reviewedAt: 'today' })]]) {
    const item = resource({ serviceAccess: access });
    assert.ok(validateServiceAccess(item));
    assert.deepEqual(serviceActions(item), []);
  }
});

test('single physical site retains maps but area, contact-only and invalid coordinates do not', () => {
  const { serviceAccess: _, ...single } = resource();
  assert.equal(serviceActions(single).length, 1);
  for (const item of [{ ...single, kind: 'locator' }, { ...single, locationPrecision: 'coverage' }, { ...single, locationPrecision: 'contact-only' }, { ...single, lat: null }, { ...single, lat: 100 }]) assert.deepEqual(serviceActions(item), []);
});

test('service categories stay within the listing and physical routes cannot bypass contact-only semantics', () => {
  for (const changes of [{ categories: ['unreviewed'] }, { categories: ['food', 'food'] }]) {
    assert.ok(validateServiceAccess(resource({ serviceAccess: [route(changes)] })));
  }
  for (const changes of [{ locationPrecision: 'contact-only' }, { kind: 'network' }]) {
    assert.ok(validateServiceAccess(resource(changes)));
    assert.deepEqual(serviceActions(resource(changes)), []);
  }
});

test('dynamic directory and Saved rows preserve choices and reject unsafe action URLs', async () => {
  const { readFile } = await import('node:fs/promises');
  const { default: vm } = await import('node:vm');
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.attributes = {}; this.classList = { add() {} }; }
    append(...children) { this.children.push(...children); }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener() {}
  }
  const context = vm.createContext({ document: { createElement: tag => new Element(tag) }, navigator: { onLine: true }, URL });
  const source = await readFile('public/directory-results.js', 'utf8');
  vm.runInContext(`${source.replace('export const createResultRow', 'globalThis.createResultRow')}\n`, context);
  const item = resource();
  const indexed = { ...item, place: 'New York', categoryLabels: ['Food', 'Shelter'], serviceActions: serviceActions(item), serviceAccessSummary: serviceAccessSummary(item) };
  const walk = node => [node, ...node.children.flatMap(walk)];
  const row = context.createResultRow(indexed, {});
  const links = walk(row).filter(node => node.tag === 'a');
  assert.equal(links.find(node => node.textContent === 'Directions to meal service')?.href, serviceActions(item)[0].href);
  assert.equal(links.find(node => node.textContent === 'Shelter intake details')?.href, 'https://www.bowery.org/get-help/');
  assert.ok(walk(row).some(node => /Shelter intake: 90 Lafayette/.test(node.textContent || '')));
  for (const bad of ['javascript:alert(1)', 'https://user:password@example.org/', 'https://example.org/\nsecret']) {
    const unsafe = context.createResultRow({ ...indexed, serviceActions: [{ label: 'Unsafe', href: bad, kind: 'directions' }] }, {});
    assert.ok(walk(unsafe).every(node => node.textContent !== 'Unsafe'));
    assert.ok(walk(unsafe).every(node => !String(node.href).includes('maps/')));
  }
  for (const actions of [null, [], {}]) {
    const invalid = context.createResultRow({ ...indexed, serviceActions: actions }, {});
    assert.ok(walk(invalid).every(node => !String(node.href).includes('maps/')));
  }
});
