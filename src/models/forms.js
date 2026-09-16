// Data-access for the `forms` collection (§11.2). Chunk 1 hardcoded a
// single MEMO form's elements/workflow as JS constants; chunk 2 moves that
// into the database so a form owner can create/edit their own forms via
// the designer instead of waiting on a code change.

import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { HttpError } from '../lib/httpError.js';

function collection() {
  return getDb().collection('forms');
}

function toObjectId(id) {
  if (!ObjectId.isValid(id)) throw new HttpError(404, 'ไม่พบฟอร์ม');
  return new ObjectId(id);
}

const CATEGORIES = ['MEMO', 'ใบคำร้อง', 'อื่น ๆ'];

export async function createForm({ name, category, docPrefix, ownerEmpId }) {
  if (!CATEGORIES.includes(category)) throw new HttpError(400, 'หมวดไม่ถูกต้อง');
  if (!/^[A-Z]{2,6}$/.test(docPrefix)) throw new HttpError(400, 'prefix เลขที่เอกสารต้องเป็น A-Z 2-6 ตัว');

  const now = new Date();
  const doc = {
    name,
    category,
    description: '',
    status: 'draft',
    docPrefix,
    letterheadId: null,
    ownerEmpIds: [ownerEmpId],
    coOwnerEmpIds: [],
    allowedDepartmentIds: [], // empty = everyone (§7.6)
    formVersion: 1,
    elements: [],
    // Sensible default for a brand-new form: single step, submitter's
    // direct chief, 1-of-1. The real "สายอนุมัติ" editor (multi-step,
    // N-of-M, submitter_choice) is chunk 3 — until then this is the only
    // workflow shape a new form can have.
    workflow: {
      steps: [
        {
          id: 's1',
          name: 'ผู้อนุมัติ',
          quorum: 1,
          approvers: [{ type: 'relative', relation: 'chief' }],
          deadlineDays: null,
        },
      ],
    },
    createdBy: ownerEmpId,
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
  };
  const { insertedId } = await collection().insertOne(doc);
  return { ...doc, _id: insertedId };
}

export function getFormById(id) {
  return collection().findOne({ _id: toObjectId(id) });
}

export function isFormOwner(form, empId) {
  return form.ownerEmpIds.includes(empId) || form.coOwnerEmpIds.includes(empId);
}

export function listFormsOwnedBy(empId) {
  return collection()
    .find({ $or: [{ ownerEmpIds: empId }, { coOwnerEmpIds: empId }] })
    .sort({ updatedAt: -1 })
    .toArray();
}

// §10.2 "/forms": published forms this employee is allowed to submit.
export function listPublishedFormsFor(user) {
  return collection()
    .find({
      status: 'published',
      $or: [
        { allowedDepartmentIds: { $size: 0 } },
        ...(user.department ? [{ allowedDepartmentIds: user.department.id }] : []),
      ],
    })
    .sort({ category: 1, name: 1 })
    .toArray();
}

export async function updateFormMeta(id, empId, fields) {
  const form = await getFormById(id);
  if (!form) throw new HttpError(404, 'ไม่พบฟอร์ม');
  if (!isFormOwner(form, empId)) throw new HttpError(403, 'ไม่มีสิทธิ์แก้ไขฟอร์มนี้');

  const set = { updatedAt: new Date() };
  if (fields.name !== undefined) set.name = fields.name;
  if (fields.category !== undefined) {
    if (!CATEGORIES.includes(fields.category)) throw new HttpError(400, 'หมวดไม่ถูกต้อง');
    set.category = fields.category;
  }
  if (fields.description !== undefined) set.description = fields.description;
  if (fields.letterheadId !== undefined) set.letterheadId = fields.letterheadId;
  if (fields.allowedDepartmentIds !== undefined) set.allowedDepartmentIds = fields.allowedDepartmentIds;
  if (fields.coOwnerEmpIds !== undefined) set.coOwnerEmpIds = fields.coOwnerEmpIds;
  if (fields.docPrefix !== undefined) {
    // §7.6: "ล็อกหลังมีคำร้องใบแรก" — locked once any submission exists.
    const hasSubmissions = await getDb().collection('submissions').findOne({ formId: form._id.toString() });
    if (hasSubmissions) throw new HttpError(409, 'เปลี่ยน prefix ไม่ได้ เพราะมีคำร้องใช้ฟอร์มนี้แล้ว');
    if (!/^[A-Z]{2,6}$/.test(fields.docPrefix)) throw new HttpError(400, 'prefix ต้องเป็น A-Z 2-6 ตัว');
    set.docPrefix = fields.docPrefix;
  }

  await collection().updateOne({ _id: form._id }, { $set: set });
  return getFormById(id);
}

// §7.2/§2.6: elements are saved as one atomic replace (the designer sends
// the whole array on every autosave) — bumps formVersion so §7.8's
// snapshot logic can tell which layout a given submission was built
// against, even though nothing here is a "version" in the git sense.
export async function saveElements(id, empId, elements) {
  const form = await getFormById(id);
  if (!form) throw new HttpError(404, 'ไม่พบฟอร์ม');
  if (!isFormOwner(form, empId)) throw new HttpError(403, 'ไม่มีสิทธิ์แก้ไขฟอร์มนี้');
  if (form.status === 'closed') throw new HttpError(409, 'ฟอร์มปิดรับแล้ว แก้โครงไม่ได้');

  const seen = new Set();
  for (const el of elements) {
    if (seen.has(el.id)) throw new HttpError(400, `element id ซ้ำ: ${el.id}`);
    seen.add(el.id);
    if (el.col < 1 || el.col + el.colSpan - 1 > 24) throw new HttpError(400, `element ${el.id} อยู่นอกกริด`);
  }
  assertNoOverlap(elements);

  await collection().updateOne(
    { _id: form._id },
    { $set: { elements, updatedAt: new Date() }, $inc: { formVersion: 1 } },
  );
  return getFormById(id);
}

// §7.2: "สององค์ประกอบในแถวเดียวกันห้ามซ้อนคอลัมน์กัน" — enforced server
// side too, not just in the designer's own drag logic (a client is not to
// be trusted any more than a form's own field values are).
export function assertNoOverlap(elements) {
  const byRow = new Map();
  for (const el of elements) {
    if (!byRow.has(el.row)) byRow.set(el.row, []);
    byRow.get(el.row).push(el);
  }
  for (const [row, els] of byRow) {
    const sorted = [...els].sort((a, b) => a.col - b.col);
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = sorted[i - 1].col + sorted[i - 1].colSpan - 1;
      if (sorted[i].col <= prevEnd) {
        throw new HttpError(400, `แถว ${row}: องค์ประกอบทับกัน (${sorted[i - 1].id} กับ ${sorted[i].id})`);
      }
    }
  }
}

export async function publishForm(id, empId) {
  const form = await getFormById(id);
  if (!form) throw new HttpError(404, 'ไม่พบฟอร์ม');
  if (!isFormOwner(form, empId)) throw new HttpError(403, 'ไม่มีสิทธิ์');
  if (form.elements.length === 0) throw new HttpError(400, 'ฟอร์มยังไม่มีองค์ประกอบ เผยแพร่ไม่ได้');
  for (const step of form.workflow.steps) {
    if (step.approvers.length === 0) throw new HttpError(400, `ขั้น "${step.name}" ยังไม่มีผู้อนุมัติ`);
    if (step.quorum < 1 || step.quorum > step.approvers.length) {
      throw new HttpError(400, `ขั้น "${step.name}": quorum ไม่ถูกต้อง`);
    }
  }
  const now = new Date();
  await collection().updateOne(
    { _id: form._id },
    { $set: { status: 'published', updatedAt: now, publishedAt: form.publishedAt ?? now } },
  );
  return getFormById(id);
}

export async function closeForm(id, empId) {
  const form = await getFormById(id);
  if (!form) throw new HttpError(404, 'ไม่พบฟอร์ม');
  if (!isFormOwner(form, empId)) throw new HttpError(403, 'ไม่มีสิทธิ์');
  await collection().updateOne({ _id: form._id }, { $set: { status: 'closed', updatedAt: new Date() } });
  return getFormById(id);
}

export async function reopenForm(id, empId) {
  const form = await getFormById(id);
  if (!form) throw new HttpError(404, 'ไม่พบฟอร์ม');
  if (!isFormOwner(form, empId)) throw new HttpError(403, 'ไม่มีสิทธิ์');
  await collection().updateOne({ _id: form._id }, { $set: { status: 'published', updatedAt: new Date() } });
  return getFormById(id);
}

// §7.1: a form can only be hard-deleted if it never had a submission.
export async function deleteForm(id, empId) {
  const form = await getFormById(id);
  if (!form) throw new HttpError(404, 'ไม่พบฟอร์ม');
  if (!isFormOwner(form, empId)) throw new HttpError(403, 'ไม่มีสิทธิ์');
  const hasSubmissions = await getDb().collection('submissions').findOne({ formId: form._id.toString() });
  if (hasSubmissions) throw new HttpError(409, 'ลบไม่ได้ เพราะมีคำร้องใช้ฟอร์มนี้แล้ว — ใช้ "ปิดรับ" แทน');
  await collection().deleteOne({ _id: form._id });
}

export async function cloneForm(id, empId) {
  const form = await getFormById(id);
  if (!form) throw new HttpError(404, 'ไม่พบฟอร์ม');
  if (!isFormOwner(form, empId)) throw new HttpError(403, 'ไม่มีสิทธิ์');
  const now = new Date();
  const copy = {
    ...form,
    _id: undefined,
    name: `${form.name} (สำเนา)`,
    status: 'draft',
    formVersion: 1,
    createdBy: empId,
    ownerEmpIds: [empId],
    coOwnerEmpIds: [],
    createdAt: now,
    updatedAt: now,
    publishedAt: null,
  };
  delete copy._id;
  const { insertedId } = await collection().insertOne(copy);
  return { ...copy, _id: insertedId };
}
