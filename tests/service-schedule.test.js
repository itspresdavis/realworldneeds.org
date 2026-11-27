import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateSchedule, scheduleText, validateSchedule } from '../src/utils/service-schedule.js';

const schedule = changes => ({ timeZone: 'America/New_York', complete: true, weekly: [{ days: [1, 2, 3, 4, 5], opens: '09:00', closes: '17:00' }], ...changes });
const state = (value, instant, verified = true) => evaluateSchedule(value, { now: new Date(instant), verified });

test('published hours require reviewed evidence and always leave availability unconfirmed', () => {
  assert.equal(state(schedule(), '2026-11-06T15:00Z', false).state, 'unknown');
  const result = state(schedule(), '2026-11-06T15:00Z');
  assert.deepEqual(result, { state: 'scheduled-open', availability: 'unconfirmed', localDate: '2026-11-06', timeZone: 'America/New_York' });
  assert.equal(state(schedule(), '2026-11-06T22:00Z').state, 'scheduled-closed');
  assert.equal(state(schedule(), '2026-11-07T15:00Z').state, 'scheduled-closed');
});

test('time zone and local date determine schedule rather than browser date', () => {
  const value = schedule({ timeZone: 'America/Los_Angeles', weekly: [{ days: [1], opens: '17:00', closes: '23:00' }] });
  assert.equal(state(value, '2026-11-03T03:00Z').state, 'scheduled-open');
  assert.equal(state(value, '2026-11-03T03:00Z').localDate, '2026-11-02');
});

test('overnight intervals cross midnight and end exclusively at the stated time', () => {
  const value = schedule({ weekly: [{ days: [5], opens: '22:00', closes: '06:00', endsNextDay: true }] });
  assert.equal(state(value, '2026-11-07T03:00Z').state, 'scheduled-open');
  assert.equal(state(value, '2026-11-07T10:59Z').state, 'scheduled-open');
  assert.equal(state(value, '2026-11-07T11:00Z').state, 'scheduled-closed');
  assert.equal(state(value, '2026-11-08T03:00Z').state, 'scheduled-closed');
});

test('date exceptions replace their entire local day, including overnight carry-over', () => {
  const value = schedule({ weekly: [{ days: [5], opens: '22:00', closes: '06:00', endsNextDay: true }], exceptions: [{ date: '2026-11-07', closed: true }] });
  assert.equal(state(value, '2026-11-07T05:30Z').state, 'scheduled-closed');
  value.exceptions = [{ date: '2026-11-07', intervals: [{ opens: '12:00', closes: '14:00' }] }];
  assert.equal(state(value, '2026-11-07T18:00Z').state, 'scheduled-open');
  assert.equal(state(value, '2026-11-07T05:30Z').state, 'scheduled-closed');
});

test('DST transitions use actual local wall time, including both repeated fall-back hours', () => {
  const value = schedule({ weekly: [{ days: [0], opens: '01:00', closes: '03:00' }] });
  for (const instant of ['2026-11-01T05:30Z', '2026-11-01T06:30Z']) assert.equal(state(value, instant).state, 'scheduled-open');
  assert.equal(state(value, '2026-03-08T06:59Z').state, 'scheduled-open');
  assert.equal(state(value, '2026-03-08T07:00Z').state, 'scheduled-closed');
});

test('unknown, malformed and out-of-season schedules do not invent opening status', () => {
  const invalid = [null, {}, schedule({ timeZone: '' }), schedule({ timeZone: 'Madeup/Zone' }), schedule({ weekly: [{ days: [1], opens: '22:00', closes: '06:00' }] }), schedule({ weekly: [{ days: [7], opens: '09:00', closes: '17:00' }] }), schedule({ exceptions: [{ date: '2026-02-30', closed: true }] }), schedule({ exceptions: [{ date: '2026-11-07', closed: true, intervals: [] }] }), schedule({ validFrom: '2026-11-09', validThrough: '2026-11-01' })];
  for (const value of invalid) { assert.ok(validateSchedule(value)); assert.equal(state(value, '2026-11-07T15:00Z').state, 'unknown'); }
  assert.equal(state(schedule({ validThrough: '2026-10-31' }), '2026-11-07T15:00Z').state, 'unknown');
  assert.equal(state(schedule(), 'bad').state, 'unknown');
  assert.equal(state(schedule({ timeZone: 'UTC' }), '2026-11-06T10:00Z').state, 'scheduled-open', 'explicitly sourced UTC is valid; missing zones never default to it');
});

test('schedule formatting preserves seasonal exceptions, zone and overnight interpretation', () => {
  const value = schedule({ weekly: [{ days: [5], opens: '22:00', closes: '06:00', endsNextDay: true }], exceptions: [{ date: '2026-11-07', closed: true, note: 'Published closure' }], validThrough: '2026-12-31' });
  const text = scheduleText(value);
  for (const part of ['Fri', 'next day', 'America/New_York', '2026-11-07: closed', 'Published closure', '2026-12-31']) assert.ok(text.includes(part), part);
  assert.match(scheduleText(value, { locale: 'es' }), /vie/);
});

test('partially structured hours never imply closure outside the known intervals', () => {
  const value = schedule({ complete: false, text: 'Saturday hours vary; consult the published first-Saturday exception.' });
  assert.equal(state(value, '2026-11-06T15:00Z').state, 'scheduled-open');
  assert.equal(state(value, '2026-11-07T15:00Z').state, 'unknown');
  value.exceptions = [{ date: '2026-11-07', closed: true }];
  assert.equal(state(value, '2026-11-07T15:00Z').state, 'scheduled-closed');
});

test('published narrative punctuation is preserved without doubled sentence stops', () => {
  const text = scheduleText(schedule({ text: 'Weekday meals end at 5 p.m.' }));
  assert.match(text, /5 p\.m\. Mon/);
  assert.doesNotMatch(text, /\.\./);
});
