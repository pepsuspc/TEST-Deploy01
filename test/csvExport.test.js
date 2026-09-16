import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSubmissionsCsv } from '../src/domain/csvExport.js';

const elements = [
  { id: 'el_subject', type: 'short_text', props: { label: 'เรื่อง' } },
  { id: 'el_tags', type: 'select_many', props: { label: 'แท็ก' } },
  { id: 'el_range', type: 'date', props: { label: 'ช่วงวันที่' } },
  { id: 'el_files', type: 'file', props: { label: 'ไฟล์แนบ' } },
  { id: 'el_items', type: 'table', props: { label: 'รายการ' } },
  { id: 'el_note', type: 'static', props: { variant: 'heading', text: 'หมายเหตุ' } },
  { id: 'el_docnum', type: 'auto', props: { label: 'เลขที่', source: 'doc_number' } },
];

function baseSubmission(overrides) {
  return {
    docNumber: 'MEMO-2569-0001',
    submitter: { name: 'สมชาย ใจดี', department: { name: 'ฝ่ายไอที' } },
    status: 'pending',
    current: { stepName: 'ผู้ตรวจสอบ' },
    submittedAt: new Date('2026-09-01T03:00:00Z'),
    finishedAt: null,
    values: {},
    autoValues: {},
    ...overrides,
  };
}

test('buildSubmissionsCsv: starts with the core columns then one per exportable element, static excluded', () => {
  const csv = buildSubmissionsCsv(elements, []);
  const header = csv.split('\r\n')[0];
  assert.equal(header, 'เลขที่เอกสาร,ผู้ยื่น,แผนก,สถานะ,ขั้นปัจจุบัน,ส่งเมื่อ,จบเมื่อ,เรื่อง,แท็ก,ช่วงวันที่,ไฟล์แนบ,รายการ,เลขที่');
  assert.doesNotMatch(header, /หมายเหตุ/, 'static elements have no value and are not exported as a column');
});

test('buildSubmissionsCsv: select_many joins with comma-space, file names join with semicolon, table becomes JSON', () => {
  const s = baseSubmission({
    values: {
      el_subject: 'ขออนุมัติซื้อของ',
      el_tags: ['ด่วน', 'สำคัญ'],
      el_range: { from: '2026-09-01', to: '2026-09-05' },
      el_files: [{ fileId: 'f1', name: 'ใบเสนอราคา.pdf', size: 100 }, { fileId: 'f2', name: 'รูปถ่าย.jpg', size: 200 }],
      el_items: { rows: [{ name: 'ปากกา', price: 10 }] },
    },
    autoValues: { el_docnum: 'MEMO-2569-0001' },
  });
  const csv = buildSubmissionsCsv(elements, [s]);
  const row = csv.split('\r\n')[1];
  assert.match(row, /ด่วน, สำคัญ/);
  assert.match(row, /2026-09-01 – 2026-09-05/);
  assert.match(row, /ใบเสนอราคา\.pdf;รูปถ่าย\.jpg/);
  assert.match(row, /"\[\{""name"":""ปากกา""/, 'table cell is JSON, quote-escaped per CSV rules since it contains commas/quotes');
});

test('buildSubmissionsCsv: a field containing a comma is quoted and internal quotes doubled', () => {
  const s = baseSubmission({ values: { el_subject: 'ของ, "พิเศษ"' } });
  const csv = buildSubmissionsCsv(elements, [s]);
  const row = csv.split('\r\n')[1];
  assert.match(row, /"ของ, ""พิเศษ"""/);
});

test('buildSubmissionsCsv: a submission missing a column entirely (older snapshot) exports blank, not an error', () => {
  const s = baseSubmission({ values: {} }); // no el_tags/el_range/el_files/el_items at all
  const csv = buildSubmissionsCsv(elements, [s]);
  const row = csv.split('\r\n')[1];
  const cells = row.split(',');
  assert.equal(cells.length, 13); // 7 core + 6 exportable fields, all present even if empty
});
