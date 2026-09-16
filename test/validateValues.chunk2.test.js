import test from 'node:test';
import assert from 'node:assert/strict';
import { validateValues } from '../src/domain/validateField.js';

test('number: required + range + decimals', () => {
  const el = { id: 'n', type: 'number', props: { label: 'จำนวนเงิน', required: true, min: 0, max: 1000, decimals: 2 } };
  assert.equal(validateValues([el], {}).n, 'กรุณากรอก จำนวนเงิน');
  assert.match(validateValues([el], { n: -1 }).n, /ต้องไม่น้อยกว่า 0/);
  assert.match(validateValues([el], { n: 2000 }).n, /ต้องไม่เกิน 1000/);
  assert.match(validateValues([el], { n: 1.123 }).n, /ทศนิยมได้ไม่เกิน 2/);
  assert.equal(validateValues([el], { n: 999.99 }).n, undefined);
  assert.equal(validateValues([el], { n: '1,000' }).n, undefined); // comma-formatted input accepted, over max though
});

test('number: comma-formatted string is parsed', () => {
  const el = { id: 'n', type: 'number', props: { label: 'จำนวน', max: 5000 } };
  assert.equal(validateValues([el], { n: '3,500' }).n, undefined);
});

test('date: required, range mode needs "to" >= "from"', () => {
  const single = { id: 'd', type: 'date', props: { label: 'วันที่', required: true, mode: 'single' } };
  assert.equal(validateValues([single], {}).d, 'กรุณาเลือก วันที่');
  assert.equal(validateValues([single], { d: { from: '2026-09-16' } }).d, undefined);

  const range = { id: 'd', type: 'date', props: { label: 'ช่วงวันที่', mode: 'range' } };
  assert.match(validateValues([range], { d: { from: '2026-09-16', to: '2026-09-10' } }).d, /ไม่ก่อนวันเริ่ม/);
  assert.equal(validateValues([range], { d: { from: '2026-09-16', to: '2026-09-20' } }).d, undefined);
});

test('select_one: must be a listed option unless allowOther', () => {
  const el = { id: 's', type: 'select_one', props: { label: 'ประเภท', options: ['a', 'b'] } };
  assert.match(validateValues([el], { s: 'zzz' }).s, /ไม่ถูกต้อง/);
  assert.equal(validateValues([el], { s: 'a' }).s, undefined);

  const withOther = { id: 's', type: 'select_one', props: { label: 'ประเภท', options: ['a'], allowOther: true } };
  assert.equal(validateValues([withOther], { s: 'อื่น ๆ:ระบุเอง' }).s, undefined);
});

test('file: required means at least one, and respects maxFiles', () => {
  const el = { id: 'f', type: 'file', props: { label: 'เอกสาร', required: true, maxFiles: 2 } };
  assert.equal(validateValues([el], {}).f, 'กรุณาแนบไฟล์ เอกสาร');
  const twoFiles = [{ fileId: '1' }, { fileId: '2' }];
  assert.equal(validateValues([el], { f: twoFiles }).f, undefined);
  const threeFiles = [...twoFiles, { fileId: '3' }];
  assert.match(validateValues([el], { f: threeFiles }).f, /ไม่เกิน 2 ไฟล์/);
});

test('table: row count bounds and per-cell validation', () => {
  const el = {
    id: 't',
    type: 'table',
    props: {
      label: 'รายการ',
      minRows: 1,
      maxRows: 2,
      columns: [
        { key: 'item', label: 'ชื่อ', type: 'short_text', required: true },
        { key: 'amount', label: 'จำนวนเงิน', type: 'number', required: true },
      ],
    },
  };
  assert.match(validateValues([el], { t: { rows: [] } }).t, /อย่างน้อย 1 แถว/);
  assert.match(
    validateValues([el], { t: { rows: [{ item: '', amount: 5 }] } }).t,
    /แถวที่ 1: กรุณากรอก ชื่อ/,
  );
  assert.equal(validateValues([el], { t: { rows: [{ item: 'x', amount: 5 }] } }).t, undefined);
  const tooMany = { rows: [{ item: 'a', amount: 1 }, { item: 'b', amount: 2 }, { item: 'c', amount: 3 }] };
  assert.match(validateValues([el], { t: tooMany }).t, /ไม่เกิน 2 แถว/);
});
