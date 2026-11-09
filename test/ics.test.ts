import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseICS } from '../src/sources/ics-parse.ts';

const feed = [
  'BEGIN:VCALENDAR', 'VERSION:2.0',
  'BEGIN:VEVENT', 'UID:a', 'DTSTART;TZID=Europe/Berlin:20261109T090000', 'DTEND;TZID=Europe/Berlin:20261109T103000', 'SUMMARY:Lecture\\, SE_28', 'LOCATION:Room 1', 'BEGIN:VALARM', 'TRIGGER:-PT10M', 'END:VALARM', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:b', 'DTSTART;VALUE=DATE:20261110', 'DTEND;VALUE=DATE:20261112', 'SUMMARY:Trip', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:c', 'DTSTART:20261109T170000Z', 'DTEND:20261109T180000Z', 'SUMMARY:UTC call', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:w', 'DTSTART;TZID=Europe/Berlin:20261020T180000', 'DTEND;TZID=Europe/Berlin:20261020T190000', 'RRULE:FREQ=WEEKLY;BYDAY=TU,TH;UNTIL=20261231T000000Z', 'EXDATE;TZID=Europe/Berlin:20261112T180000', 'SUMMARY:Gym', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:w', 'RECURRENCE-ID;TZID=Europe/Berlin:20261110T180000', 'DTSTART;TZID=Europe/Berlin:20261110T200000', 'DTEND;TZID=Europe/Berlin:20261110T210000', 'SUMMARY:Gym late', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:d', 'DTSTART;TZID=Europe/Berlin:20261101T080000', 'DURATION:PT30M', 'RRULE:FREQ=DAILY;COUNT=12', 'SUMMARY:Stand', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:y', 'DTSTART;VALUE=DATE:20001111', 'RRULE:FREQ=YEARLY', 'SUMMARY:Birthday', 'END:VEVENT',
  'BEGIN:VEVENT', 'UID:x', 'STATUS:CANCELLED', 'DTSTART:20261109T120000Z', 'SUMMARY:Gone', 'END:VEVENT',
  'END:VCALENDAR',
].join('\r\n');

const from = new Date('2026-11-09T00:00:00+01:00'), to = new Date('2026-11-16T00:00:00+01:00');
const evs = parseICS(feed, from, to);
const t = (title: string) => evs.filter((e) => e.title === title);

test('timed with TZID, UTC, all day', () => {
  assert.equal(t('Lecture, SE_28')[0].start.toISOString(), '2026-11-09T08:00:00.000Z');
  assert.equal(t('Lecture, SE_28')[0].end.toISOString(), '2026-11-09T09:30:00.000Z');
  assert.equal(t('Lecture, SE_28')[0].location, 'Room 1');
  assert.equal(t('UTC call')[0].start.toISOString(), '2026-11-09T17:00:00.000Z');
  const trip = t('Trip')[0];
  assert.equal(trip.allDay, true);
  assert.equal(trip.start.getDate(), 10); assert.equal(trip.end.getDate(), 12);
  assert.equal(t('Gone').length, 0);
});

test('weekly with BYDAY, EXDATE and a moved day', () => {
  // Tue 10 moved to 20:00 (override), Thu 12 skipped: no plain Gym in the week of 9 Nov
  assert.equal(t('Gym').length, 0);
  assert.equal(t('Gym late').length, 1);
  assert.equal(t('Gym late')[0].start.toISOString(), '2026-11-10T19:00:00.000Z');
  // the week before keeps both days, across the clock change on 25 Oct (18:00 Berlin both times)
  const wk = parseICS(feed, new Date('2026-10-19T00:00:00+02:00'), new Date('2026-10-31T00:00:00+02:00')).filter((e) => e.title === 'Gym');
  assert.deepEqual(wk.map((e) => e.start.toISOString()), ['2026-10-20T16:00:00.000Z', '2026-10-22T16:00:00.000Z', '2026-10-27T17:00:00.000Z', '2026-10-29T17:00:00.000Z']);
});

test('daily with COUNT and yearly all day', () => {
  // 1 Nov plus 11 more: the last is 12 Nov
  assert.deepEqual(t('Stand').map((e) => e.start.toISOString().slice(0, 10)), ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']);
  assert.equal(t('Birthday').length, 1);
  assert.equal(t('Birthday')[0].start.getDate(), 11);
});
