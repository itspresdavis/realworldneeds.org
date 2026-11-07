import test from 'node:test';
import assert from 'node:assert/strict';
import { beforeYouGoFacts, isSafeServiceAction, serviceActions, serviceAccessSummary, serviceScheduleStatus, validateServiceAccess } from '../src/utils/service-access.js';

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

const evidence = { sourceUrl: 'https://example.org/meals', checkedAt: '2026-11-07T05:00:00Z', scope: 'Meal schedule and registration cutoff only.', verification: 'source-reviewed' };
const accessFacts = () => route({ entrance: 'Use the Caroline Street entrance.', eligibility: 'Adults aged 18 or over.', intake: 'Register at the entrance. Places are limited.', documents: ['No identification required'], capacity: 'First come, first served; service is not guaranteed.', intakeCutoff: '11:30', schedule: { timeZone: 'America/Chicago', complete: true, weekly: [{ days: [2, 3, 4, 5, 6], opens: '11:00', closes: '12:00' }] }, fieldEvidence: { schedule: { ...evidence } } });

test('service facts and field evidence survive serialization without refreshing broad review dates', () => {
  const item = resource({ lastChecked: '2026-08-01', serviceAccess: [accessFacts()] });
  const reloaded = JSON.parse(JSON.stringify(item));
  assert.equal(validateServiceAccess(reloaded), null);
  const facts = beforeYouGoFacts(reloaded)[0];
  assert.equal(facts.facts.find(item => item.key === 'entrance').value, 'Use the Caroline Street entrance.');
  assert.equal(facts.facts.find(item => item.key === 'eligibility').value, 'Adults aged 18 or over.');
  assert.match(facts.facts.find(item => item.key === 'hours').value, /America\/Chicago/);
  assert.match(serviceAccessSummary(reloaded), /Intake cutoff: 11:30/);
  assert.match(serviceAccessSummary(reloaded), /First come, first served/);
  assert.equal(reloaded.lastChecked, '2026-08-01');
  assert.deepEqual(facts.fieldEvidence.schedule, evidence);
});

test('derived service hours require substantive schedule evidence, not a link check or another field review', () => {
  const value = accessFacts();
  const options = { now: new Date('2026-11-07T17:15:00Z') };
  assert.equal(serviceScheduleStatus(value, options).state, 'scheduled-open');
  assert.match(serviceScheduleStatus(value, options).label, /availability is not confirmed/);
  for (const fieldEvidence of [undefined, { schedule: { ...evidence, verification: 'link-checked' } }, { entrance: evidence }]) assert.equal(serviceScheduleStatus({ ...value, fieldEvidence }, options).state, 'unknown');
  assert.match(serviceScheduleStatus(value, { ...options, locale: 'es' }).label, /no está confirmada/);
});

test('malformed optional fields fail closed instead of silently dropping decisive restrictions', () => {
  for (const changes of [{ eligibility: 18 }, { entrance: ' ' }, { intake: '<valid plain text>\ncontrol' }, { intakeCutoff: '25:00' }, { schedule: {} }, { documents: [null] }, { inventedField: true }, { fieldEvidence: { schedule: { ...evidence, checkedAt: '2026-02-30T00:00:00Z' } } }, { fieldEvidence: { unknownField: evidence } }]) {
    const item = resource({ serviceAccess: [accessFacts(), route(changes)] });
    item.serviceAccess[1].id = 'other';
    assert.ok(validateServiceAccess(item), JSON.stringify(changes));
    assert.deepEqual(serviceActions(item), []);
    assert.deepEqual(beforeYouGoFacts(item), []);
  }
});

test('non-phone channels use reviewed contact types and reject executable or injected URLs', () => {
  const contacts = [{ type: 'email', label: 'Email intake', url: 'mailto:help@example.org' }, { type: 'sms', label: 'Text intake', url: 'sms:+16175550100' }, { type: 'chat', label: 'Online chat', url: 'https://example.org/chat' }];
  const item = resource({ serviceAccess: [route({ contacts })] });
  assert.equal(validateServiceAccess(item), null);
  const actions = serviceActions(item);
  assert.deepEqual(actions.slice(1).map(action => action.href), contacts.map(contact => contact.url));
  assert.ok(actions.every(isSafeServiceAction));
  for (const contact of [{ type: 'email', label: 'Bad', url: 'mailto:help@example.org?bcc=someone@example.org' }, { type: 'sms', label: 'Bad', url: 'sms:+16175550100?body=private' }, { type: 'online', label: 'Bad', url: 'javascript:alert(1)' }, { type: 'email', label: 'Bad', url: 'mailto:help@example.org%0aBCC:other@example.org' }]) {
    assert.ok(validateServiceAccess(resource({ serviceAccess: [route({ contacts: [contact] })] })));
    assert.equal(isSafeServiceAction({ label: contact.label, href: contact.url, kind: 'contact' }), false);
  }
});

test('an explicitly reviewed intake destination offers details before its own directions', () => {
  const item = resource(); item.serviceAccess[1].directions = true;
  const actions = serviceActions(item);
  assert.equal(actions[1].label, 'Shelter intake details');
  assert.equal(actions[2].label, 'Directions to shelter intake');
  assert.equal(new URL(actions[2].href).searchParams.get('destination'), '90 Lafayette Street, New York, NY');
  assert.equal(actions[2].routeId, 'shelter');
  assert.match(serviceActions(item, { locale: 'es' })[2].label, /Cómo llegar/);
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
  for (const [href, allowed] of [['mailto:help@example.org', true], ['sms:+16175550100', true], ['mailto:help@example.org?bcc=other@example.org', false], ['sms:+16175550100?body=private', false], ['javascript:alert(1)', false]]) {
    const contact = context.createResultRow({ ...indexed, serviceActions: [{ label: 'Contact option', href, kind: 'contact' }] }, {});
    assert.equal(walk(contact).some(node => node.textContent === 'Contact option'), allowed, href);
  }
});
