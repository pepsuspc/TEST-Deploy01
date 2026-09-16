import test from 'node:test';
import assert from 'node:assert/strict';
import { bangkokDateKey, bangkokHour } from '../src/domain/thaiDate.js';

test('bangkokDateKey: UTC midnight is already the next day in Bangkok (+7)', () => {
  // 2026-09-16T23:30:00Z = 2026-09-17T06:30 Bangkok
  const d = new Date('2026-09-16T23:30:00Z');
  assert.equal(bangkokDateKey(d), '2026-09-17');
});

test('bangkokDateKey: stays on the same day for a Bangkok-morning UTC time', () => {
  // 2026-09-16T01:00:00Z = 2026-09-16T08:00 Bangkok
  const d = new Date('2026-09-16T01:00:00Z');
  assert.equal(bangkokDateKey(d), '2026-09-16');
});

test('bangkokHour: 01:00Z is 08:00 in Bangkok (UTC+7)', () => {
  const d = new Date('2026-09-16T01:00:00Z');
  assert.equal(bangkokHour(d), 8);
});

test('bangkokHour: 17:00Z rolls over to 00:00 the next Bangkok day, not 24', () => {
  const d = new Date('2026-09-16T17:00:00Z');
  assert.equal(bangkokHour(d), 0);
});
