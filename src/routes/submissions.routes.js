import { Router } from 'express';
import {
  createDraft,
  getSubmissionById,
  saveDraftValues,
  deleteDraft,
  submitDraft,
  decideStep,
  recallDecision,
  cancelSubmission,
  addComment,
  elementsFor,
  isRelatedToSubmission,
  canDecide,
  canRecall,
  canCancel,
} from '../models/submissions.js';
import { HttpError } from '../lib/httpError.js';

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

// GET /submissions/new -- create a blank draft and go straight to editing it
submissionsRouter.get(
  '/new',
  asyncHandler(async (req, res) => {
    const draft = await createDraft(req.user);
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
    res.render('memo-a4', {
      mode: 'edit',
      submission,
      elements: elementsFor(submission),
      errors: {},
      user: req.user,
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

submissionsRouter.post(
  '/:id/submit',
  asyncHandler(async (req, res) => {
    const values = req.body.values || {};
    const result = await submitDraft(req.params.id, req.user.emp_id, { values, expectedVersion: clientVersion(req) });
    if (!result.ok) {
      return res.status(422).render('memo-a4', {
        mode: 'edit',
        submission: result.submission,
        elements: elementsFor(result.submission),
        errors: result.errors || {},
        blocked: result.blocked,
        user: req.user,
      });
    }
    res.redirect(`/submissions/${result.submission._id}`);
  }),
);

submissionsRouter.post(
  '/:id/delete',
  asyncHandler(async (req, res) => {
    await deleteDraft(req.params.id, req.user.emp_id);
    res.redirect('/inbox');
  }),
);

submissionsRouter.post(
  '/:id/decide',
  asyncHandler(async (req, res) => {
    const { action, comment } = req.body; // action: approve | reject | return
    if (!['approve', 'reject', 'return'].includes(action)) throw new HttpError(400, 'action ไม่ถูกต้อง');
    await decideStep(req.params.id, req.user.emp_id, action, {
      comment: comment || '',
      expectedVersion: clientVersion(req),
    });
    res.redirect(`/submissions/${req.params.id}`);
  }),
);

submissionsRouter.post(
  '/:id/recall',
  asyncHandler(async (req, res) => {
    await recallDecision(req.params.id, req.user.emp_id, { expectedVersion: clientVersion(req) });
    res.redirect(`/submissions/${req.params.id}`);
  }),
);

submissionsRouter.post(
  '/:id/cancel',
  asyncHandler(async (req, res) => {
    await cancelSubmission(req.params.id, req.user.emp_id, { expectedVersion: clientVersion(req) });
    res.redirect(`/submissions/${req.params.id}`);
  }),
);

submissionsRouter.post(
  '/:id/comment',
  asyncHandler(async (req, res) => {
    await addComment(req.params.id, req.user.emp_id, req.user.name, req.body.text || '');
    res.redirect(`/submissions/${req.params.id}`);
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
    res.render('memo-a4', {
      mode: 'view',
      submission,
      elements: elementsFor(submission),
      errors: {},
      user: req.user,
      canDecide: canDecide(submission, req.user.emp_id),
      canRecall: canRecall(submission, req.user.emp_id),
      canCancel: canCancel(submission, req.user.emp_id),
    });
  }),
);
