import test from 'node:test';
import assert from 'node:assert/strict';
import { humanizeDuration } from '../src/domain/humanizeDuration.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

function ago(ms) {
  const from = new Date(0);
  const to = new Date(ms);
  return humanizeDuration(from, to);
}

test('under a minute -> เมื่อสักครู่', () => {
  assert.equal(ago(30 * 1000), 'เมื่อสักครู่');
  assert.equal(ago(0), 'เมื่อสักครู่');
});

test('under an hour -> minutes only (§8.6 exception to "always 2 units")', () => {
  assert.equal(ago(MIN), '1 นาที');
  assert.equal(ago(59 * MIN), '59 นาที');
});

test('boundary: 59 vs 60 minutes switches from minutes-only to hours+minutes', () => {
  assert.equal(ago(59 * MIN), '59 นาที');
  assert.equal(ago(60 * MIN), '1 ชั่วโมง 0 นาที');
});

test('boundary: 23:59 vs 24:00 switches from hours+minutes to days+hours', () => {
  assert.equal(ago(23 * HOUR + 59 * MIN), '23 ชั่วโมง 59 นาที');
  assert.equal(ago(24 * HOUR), '1 วัน 0 ชั่วโมง');
});

test('boundary: 29 vs 30 days switches from days+hours to months+days', () => {
  assert.equal(ago(29 * DAY), '29 วัน 0 ชั่วโมง');
  assert.equal(ago(30 * DAY), '1 เดือน 0 วัน');
});

test('boundary: 364 vs 365 days switches from months+days to years+months', () => {
  assert.equal(ago(364 * DAY), '12 เดือน 4 วัน');
  assert.equal(ago(365 * DAY), '1 ปี 0 เดือน');
});

test('never returns a negative duration for a future "from" date', () => {
  const now = new Date(1000);
  const future = new Date(5000);
  assert.equal(humanizeDuration(future, now), 'เมื่อสักครู่');
});
