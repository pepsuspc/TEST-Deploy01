// Data-access + workflow transitions for the `submissions` collection.
// §11.1: one document per submission, embedding the snapshot, values, and
// the full round/decision history — every state change here is a single
// findOneAndUpdate with a `version` guard, never a multi-step transaction
// (§3.2, §8.9), because production Mongo is standalone.

import { ObjectId } from 'mongodb';
import { getDb } from '../db/connection.js';
import { findUserByEmpId } from './users.js';
import { nextDocNumber } from '../domain/docNumber.js';
import { validateValues } from '../domain/validateField.js';
import { evaluateStep } from '../domain/evaluateStep.js';
import {
  MEMO_ELEMENTS,
  MEMO_FORM_ID,
  MEMO_FORM_NAME,
  MEMO_FORM_VERSION,
  MEMO_DOC_PREFIX,
  MEMO_STEPS,
} from '../domain/memoFormDef.js';
import { HttpError } from '../lib/httpError.js';

function collection() {
  return getDb().collection('submissions');
}

function toObjectId(id) {
  if (!ObjectId.isValid(id)) throw new HttpError(404, 'ไม่พบคำร้อง');
  return new ObjectId(id);
}

export async function createDraft(user) {
  const now = new Date();
  const doc = {
    // docNumber is intentionally OMITTED (not set to null) until first
    // submit. The unique index on it is `sparse`, which only excludes
    // documents where the field is truly *missing* — an explicit `null` is
    // still a value and still gets indexed, so every second draft ever
    // created would collide on it (found by testing, not by inspection).
    formId: MEMO_FORM_ID,
    formVersion: MEMO_FORM_VERSION,
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
    autoValues: {},
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
// element's value, generically (works whether elements come from the
// hardcoded chunk-1 def or a future real form snapshot).
export function subjectText(submission) {
  const firstShortText = elementsFor(submission).find((el) => el.type === 'short_text');
  if (!firstShortText) return '';
  return (submission.values && submission.values[firstShortText.id]) || '';
}

// The elements to render this submission against: once it has ever been
// submitted, always use the frozen snapshot (§7.8) — never the live form
// definition, even if the submission has since bounced back to `draft` via
// a return/recall. A submission that has never been submitted has no
// snapshot yet, so it reads the live definition.
export function elementsFor(submission) {
  return submission.snapshot?.elements ?? MEMO_ELEMENTS;
}

export async function saveDraftValues(id, empId, values, { expectedVersion } = {}) {
  const filter = { _id: toObjectId(id), 'submitter.emp_id': empId, status: 'draft' };
  if (expectedVersion !== undefined) filter.version = expectedVersion;
  const result = await collection().findOneAndUpdate(
    filter,
    { $set: { values, updatedAt: new Date() }, $inc: { version: 1 } },
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

// Resolve one MEMO_STEPS entry into an approver (§7.5/§D.7). Chunk 1 only
// supports the two rules MEMO_STEPS actually uses; the full 3-type
// resolver (user/relative/submitter_choice) with dedup is chunk 3.
async function resolveStepApprover(stepDef, submitterUser) {
  if (stepDef.resolve === 'chief') {
    const chief = submitterUser.chief;
    if (!chief?.emp_id) return { blocked: 'ไม่พบหัวหน้าโดยตรงของคุณในระบบ ติดต่อฝ่ายไอที' };
    const chiefUser = await findUserByEmpId(chief.emp_id);
    if (chiefUser && chiefUser.is_active === false) {
      return { blocked: 'หัวหน้าของคุณไม่ได้อยู่ในระบบแล้ว ติดต่อฝ่ายไอที' };
    }
    return { approver: { emp_id: chief.emp_id, name: chiefUser?.name ?? chief.name, source: 'relative:chief' } };
  }
  if (stepDef.resolve === 'fixed') {
    const user = await findUserByEmpId(stepDef.fixedEmpId);
    if (!user || user.is_active === false) {
      return { blocked: `ไม่พบผู้อนุมัติของขั้น "${stepDef.name}" ในระบบ ติดต่อฝ่ายไอที` };
    }
    return { approver: { emp_id: user.emp_id, name: user.name, source: 'fixed' } };
  }
  throw new Error(`unknown resolve rule: ${stepDef.resolve}`);
}

async function resolveAllSteps(submitterUser) {
  const steps = [];
  for (const stepDef of MEMO_STEPS) {
    const resolved = await resolveStepApprover(stepDef, submitterUser);
    if (resolved.blocked) return { blocked: resolved.blocked };
    steps.push({
      stepId: stepDef.stepId,
      name: stepDef.name,
      quorum: 1,
      approvers: [resolved.approver],
      enteredAt: null,
      deadlineAt: null,
      decisions: [],
    });
  }
  return { steps };
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

  if (values) draft.values = values;

  const elements = elementsFor(draft);
  const errors = validateValues(elements, draft.values);
  if (Object.keys(errors).length > 0) return { ok: false, errors, submission: draft };

  const submitterUser = await findUserByEmpId(empId);
  // §D.7: every step's approver is resolved before a doc number is spent —
  // blocking must happen before we issue one, not after.
  const resolved = await resolveAllSteps(submitterUser);
  if (resolved.blocked) return { ok: false, blocked: resolved.blocked, submission: draft };

  const now = new Date();
  const isFirstSubmit = !draft.docNumber;
  const docNumber = isFirstSubmit ? await nextDocNumber(getDb(), MEMO_DOC_PREFIX, { now }) : draft.docNumber;
  const submittedAt = isFirstSubmit ? now : draft.submittedAt;
  const round = (draft.rounds?.length || 0) + 1;

  const steps = resolved.steps;
  steps[0].enteredAt = now; // only the first step is "entered" at submit time

  const result = await collection().findOneAndUpdate(
    { _id: draft._id, version: expectedVersion ?? draft.version, status: 'draft' },
    {
      $set: {
        status: 'pending',
        values: draft.values,
        docNumber,
        submittedAt,
        formVersion: MEMO_FORM_VERSION,
        snapshot: draft.snapshot ?? { formName: MEMO_FORM_NAME, elements: MEMO_ELEMENTS },
        autoValues: { el_date: submittedAt },
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
    const outcome = evaluateStep(step, [...step.decisions, decision]);
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
      const nextStep = submission.rounds[roundIdx].steps[nextStepIdx];
      if (nextStep) {
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
  return result;
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
}
