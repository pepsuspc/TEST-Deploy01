// Data-access + workflow transitions for the `submissions` collection.
// §11.1: one document per submission, embedding the snapshot, values, and
// the full round/decision history — every state change here is a single
// findOneAndUpdate with a `version` guard, never a multi-step transaction
// (§3.2, §8.9), because production Mongo is standalone.

import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { findUserByEmpId } from './users.js';
import { getFormById } from './forms.js';
import { attachFilesToSubmission } from './files.js';
import { nextDocNumber } from '../domain/docNumber.js';
import { validateValues } from '../domain/validateField.js';
import { evaluateStep } from '../domain/evaluateStep.js';
import { HttpError } from '../lib/httpError.js';
import { notify, notifyMany } from './notifications.js';

function collection() {
  return getDb().collection('submissions');
}

function toObjectId(id) {
  if (!ObjectId.isValid(id)) throw new HttpError(404, 'ไม่พบคำร้อง');
  return new ObjectId(id);
}

export async function createDraft(user, formId) {
  const form = await getFormById(formId);
  if (!form) throw new HttpError(404, 'ไม่พบฟอร์ม');
  if (form.status !== 'published') throw new HttpError(409, 'ฟอร์มนี้ยังไม่เผยแพร่หรือปิดรับไปแล้ว');
  if (form.allowedDepartmentIds?.length > 0) {
    const deptId = user.department?.id;
    if (!deptId || !form.allowedDepartmentIds.includes(deptId)) {
      throw new HttpError(403, 'แผนกของคุณยื่นฟอร์มนี้ไม่ได้');
    }
  }

  const now = new Date();
  const doc = {
    // docNumber is intentionally OMITTED (not set to null) until first
    // submit. The unique index on it is `sparse`, which only excludes
    // documents where the field is truly *missing* — an explicit `null` is
    // still a value and still gets indexed, so every second draft ever
    // created would collide on it (found by testing, not by inspection).
    formId: form._id.toString(),
    formVersion: form.formVersion,
    status: 'draft',
    version: 1,
    submitter: {
      emp_id: user.emp_id,
      name: user.name,
      department: user.department ?? null,
      position: user.position ?? null,
      email: user.email,
    },
    snapshot: null,
    values: {},
    // §7.4: submitter_*/form_name auto fields fill in at draft creation;
    // submitted_at/doc_number wait until first submit (buildAutoValues
    // returns null for those here since ctx has no submittedAt/docNumber
    // yet, so they're simply omitted rather than written as null).
    autoValues: buildAutoValues(form.elements, {
      submitter: { emp_id: user.emp_id, name: user.name, department: user.department, position: user.position, email: user.email },
      formName: form.name,
      submittedAt: null,
      docNumber: null,
    }),
    current: null,
    rounds: [],
    comments: [],
    createdAt: now,
    updatedAt: now,
    submittedAt: null,
    finishedAt: null,
  };
  const { insertedId } = await collection().insertOne(doc);
  return { ...doc, _id: insertedId };
}

export function getSubmissionById(id) {
  return collection().findOne({ _id: toObjectId(id) });
}

export function listMySubmissions(empId) {
  return collection().find({ 'submitter.emp_id': empId }).sort({ updatedAt: -1 }).toArray();
}

// §10.7 "/manage/forms/{id}/submissions" — every submission of one form,
// for its owner. `query` comes straight from req.query: status, from, to
// (submittedAt range), q (doc number / subject search), page.
export async function listSubmissionsForForm(formId, query = {}) {
  const filter = { formId };
  if (query.status) filter.status = query.status;
  if (query.from || query.to) {
    filter.submittedAt = {};
    if (query.from) filter.submittedAt.$gte = new Date(query.from);
    if (query.to) filter.submittedAt.$lte = new Date(`${query.to}T23:59:59.999Z`);
  }
  if (query.q) {
    filter.$or = [{ docNumber: { $regex: escapeRegex(query.q), $options: 'i' } }];
  }
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = 50;
  const cursor = collection()
    .find(filter)
    .sort({ submittedAt: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize);
  const [items, total] = await Promise.all([cursor.toArray(), collection().countDocuments(filter)]);
  return { items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// §10.1 "รอฉันอนุมัติ" tab — sorted overdue-first, then longest-waiting
// first. `deadlineAt` is always null in chunk 1 (per-step deadlines are
// chunk 3), so today this is just "longest-waiting first"; the overdue
// check is written so nothing has to change here once deadlines exist.
export function listPendingForApprover(empId) {
  return collection()
    .find({ status: 'pending', 'current.approverEmpIds': empId })
    .sort({ 'current.enteredAt': 1 })
    .toArray();
}

export function isOverdue(submission, now = new Date()) {
  return Boolean(submission.current?.deadlineAt) && now > submission.current.deadlineAt;
}

// §10.1: "เรื่อง (ฟิลด์ short_text ตัวแรกบนกระดาษ)" — the first short_text
// element's value, generically (whatever form this submission is for).
export async function subjectText(submission) {
  const elements = await elementsFor(submission);
  const firstShortText = elements.find((el) => el.type === 'short_text');
  if (!firstShortText) return '';
  return (submission.values && submission.values[firstShortText.id]) || '';
}

// The elements to render this submission against: once it has ever been
// submitted, always use the frozen snapshot (§7.8) — never the live form
// definition, even if the submission has since bounced back to `draft` via
// a return/recall. A submission that has never been submitted has no
// snapshot yet, so it reads the *live* form (§7.8: "ร่างที่ยังไม่ส่ง
// อ่านจากฟอร์มปัจจุบัน") — which is why this has to be async now; a
// hardcoded constant never needed a database round trip.
export async function elementsFor(submission) {
  return (await formContextFor(submission)).elements;
}

// Same idea as elementsFor, but also carries the form's name/letterhead —
// views need those too (title bar, letterhead box) and shouldn't each
// re-derive "snapshot, or fall back to the live form" on their own.
export async function formContextFor(submission) {
  if (submission.snapshot) {
    return {
      elements: submission.snapshot.elements,
      formName: submission.snapshot.formName,
      letterheadId: submission.snapshot.letterheadId ?? null,
    };
  }
  const form = await getFormById(submission.formId);
  if (!form) return { elements: [], formName: '(ไม่พบฟอร์ม)', letterheadId: null };
  return { elements: form.elements, formName: form.name, letterheadId: form.letterheadId };
}

// §8.8: turn each `file`-type field's client-supplied fileId list into
// resolved, permission-checked metadata, attaching those files to this
// submission in the process. Other fields pass through untouched.
async function resolveFileFields(elements, values, submissionId, empId) {
  const resolved = { ...values };
  for (const el of elements) {
    if (el.type !== 'file') continue;
    const raw = values[el.id];
    const fileIds = Array.isArray(raw) ? raw.map((v) => (typeof v === 'string' ? v : v.fileId)).filter(Boolean) : [];
    resolved[el.id] = await attachFilesToSubmission(fileIds, { submissionId, elementId: el.id, empId });
  }
  return resolved;
}

export async function saveDraftValues(id, empId, values, { expectedVersion } = {}) {
  const draft = await getSubmissionById(id);
  if (!draft) throw new HttpError(404, 'ไม่พบร่างนี้');
  const elements = await elementsFor(draft);
  const resolvedValues = await resolveFileFields(elements, values, id, empId);

  const filter = { _id: toObjectId(id), 'submitter.emp_id': empId, status: 'draft' };
  if (expectedVersion !== undefined) filter.version = expectedVersion;
  const result = await collection().findOneAndUpdate(
    filter,
    { $set: { values: resolvedValues, updatedAt: new Date() }, $inc: { version: 1 } },
    { returnDocument: 'after' },
  );
  if (!result) throw new HttpError(409, 'ไม่พบร่างนี้ หรือมีการเปลี่ยนแปลงไปแล้ว กรุณาโหลดหน้าใหม่');
  return result;
}

export async function deleteDraft(id, empId) {
  // Only a draft that was never submitted may be hard-deleted (§8.1) —
  // once it has a doc number, someone may already have seen it.
  const result = await collection().deleteOne({
    _id: toObjectId(id),
    'submitter.emp_id': empId,
    status: 'draft',
    docNumber: null,
  });
  return result.deletedCount === 1;
}

// Resolve one workflow-step-definition's approvers into real people
// (§7.5/§D.7). Chunk 2 supports the two rules a form's workflow can
// actually contain so far: `relative:chief` and a fixed `user`. The full
// 3-type resolver — `relative:department_head`, `submitter_choice`, N-of-M
// dedup across multiple approvers in one step — is chunk 3; every step
// today has exactly one approver, so quorum is always 1-of-1.
async function resolveOneApprover(approverDef, submitterUser, stepName) {
  if (approverDef.type === 'relative' && approverDef.relation === 'chief') {
    const chief = submitterUser.chief;
    if (!chief?.emp_id) return { blocked: 'ไม่พบหัวหน้าโดยตรงของคุณในระบบ ติดต่อฝ่ายไอที' };
    const chiefUser = await findUserByEmpId(chief.emp_id);
    if (chiefUser && chiefUser.is_active === false) {
      return { blocked: 'หัวหน้าของคุณไม่ได้อยู่ในระบบแล้ว ติดต่อฝ่ายไอที' };
    }
    return { approver: { emp_id: chief.emp_id, name: chiefUser?.name ?? chief.name, source: 'relative:chief' } };
  }
  if (approverDef.type === 'user') {
    const user = await findUserByEmpId(approverDef.emp_id);
    if (!user || user.is_active === false) {
      return { blocked: `ไม่พบผู้อนุมัติของขั้น "${stepName}" ในระบบ ติดต่อฝ่ายไอที` };
    }
    return { approver: { emp_id: user.emp_id, name: user.name, source: 'user' } };
  }
  return { blocked: `ขั้น "${stepName}" ใช้กติกาผู้อนุมัติที่ยังไม่รองรับ (${approverDef.type}) — รอก้อนที่ 3` };
}

async function resolveAllSteps(workflowSteps, submitterUser) {
  const steps = [];
  for (const stepDef of workflowSteps) {
    // Chunk 2 forms only ever have exactly one approver per step (see
    // forms.js's default workflow); resolve it and dedup is chunk 3.
    const resolved = await resolveOneApprover(stepDef.approvers[0], submitterUser, stepDef.name);
    if (resolved.blocked) return { blocked: resolved.blocked };
    steps.push({
      stepId: stepDef.id,
      name: stepDef.name,
      quorum: stepDef.quorum,
      approvers: [resolved.approver],
      enteredAt: null,
      deadlineAt: null,
      decisions: [],
    });
  }
  return { steps };
}

// §7.4: when each `auto` field's source gets filled in.
function computeAutoValue(source, ctx) {
  switch (source) {
    case 'submitter_name':
      return ctx.submitter.name;
    case 'submitter_department':
      return ctx.submitter.department?.name ?? '';
    case 'submitter_position':
      return ctx.submitter.position?.name ?? '';
    case 'submitter_email':
      return ctx.submitter.email;
    case 'form_name':
      return ctx.formName;
    case 'submitted_at':
      return ctx.submittedAt ?? null;
    case 'doc_number':
      return ctx.docNumber ?? null;
    default:
      return null;
  }
}

function buildAutoValues(elements, ctx) {
  const result = {};
  for (const el of elements) {
    if (el.type !== 'auto') continue;
    const val = computeAutoValue(el.props.source, ctx);
    if (val !== null) result[el.id] = val;
  }
  return result;
}

// Submit (or resubmit after a recall/return) a draft. `values`, if given,
// is whatever's currently in the edit form — merged in as part of the same
// atomic transition rather than a separate save-then-submit write, so a
// submit is exactly one document update like every other action (§8.9).
// Returns:
//   { ok: false, errors }   -- field validation failed
//   { ok: false, blocked }  -- an approver couldn't be resolved (§D.7)
//   { ok: true, submission }
export async function submitDraft(id, empId, { values, expectedVersion } = {}) {
  const draft = await getSubmissionById(id);
  if (!draft) throw new HttpError(404, 'ไม่พบคำร้อง');
  if (draft.submitter.emp_id !== empId) throw new HttpError(403, 'ไม่มีสิทธิ์แก้ไขคำร้องนี้');
  if (draft.status !== 'draft') throw new HttpError(409, 'คำร้องนี้ไม่ได้อยู่ในสถานะร่าง');

  const form = await getFormById(draft.formId);
  if (!form) throw new HttpError(404, 'ไม่พบฟอร์มของคำร้องนี้');
  // §7.1: closed blocks brand-new submissions, but a request already in
  // flight (has a doc number — this is a resubmit after return/recall)
  // still gets to finish ("คำร้องที่ค้างอยู่เดินต่อจนจบ").
  if (form.status === 'closed' && !draft.docNumber) {
    throw new HttpError(409, 'ฟอร์มนี้ปิดรับแล้ว ส่งคำร้องใหม่ไม่ได้');
  }

  const elements = draft.snapshot?.elements ?? form.elements;
  if (values) draft.values = await resolveFileFields(elements, values, id, empId);

  const errors = validateValues(elements, draft.values);
  if (Object.keys(errors).length > 0) return { ok: false, errors, submission: draft };

  const submitterUser = await findUserByEmpId(empId);
  // §D.7: every step's approver is resolved before a doc number is spent —
  // blocking must happen before we issue one, not after.
  const workflowSteps = draft.snapshot?.workflow?.steps ?? form.workflow.steps;
  const resolved = await resolveAllSteps(workflowSteps, submitterUser);
  if (resolved.blocked) return { ok: false, blocked: resolved.blocked, submission: draft };

  const now = new Date();
  const isFirstSubmit = !draft.docNumber;
  const docNumber = isFirstSubmit ? await nextDocNumber(getDb(), form.docPrefix, { now }) : draft.docNumber;
  const submittedAt = isFirstSubmit ? now : draft.submittedAt;
  const round = (draft.rounds?.length || 0) + 1;

  const steps = resolved.steps;
  steps[0].enteredAt = now; // only the first step is "entered" at submit time

  const snapshot = draft.snapshot ?? {
    formName: form.name,
    elements: form.elements,
    workflow: form.workflow,
    letterheadId: form.letterheadId,
  };
  const autoValues = {
    ...draft.autoValues,
    ...buildAutoValues(elements, { submitter: draft.submitter, formName: snapshot.formName, submittedAt, docNumber }),
  };

  const result = await collection().findOneAndUpdate(
    { _id: draft._id, version: expectedVersion ?? draft.version, status: 'draft' },
    {
      $set: {
        status: 'pending',
        values: draft.values,
        docNumber,
        submittedAt,
        formVersion: form.formVersion,
        snapshot,
        autoValues,
        current: {
          round,
          stepIndex: 0,
          stepId: steps[0].stepId,
          stepName: steps[0].name,
          approverEmpIds: steps[0].approvers.map((a) => a.emp_id),
          enteredAt: now,
          deadlineAt: null,
        },
        updatedAt: now,
      },
      $push: { rounds: { round, submittedAt: now, endedAt: null, endedBy: null, steps } },
      $inc: { version: 1 },
    },
    { returnDocument: 'after' },
  );

  if (!result) throw new HttpError(409, 'คำร้องนี้เพิ่งมีการเปลี่ยนแปลง กรุณาโหลดหน้าใหม่');

  // §9.1: "คำร้องมาถึงขั้นของคุณ" -> every approver of the newly-entered step.
  await notifyMany(steps[0].approvers.map((a) => a.emp_id), {
    type: 'step_entered',
    subject: `${result.docNumber} รอคุณอนุมัติ`,
    body: `${result.submitter.name} ส่ง "${await subjectText(result)}" มาให้คุณตรวจ`,
    link: `/submissions/${result._id}`,
  });

  return { ok: true, submission: result };
}

// UI visibility helpers — §10.4: "ปุ่มที่ทำไม่ได้ต้องไม่แสดง ไม่ใช่แสดงแล้ว
// error". Each mirrors the guard a decide/recall/cancel call would enforce,
// read-only, so routes can decide what to render without duplicating logic
// or just hoping the buttons matched what the POST handler will accept.

export function canDecide(submission, empId) {
  if (submission.status !== 'pending') return false;
  if (!submission.current.approverEmpIds.includes(empId)) return false;
  const step = submission.rounds[currentRoundIndex(submission)].steps[submission.current.stepIndex];
  return !step.decisions.some((d) => d.emp_id === empId && !d.recalledAt && (d.action === 'approve' || d.action === 'reject'));
}

export function canRecall(submission, empId) {
  if (submission.status !== 'pending') return false;
  const round = submission.rounds[currentRoundIndex(submission)];

  if (submission.submitter.emp_id === empId && submission.current.stepIndex === 0) {
    const step0 = round.steps[0];
    if (!step0.decisions.some((d) => !d.recalledAt && (d.action === 'approve' || d.action === 'reject'))) return true;
  }

  for (let stepIdx = 0; stepIdx <= submission.current.stepIndex; stepIdx++) {
    const step = round.steps[stepIdx];
    const hasActive = step.decisions.some(
      (d) => d.emp_id === empId && !d.recalledAt && (d.action === 'approve' || d.action === 'reject'),
    );
    if (!hasActive) continue;
    const laterStepsHaveActivity = round.steps.slice(stepIdx + 1).some((s) => s.decisions.some((d) => !d.recalledAt));
    if (!laterStepsHaveActivity) return true;
  }
  return false;
}

export function canCancel(submission, empId) {
  return submission.status === 'draft' && submission.docNumber != null && submission.submitter.emp_id === empId;
}

// Whether `empId` is allowed to open this submission at all (§4: "คำร้อง
// เป็นความลับระดับคนที่เกี่ยวข้อง"). The submitter, and anyone who appears
// as an approver in any round/step (past or present), counts as involved.
export function isRelatedToSubmission(submission, empId) {
  if (submission.submitter.emp_id === empId) return true;
  for (const round of submission.rounds ?? []) {
    for (const step of round.steps ?? []) {
      if (step.approvers.some((a) => a.emp_id === empId)) return true;
    }
  }
  return false;
}

function currentRoundIndex(submission) {
  return submission.rounds.length - 1;
}

// §8.2/§8.3: approve, reject, or return the submission at its current step.
// `action` is 'approve' | 'reject' | 'return'. Reject/return require a
// comment of >= 5 chars (§8.2). Everything here is one findOneAndUpdate
// guarded by `version`. `expectedVersion`, when given, is the version the
// CALLER's page was rendered with (§8.9: "เวอร์ชันที่ผู้ใช้เห็นตอนโหลด
// หน้า ... ส่งมากับ request") — this is what actually catches "two people
// loaded this page seconds apart, one already acted." Using a version we
// just re-read inside this same function would only catch a race within
// this function's own few milliseconds, not that real scenario (found by
// writing a concurrency test that kept passing for the wrong reason).
// Falls back to a fresh read's version when no expectedVersion is given,
// for callers (tests, scripts) that don't have a rendered page to draw one
// from.
export async function decideStep(id, empId, action, { comment = '', now = new Date(), expectedVersion } = {}) {
  const submission = await getSubmissionById(id);
  if (!submission) throw new HttpError(404, 'ไม่พบคำร้อง');
  if (submission.status !== 'pending') throw new HttpError(409, 'คำร้องนี้ไม่ได้อยู่ในสถานะรอดำเนินการ');
  if (!submission.current.approverEmpIds.includes(empId)) {
    throw new HttpError(403, 'คุณไม่ใช่ผู้อนุมัติของขั้นนี้ในรอบนี้');
  }
  if ((action === 'reject' || action === 'return') && comment.trim().length < 5) {
    throw new HttpError(400, 'กรุณาระบุความเห็นอย่างน้อย 5 ตัวอักษร');
  }

  const roundIdx = currentRoundIndex(submission);
  const stepIdx = submission.current.stepIndex;
  const step = submission.rounds[roundIdx].steps[stepIdx];

  const alreadyActive = step.decisions.some(
    (d) => d.emp_id === empId && !d.recalledAt && (d.action === 'approve' || d.action === 'reject'),
  );
  if (alreadyActive) throw new HttpError(409, 'คุณกดไปแล้วในรอบนี้');

  const decision = { emp_id: empId, action, comment, at: now };
  const decisionPath = `rounds.${roundIdx}.steps.${stepIdx}.decisions`;

  let setFields = { updatedAt: now };
  let outcome = null; // 'waiting' | 'failed' | 'passed-advance' | 'passed-final', for notifications below
  let nextStep = null;

  if (action === 'return') {
    // §8.5: takes effect immediately, no need to wait for quorum.
    setFields = {
      ...setFields,
      status: 'draft',
      current: null,
      [`rounds.${roundIdx}.endedAt`]: now,
      [`rounds.${roundIdx}.endedBy`]: 'returned',
    };
  } else {
    outcome = evaluateStep(step, [...step.decisions, decision]);
    if (outcome === 'waiting') {
      // nothing else changes — still waiting on the rest of this step's quorum
    } else if (outcome === 'failed') {
      setFields = {
        ...setFields,
        status: 'rejected',
        current: null,
        finishedAt: now,
        [`rounds.${roundIdx}.endedAt`]: now,
        [`rounds.${roundIdx}.endedBy`]: 'rejected',
      };
    } else {
      // 'passed' — either advance to the next step, or finish the workflow.
      const nextStepIdx = stepIdx + 1;
      nextStep = submission.rounds[roundIdx].steps[nextStepIdx];
      if (nextStep) {
        outcome = 'passed-advance';
        setFields = {
          ...setFields,
          [`rounds.${roundIdx}.steps.${nextStepIdx}.enteredAt`]: now,
          current: {
            round: submission.current.round,
            stepIndex: nextStepIdx,
            stepId: nextStep.stepId,
            stepName: nextStep.name,
            approverEmpIds: nextStep.approvers.map((a) => a.emp_id),
            enteredAt: now,
            deadlineAt: null,
          },
        };
      } else {
        outcome = 'passed-final';
        setFields = {
          ...setFields,
          status: 'approved',
          current: null,
          finishedAt: now,
          [`rounds.${roundIdx}.endedAt`]: now,
          [`rounds.${roundIdx}.endedBy`]: 'approved',
        };
      }
    }
  }

  const result = await collection().findOneAndUpdate(
    { _id: submission._id, version: expectedVersion ?? submission.version, status: 'pending' },
    { $push: { [decisionPath]: decision }, $set: setFields, $inc: { version: 1 } },
    { returnDocument: 'after' },
  );
  if (!result) throw new HttpError(409, 'คำร้องนี้เพิ่งมีการเปลี่ยนแปลง กรุณาโหลดหน้าใหม่');

  await sendDecideNotifications(result, action, outcome, step.name, nextStep);
  return result;
}

// §9.1's rows for a decision's outcome: the submitter always hears about
// it (advance, final result, or return); the next step's approvers hear
// about it only when the workflow actually moves to them.
async function sendDecideNotifications(submission, action, outcome, completedStepName, nextStep) {
  const link = `/submissions/${submission._id}`;
  const subjectLine = `${submission.docNumber} — ${await subjectText(submission)}`;

  if (action === 'return') {
    await notify(submission.submitter.emp_id, {
      type: 'returned',
      subject: `${subjectLine} ถูกส่งกลับแก้ไข`,
      body: 'กรุณาแก้ไขและส่งใหม่',
      link,
    });
    return;
  }
  if (outcome === 'failed') {
    await notify(submission.submitter.emp_id, {
      type: 'rejected',
      subject: `${subjectLine} ไม่อนุมัติ`,
      body: '',
      link,
    });
  } else if (outcome === 'passed-final') {
    await notify(submission.submitter.emp_id, {
      type: 'approved',
      subject: `${subjectLine} อนุมัติครบแล้ว`,
      body: '',
      link,
    });
  } else if (outcome === 'passed-advance' && nextStep) {
    await notify(submission.submitter.emp_id, {
      type: 'step_advanced',
      subject: `${subjectLine} ผ่านขั้น "${completedStepName}" แล้ว`,
      body: `กำลังรอ "${nextStep.name}"`,
      link,
    });
    await notifyMany(nextStep.approvers.map((a) => a.emp_id), {
      type: 'step_entered',
      subject: `${subjectLine} รอคุณอนุมัติ`,
      body: `${submission.submitter.name} ส่งคำร้องมาถึงขั้นของคุณแล้ว`,
      link,
    });
  }
}

// §8.4: "คนที่กระทำล่าสุด ถอนได้ ตราบใดที่คนถัดไปยังไม่ได้กระทำ" — the
// submitter counts as "step 0". Two cases:
//   1. Submitter recalls before the first step's quorum has any active vote.
//   2. An approver recalls their own active decision at step k, provided no
//      later step (or the workflow's conclusion) has happened yet.
export async function recallDecision(id, empId, { now = new Date(), expectedVersion } = {}) {
  const submission = await getSubmissionById(id);
  if (!submission) throw new HttpError(404, 'ไม่พบคำร้อง');
  if (submission.status !== 'pending') throw new HttpError(409, 'ดึงกลับได้เฉพาะคำร้องที่อยู่ระหว่างดำเนินการ');

  const roundIdx = currentRoundIndex(submission);
  const round = submission.rounds[roundIdx];

  // Case 1: submitter, only while step 0 has no active decisions yet.
  if (submission.submitter.emp_id === empId && submission.current.stepIndex === 0) {
    const step0 = round.steps[0];
    const hasActiveDecision = step0.decisions.some((d) => !d.recalledAt && (d.action === 'approve' || d.action === 'reject'));
    if (!hasActiveDecision) {
      const result = await collection().findOneAndUpdate(
        { _id: submission._id, version: expectedVersion ?? submission.version, status: 'pending' },
        {
          $set: {
            status: 'draft',
            current: null,
            [`rounds.${roundIdx}.endedAt`]: now,
            [`rounds.${roundIdx}.endedBy`]: 'recalled',
            updatedAt: now,
          },
          $inc: { version: 1 },
        },
        { returnDocument: 'after' },
      );
      if (!result) throw new HttpError(409, 'คำร้องนี้เพิ่งมีการเปลี่ยนแปลง กรุณาโหลดหน้าใหม่');
      // §9.1: "มีคนดึงกลับคำร้องที่คุณกำลังจะกด" -> the step-0 approvers who
      // just lost it from their queue.
      await notifyMany(step0.approvers.map((a) => a.emp_id), {
        type: 'recalled_from_queue',
        subject: `${result.docNumber || ''} ถูกดึงกลับโดยผู้ยื่น`,
        body: '',
        link: `/submissions/${result._id}`,
      });
      return result;
    }
  }

  // Case 2: an approver withdraws their own active decision at step k, as
  // long as no step after k has any activity yet.
  for (let stepIdx = 0; stepIdx <= submission.current.stepIndex; stepIdx++) {
    const step = round.steps[stepIdx];
    const activeDecision = step.decisions.find(
      (d) => d.emp_id === empId && !d.recalledAt && (d.action === 'approve' || d.action === 'reject'),
    );
    if (!activeDecision) continue;

    const laterStepsHaveActivity = round.steps
      .slice(stepIdx + 1)
      .some((s) => s.decisions.some((d) => !d.recalledAt));
    if (laterStepsHaveActivity) throw new HttpError(409, 'มีคนกดในขั้นถัดไปแล้ว ดึงกลับไม่ได้');

    const result = await collection().findOneAndUpdate(
      {
        _id: submission._id,
        version: expectedVersion ?? submission.version,
        status: 'pending',
      },
      {
        $set: {
          [`rounds.${roundIdx}.steps.${stepIdx}.decisions.$[d].recalledAt`]: now,
          [`rounds.${roundIdx}.steps.${stepIdx}.enteredAt`]: now,
          status: 'pending',
          current: {
            round: submission.current.round,
            stepIndex: stepIdx,
            stepId: step.stepId,
            stepName: step.name,
            approverEmpIds: step.approvers.map((a) => a.emp_id),
            enteredAt: now,
            deadlineAt: null,
          },
          updatedAt: now,
        },
        $inc: { version: 1 },
      },
      {
        arrayFilters: [{ 'd.emp_id': empId, 'd.at': activeDecision.at }],
        returnDocument: 'after',
      },
    );
    if (!result) throw new HttpError(409, 'คำร้องนี้เพิ่งมีการเปลี่ยนแปลง กรุณาโหลดหน้าใหม่');
    // §9.1: notify whoever had it in their queue right before this recall
    // (a later step's approvers) that it's gone from their queue now.
    if (submission.current.stepIndex !== stepIdx) {
      await notifyMany(submission.current.approverEmpIds, {
        type: 'recalled_from_queue',
        subject: `${result.docNumber || ''} ถูกดึงกลับ`,
        body: '',
        link: `/submissions/${result._id}`,
      });
    }
    return result;
  }

  throw new HttpError(403, 'ไม่มีการอนุมัติของคุณที่ดึงกลับได้ในขณะนี้');
}

export async function cancelSubmission(id, empId, { now = new Date(), expectedVersion } = {}) {
  // §8.1: only a draft that WAS submitted before (has a doc number) needs
  // "cancel" — one that was never submitted is just deleted (deleteDraft).
  const filter = {
    _id: toObjectId(id),
    'submitter.emp_id': empId,
    status: 'draft',
    docNumber: { $ne: null },
  };
  if (expectedVersion !== undefined) filter.version = expectedVersion;
  const result = await collection().findOneAndUpdate(
    filter,
    { $set: { status: 'cancelled', finishedAt: now, updatedAt: now }, $inc: { version: 1 } },
    { returnDocument: 'after' },
  );
  if (!result) throw new HttpError(409, 'ยกเลิกไม่ได้ — คำร้องนี้ไม่ใช่ร่างที่เคยส่งแล้ว หรือไม่ใช่ของคุณ');
  return result;
}

const DECISION_ACTION_LABEL = {
  approve: 'อนุมัติ',
  reject: 'ไม่อนุมัติ',
  return: 'ส่งกลับแก้ไข',
};

function approverName(step, empId) {
  return step.approvers.find((a) => a.emp_id === empId)?.name ?? empId;
}

// §10.4: "ไทม์ไลน์ ทุกเหตุการณ์ทุกรอบ" — flatten every round's submit,
// every decision (including ones later recalled — kept, just marked), and
// every comment into one chronological list.
export function buildTimeline(submission) {
  const events = [];

  submission.rounds.forEach((round) => {
    events.push({
      at: round.submittedAt,
      kind: 'submitted',
      round: round.round,
      actorName: submission.submitter.name,
      text: round.round === 1 ? 'ส่งคำร้อง' : `ส่งใหม่ (รอบที่ ${round.round})`,
    });
    round.steps.forEach((step) => {
      step.decisions.forEach((d) => {
        events.push({
          at: d.at,
          kind: 'decision',
          round: round.round,
          actorName: approverName(step, d.emp_id),
          stepName: step.name,
          actionLabel: DECISION_ACTION_LABEL[d.action] ?? d.action,
          comment: d.comment,
          recalled: Boolean(d.recalledAt),
        });
        if (d.recalledAt) {
          events.push({
            at: d.recalledAt,
            kind: 'recalled',
            round: round.round,
            actorName: approverName(step, d.emp_id),
            stepName: step.name,
          });
        }
      });
    });
    if (round.endedBy === 'rejected' || round.endedBy === 'approved') {
      // Already implied by the last decision event above — nothing extra
      // to add, kept as a branch for clarity/future round-end reasons.
    }
  });

  (submission.comments ?? []).forEach((c) => {
    events.push({ at: c.at, kind: 'comment', actorName: c.name, text: c.text });
  });

  if (submission.status === 'cancelled' && submission.finishedAt) {
    events.push({ at: submission.finishedAt, kind: 'cancelled', actorName: submission.submitter.name });
  }

  events.sort((a, b) => new Date(a.at) - new Date(b.at));
  return events;
}

// §8.1/§10.4: "ยื่นใหม่จากใบนี้" — a fresh draft (new doc number when it's
// eventually submitted) pre-filled with this one's values. Only the
// original submitter, and only once this submission has actually finished
// (there's nothing to "start over from" while it's still live).
export async function resubmitFrom(id, empId) {
  const original = await getSubmissionById(id);
  if (!original) throw new HttpError(404, 'ไม่พบคำร้อง');
  if (original.submitter.emp_id !== empId) throw new HttpError(403, 'ไม่มีสิทธิ์ยื่นใหม่จากคำร้องนี้');
  if (!['approved', 'rejected', 'cancelled'].includes(original.status)) {
    throw new HttpError(409, 'ยื่นใหม่ได้เฉพาะคำร้องที่จบแล้ว');
  }
  const user = await findUserByEmpId(empId);
  const draft = await createDraft(user, original.formId);
  await collection().updateOne({ _id: draft._id }, { $set: { values: original.values, updatedAt: new Date() } });
  return { ...draft, values: original.values };
}

function relatedEmpIds(submission) {
  const ids = new Set([submission.submitter.emp_id]);
  for (const round of submission.rounds ?? []) {
    for (const step of round.steps ?? []) {
      for (const a of step.approvers) ids.add(a.emp_id);
    }
  }
  return ids;
}

export async function addComment(id, empId, name, text, { now = new Date() } = {}) {
  const trimmed = text.trim();
  if (trimmed.length === 0) throw new HttpError(400, 'กรุณากรอกความเห็น');
  const submission = await getSubmissionById(id);
  if (!submission) throw new HttpError(404, 'ไม่พบคำร้อง');
  if (!isRelatedToSubmission(submission, empId)) throw new HttpError(403, 'คุณไม่มีสิทธิ์แสดงความเห็นในคำร้องนี้');
  await collection().updateOne(
    { _id: submission._id },
    { $push: { comments: { emp_id: empId, name, text: trimmed, at: now } }, $set: { updatedAt: now } },
  );

  // §9.1: "มีความเห็นใหม่" -> everyone involved, except whoever just wrote it.
  const recipients = [...relatedEmpIds(submission)].filter((e) => e !== empId);
  await notifyMany(recipients, {
    type: 'comment',
    subject: `ความเห็นใหม่ใน ${submission.docNumber || (await subjectText(submission))}`,
    body: `${name}: ${trimmed}`,
    link: `/submissions/${submission._id}`,
  });
}
