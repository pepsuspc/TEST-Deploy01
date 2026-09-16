// Chunk 1 hardcoded the MEMO form as JS constants (domain/memoFormDef.js,
// since deleted — §14.5 task 2.2: "ลบโค้ด MEMO ตายตัวทิ้งได้"). Chunk 2
// moves forms into the database, so something has to create MEMO's row
// there once. This mirrors the org sync's own idempotent-seed-at-boot
// pattern rather than being a one-off migration script someone has to
// remember to run — §E.3 explicitly says v1 has no migration system, and
// "check if it exists, insert if not" needs no migration runner.
//
// Elements match appendix B, now complete with the table/file rows chunk 1
// deliberately left out (those types didn't exist yet). The workflow now
// matches §8.10's walkthrough AND §7.5's own example exactly: step 1 is
// the submitter's chief, step 2 is `submitter_choice` labeled "เรียน" —
// chunk 1/2 used a hardcoded `user: E003` for step 2 as a deliberate
// stand-in before the submitter_choice mechanism existed; now that chunk 3
// builds it for real, ศรัญญา (E003) is just the person a submitter
// *picks* rather than someone wired into the form definition.

import { getDb } from './connection.js';

const MEMO_ELEMENTS = [
  { id: 'el_date', type: 'auto', row: 1, col: 17, colSpan: 8, align: 'right', props: { label: 'วันที่', source: 'submitted_at' } },
  { id: 'el_subject', type: 'short_text', row: 2, col: 1, colSpan: 24, align: 'left', props: { label: 'เรื่อง', required: true, maxLength: 200 } },
  { id: 'el_to', type: 'short_text', row: 3, col: 1, colSpan: 16, align: 'left', props: { label: 'เรียน', required: true, maxLength: 200 } },
  {
    id: 'el_purpose',
    type: 'select_many',
    row: 4,
    col: 1,
    colSpan: 24,
    align: 'left',
    props: { label: '', layout: 'inline', options: ['เพื่อทราบ', 'เพื่อดำเนินการ', 'เพื่อบันทึก', 'เพื่อการอนุมัติของท่าน', 'อื่น ๆ'] },
  },
  { id: 'el_details', type: 'long_text', row: 5, col: 1, colSpan: 24, align: 'left', props: { label: 'รายละเอียด', required: true, rows: 8, maxLength: 5000 } },
  {
    id: 'el_items',
    type: 'table',
    row: 6,
    col: 1,
    colSpan: 24,
    align: 'left',
    props: {
      label: 'รายการ (ถ้ามี)',
      columns: [
        { key: 'name', label: 'ชื่อบริการ', type: 'short_text', width: 3, required: true },
        { key: 'purpose', label: 'วัตถุประสงค์', type: 'short_text', width: 3, required: false },
        { key: 'price', label: 'ราคา/เดือน', type: 'number', width: 1, required: true },
        { key: 'qty', label: 'จำนวน', type: 'number', width: 1, required: true },
        { key: 'payer', label: 'บริษัทที่จ่าย', type: 'short_text', width: 2, required: false },
      ],
      minRows: 0,
      maxRows: 20,
      sumColumns: ['price'],
    },
  },
  { id: 'el_attachments', type: 'file', row: 7, col: 1, colSpan: 24, align: 'left', props: { label: 'เอกสารแนบ', required: false, maxFiles: 5 } },
];

const MEMO_WORKFLOW_STEPS = [
  { id: 's1', name: 'ผู้ตรวจสอบ', quorum: 1, approvers: [{ type: 'relative', relation: 'chief' }], deadlineDays: 3 },
  { id: 's2', name: 'ผู้อนุมัติ', quorum: 1, approvers: [{ type: 'submitter_choice', label: 'เรียน', restrictDepartment: null }], deadlineDays: null },
];

export async function seedMemoForm(adminEmpId) {
  const db = getDb();
  const existing = await db.collection('forms').findOne({ docPrefix: 'MEMO' });
  if (existing) return existing;

  const now = new Date();
  const doc = {
    name: 'MEMO ขออนุมัติ',
    category: 'MEMO',
    description: 'ใช้ขออนุมัติทั่วไป',
    status: 'published',
    docPrefix: 'MEMO',
    letterheadId: null,
    ownerEmpIds: [adminEmpId],
    coOwnerEmpIds: [],
    allowedDepartmentIds: [],
    formVersion: 1,
    elements: MEMO_ELEMENTS,
    workflow: { steps: MEMO_WORKFLOW_STEPS },
    createdBy: adminEmpId,
    createdAt: now,
    updatedAt: now,
    publishedAt: now,
  };
  const { insertedId } = await db.collection('forms').insertOne(doc);
  console.log(`seeded MEMO form (${insertedId})`);
  return { ...doc, _id: insertedId };
}
