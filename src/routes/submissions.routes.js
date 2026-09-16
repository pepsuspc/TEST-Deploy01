import { Router } from 'express';
import {
  createDraft,
  getSubmissionById,
  saveDraftValues,
  deleteDraft,
  submitDraft,
  previewResolvedSteps,
  decideStep,
  recallDecision,
  cancelSubmission,
  resubmitFrom,
  addComment,
  formContextFor,
  submitterChoiceSlots,
  isRelatedToSubmission,
  canDecide,
  canRecall,
  canCancel,
  buildTimeline,
} from '../models/submissions.js';
import { orgApi } from '../org/client.js';
import { HttpError } from '../lib/httpError.js';
import { writeAuditLog } from '../models/auditLog.js';

// §10.3: fetch the employee list only when the form actually has a
// submitter_choice slot to fill -- no need to hit the org API on every
// edit-page load otherwise.
async function loadChoiceContext(workflowSteps) {
  const slots = submitterChoiceSlots(workflowSteps);
  if (slots.length === 0) return { slots, employees: [] };
  const employees = await orgApi.allEmployees({ active: '1' });
  return { slots, employees };
}

export const submissionsRouter = Router();

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// §8.9: the version guard should use what the CLIENT's page last rendered,
// sent back with the request — not a version the server re-reads at
// request time (that would only catch a race within this one request).
function clientVersion(req) {
  return req.body.version !== undefined ? Number(req.body.version) : undefined;
}

// GET /submissions/new?form=<id> -- create a blank draft and go straight to editing it
submissionsRouter.get(
  '/new',
  asyncHandler(async (req, res) => {
    if (!req.query.form) throw new HttpError(400, 'ต้องระบุฟอร์ม');
    const draft = await createDraft(req.user, req.query.form);
    res.redirect(`/submissions/${draft._id}/edit`);
  }),
);

submissionsRouter.get(
  '/:id/edit',
  asyncHandler(async (req, res) => {
    const submission = await getSubmissionById(req.params.id);
    if (!submission) throw new HttpError(404, 'ไม่พบคำร้อง');
    if (submission.submitter.emp_id !== req.user.emp_id) {
      throw new HttpError(403, 'ไม่มีสิทธิ์แก้ไขคำร้องนี้');
    }
    if (submission.status !== 'draft') {
      throw new HttpError(409, 'คำร้องนี้ไม่ได้อยู่ในสถานะร่างแล้ว — เปิดดูแทน');
    }
    const { elements, formName, workflowSteps, letterhead } = await formContextFor(submission);
    const { slots, employees } = await loadChoiceContext(workflowSteps);
    res.render('memo-a4', {
      mode: 'edit',
      submission,
      elements,
      formName,
      letterhead,
      errors: {},
      user: req.user,
      submitterChoiceSlots: slots,
      choiceEmployees: employees,
    });
  }),
);

submissionsRouter.post(
  '/:id/save',
  asyncHandler(async (req, res) => {
    const values = req.body.values || {};
    const updated = await saveDraftValues(req.params.id, req.user.emp_id, values, {
      expectedVersion: clientVersion(req),
    });
    if (req.get('accept')?.includes('application/json')) {
      return res.json({ ok: true, savedAt: updated.updatedAt, version: updated.version });
    }
    res.redirect(`/submissions/${updated._id}/edit`);
  }),
);
// (save-draft is autosaved every few seconds — logging every tick would
// flood audit_logs with noise nobody would ever read; submit/decide/
// recall/cancel/comment below are the meaningful, infrequent actions §12
// actually cares about seeing a trail of.)

// §10.3 "หน้ายืนยัน": resolve-only, no side effects -- lets the edit page
// show who this will actually go to before the real submit.
submissionsRouter.post(
  '/:id/resolve-preview',
  asyncHandler(async (req, res) => {
    const result = await previewResolvedSteps(req.params.id, req.user.emp_id, req.body.submitterChoices || {});
    res.json(result);
  }),
);

submissionsRouter.post(
  '/:id/submit',
  asyncHandler(async (req, res) => {
    const values = req.body.values || {};
    const submitterChoices = req.body.submitterChoices || {};
    const result = await submitDraft(req.params.id, req.user.emp_id, {
      values,
      submitterChoices,
      expectedVersion: clientVersion(req),
    });
    if (!result.ok) {
      const { elements, formName, workflowSteps, letterhead } = await formContextFor(result.submission);
      const { slots, employees } = await loadChoiceContext(workflowSteps);
      return res.status(422).render('memo-a4', {
        mode: 'edit',
        submission: result.submission,
        elements,
        formName,
        letterhead,
        errors: result.errors || {},
        blocked: result.blocked,
        user: req.user,
        submitterChoiceSlots: slots,
        choiceEmployees: employees,
      });
    }
    await writeAuditLog({
      actorEmpId: req.user.emp_id,
      actorName: req.user.name,
      action: 'submit',
      entityType: 'submission',
      entityId: req.params.id,
      summary: `${req.user.name} ส่งคำร้อง ${result.submission.docNumber}`,
    });
    res.redirect(`/submissions/${result.submission._id}`);
  }),
);

submissionsRouter.post(
  '/:id/delete',
  asyncHandler(async (req, res) => {
    await deleteDraft(req.params.id, req.user.emp_id);
    await writeAuditLog({
      actorEmpId: req.user.emp_id,
      actorName: req.user.name,
      action: 'delete_draft',
      entityType: 'submission',
      entityId: req.params.id,
      summary: `${req.user.name} ลบร่าง`,
    });
    res.redirect('/inbox');
  }),
);

submissionsRouter.post(
  '/:id/decide',
  asyncHandler(async (req, res) => {
    const { action, comment } = req.body; // action: approve | reject | return
    if (!['approve', 'reject', 'return'].includes(action)) throw new HttpError(400, 'action ไม่ถูกต้อง');
    const result = await decideStep(req.params.id, req.user.emp_id, action, {
      comment: comment || '',
      expectedVersion: clientVersion(req),
    });
    await writeAuditLog({
      actorEmpId: req.user.emp_id,
      actorName: req.user.name,
      action: `decide_${action}`,
      entityType: 'submission',
      entityId: req.params.id,
      summary: `${req.user.name} กด "${action}" บน ${result.docNumber || req.params.id}`,
    });
    res.redirect(`/submissions/${req.params.id}`);
  }),
);

submissionsRouter.post(
  '/:id/recall',
  asyncHandler(async (req, res) => {
    const result = await recallDecision(req.params.id, req.user.emp_id, { expectedVersion: clientVersion(req) });
    await writeAuditLog({
      actorEmpId: req.user.emp_id,
      actorName: req.user.name,
      action: 'recall',
      entityType: 'submission',
      entityId: req.params.id,
      summary: `${req.user.name} ดึงกลับบน ${result.docNumber || req.params.id}`,
    });
    res.redirect(`/submissions/${req.params.id}`);
  }),
);

submissionsRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    const result = await cancelSubmission(req.params.id, req.user.emp_id, { expectedVersion: clientVersion(req) });
    await writeAuditLog({
      actorEmpId: req.user.emp_id,
      actorName: req.user.name,
      action: 'cancel',
      entityType: 'submission',
      entityId: req.params.id,
      summary: `${req.user.name} ยกเลิก ${result.docNumber || req.params.id}`,
    });
    res.redirect(`/submissions/${req.params.id}`);
  }),
);

submissionsRouter.post(
  '/:id/comment',
  asyncHandler(async (req, res) => {
    await addComment(req.params.id, req.user.emp_id, req.user.name, req.body.text || '');
    await writeAuditLog({
      actorEmpId: req.user.emp_id,
      actorName: req.user.name,
      action: 'comment',
      entityType: 'submission',
      entityId: req.params.id,
      summary: `${req.user.name} แสดงความเห็น`,
    });
    res.redirect(`/submissions/${req.params.id}`);
  }),
);

submissionsRouter.post(
  '/:id/resubmit-from',
  asyncHandler(async (req, res) => {
    const draft = await resubmitFrom(req.params.id, req.user.emp_id);
    await writeAuditLog({
      actorEmpId: req.user.emp_id,
      actorName: req.user.name,
      action: 'resubmit_from',
      entityType: 'submission',
      entityId: req.params.id,
      summary: `${req.user.name} ยื่นใหม่จาก ${req.params.id} เป็นร่างใหม่ ${draft._id}`,
    });
    res.redirect(`/submissions/${draft._id}/edit`);
  }),
);

submissionsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const submission = await getSubmissionById(req.params.id);
    if (!submission) throw new HttpError(404, 'ไม่พบคำร้อง');
    // §4: a submission is confidential to "people involved" — not just a
    // hidden link, the server itself must refuse (403, not a quiet 404).
    if (!isRelatedToSubmission(submission, req.user.emp_id) && !req.user.roles?.includes('admin')) {
      throw new HttpError(403, 'คุณไม่มีสิทธิ์ดูคำร้องนี้');
    }
    const { elements, formName, letterhead } = await formContextFor(submission);
    res.render('memo-a4', {
      mode: 'view',
      submission,
      elements,
      formName,
      letterhead,
      errors: {},
      user: req.user,
      canDecide: canDecide(submission, req.user.emp_id),
      canRecall: canRecall(submission, req.user.emp_id),
      canCancel: canCancel(submission, req.user.emp_id),
      timeline: buildTimeline(submission),
    });
  }),
);
