import test from 'node:test';
import assert from 'node:assert/strict';
import { validateValues } from '../src/domain/validateField.js';

const shortText = { id: 'subject', type: 'short_text', props: { label: 'เรื่อง', required: true, maxLength: 10 } };
const longText = { id: 'details', type: 'long_text', props: { label: 'รายละเอียด', required: false, maxLength: 20 } };
const selectMany = {
  id: 'purpose',
  type: 'select_many',
  props: { label: 'วัตถุประสงค์', options: ['a', 'b', 'c'], minSelected: 1 },
};

test('required short_text missing -> error naming the field', () => {
  const errors = validateValues([shortText], { subject: '' });
  assert.equal(errors.subject, 'กรุณากรอก เรื่อง');
});

test('required short_text whitespace-only counts as missing', () => {
  const errors = validateValues([shortText], { subject: '   ' });
  assert.equal(errors.subject, 'กรุณากรอก เรื่อง');
});

test('short_text over maxLength -> error', () => {
  const errors = validateValues([shortText], { subject: 'this is way too long' });
  assert.match(errors.subject, /ต้องไม่เกิน 10 ตัวอักษร/);
});

test('valid short_text -> no error', () => {
  const errors = validateValues([shortText], { subject: 'ok' });
  assert.equal(errors.subject, undefined);
});

test('optional long_text empty -> no error', () => {
  const errors = validateValues([longText], { details: '' });
  assert.equal(errors.details, undefined);
});

test('select_many below minSelected -> error', () => {
  const errors = validateValues([selectMany], { purpose: [] });
  assert.match(errors.purpose, /อย่างน้อย 1 ข้อ/);
});

test('select_many with an option not in the list -> error', () => {
  const errors = validateValues([selectMany], { purpose: ['a', 'zzz'] });
  assert.match(errors.purpose, /ไม่ถูกต้อง/);
});

test('select_many valid -> no error', () => {
  const errors = validateValues([selectMany], { purpose: ['a', 'b'] });
  assert.equal(errors.purpose, undefined);
});

test('auto and static types are never validated', () => {
  const errors = validateValues(
    [
      { id: 'x', type: 'auto', props: {} },
      { id: 'y', type: 'static', props: {} },
    ],
    {},
  );
  assert.deepEqual(errors, {});
});
