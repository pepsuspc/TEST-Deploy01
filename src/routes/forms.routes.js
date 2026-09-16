import { Router } from 'express';
import {
  listPublishedFormsFor,
  listFormsOwnedBy,
  createForm,
  getFormById,
  updateFormMeta,
  saveElements,
  publishForm,
  closeForm,
  reopenForm,
  deleteForm,
  cloneForm,
  isFormOwner,
} from '../models/forms.js';
import { listSubmissionsForForm } from '../models/submissions.js';
import { orgApi } from '../org/client.js';
import { FIELD_TYPES, AUTO_SOURCES, defaultPropsFor } from '../domain/fieldTypes.js';
import { buildSampleSubmission } from '../domain/sampleValues.js';
import { HttpError } from '../lib/httpError.js';
import { writeAuditLog } from '../models/auditLog.js';

export const formsRouter = Router();
export const manageFormsRouter = Router();

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

// §10.2 "/forms" — every employee, published forms they're allowed to submit.
formsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const forms = await listPublishedFormsFor(req.user);
    const byCategory = {};
    for (const f of forms) {
      (byCategory[f.category] ??= []).push(f);
    }
    res.render('forms-picker', { byCategory, user: req.user });
  }),
);

// §10.5 "/manage/forms" — forms this employee owns or co-owns.
manageFormsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    requireFormOwnerRole(req);
    const forms = await listFormsOwnedBy(req.user.emp_id);
    res.render('manage-forms-list', { forms, user: req.user });
  }),
);

// §4: creating forms is a system-level role ("ผู้ดูแลฟอร์ม"), admin-granted
// — chunk 4 builds the UI to grant it; until then, admin (from
// ADMIN_EMP_IDS) is the only bootstrapped form_owner.
function requireFormOwnerRole(req) {
  const roles = req.user.roles || [];
  if (!roles.includes('admin') && !roles.includes('form_owner')) {
    throw new HttpError(403, 'ต้องเป็นผู้ดูแลฟอร์มหรือ admin เท่านั้น');
  }
}

manageFormsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    requireFormOwnerRole(req);
    const { name, category, docPrefix } = req.body;
    if (!name || !category || !docPrefix) throw new HttpError(400, 'กรุณากรอกให้ครบ');
    const form = await createForm({ name, category, docPrefix: docPrefix.toUpperCase(), ownerEmpId: req.user.emp_id });
    await writeAuditLog({
      actorEmpId: req.user.emp_id,
      actorName: req.user.name,
      action: 'create_form',
      entityType: 'form',
      entityId: form._id.toString(),
      summary: `${req.user.name} สร้างฟอร์ม "${form.name}"`,
    });
    res.redirect(`/manage/forms/${form._id}/design`);
  }),
);

async function loadOwnedForm(req) {
  const form = await getFormById(req.params.id);
  if (!form) throw new HttpError(404, 'ไม่พบฟอร์ม');
  if (!isFormOwner(form, req.user.emp_id)) throw new HttpError(403, 'ไม่มีสิทธิ์');
  return form;
}

manageFormsRouter.get(
  '/:id/design',
  asyncHandler(async (req, res) => {
    const form = await loadOwnedForm(req);
    const defaultPropsByType = Object.fromEntries(FIELD_TYPES.map((ft) => [ft.type, defaultPropsFor(ft.type)]));
    res.render('form-design', {
      form,
      user: req.user,
      tab: 'design',
      fieldTypes: FIELD_TYPES,
      defaultPropsByType,
      autoSources: AUTO_SOURCES,
    });
  }),
);

manageFormsRouter.post(
  '/:id/elements',
  asyncHandler(async (req, res) => {
    const elements = JSON.parse(req.body.elements || '[]');
    const form = await saveElements(req.params.id, req.user.emp_id, elements);
    res.json({ ok: true, formVersion: form.formVersion, updatedAt: form.updatedAt });
  }),
);

// §7.2/§10.6 "ดูตัวอย่าง" — renders the in-progress (possibly unsaved)
// layout through the exact same view-mode template a real submission
// uses, fed fabricated values, so what the designer shows is provably the
// same renderer a filled-in form would use — not a second reimplementation
// that could quietly drift from it.
manageFormsRouter.post(
  '/:id/preview',
  asyncHandler(async (req, res) => {
    const form = await loadOwnedForm(req);
    const elements = JSON.parse(req.body.elements || '[]');
    const submission = buildSampleSubmission({ formName: form.name, elements });
    res.render('memo-a4', {
      mode: 'view',
      submission,
      elements,
      formName: form.name,
      errors: {},
      user: req.user,
      canDecide: false,
      canRecall: false,
      canCancel: false,
      timeline: [],
    });
  }),
);

manageFormsRouter.get(
  '/:id/settings',
  asyncHandler(async (req, res) => {
    const form = await loadOwnedForm(req);
    const departments = await orgApi.departments();
    res.render('form-settings', { form, departments, user: req.user, tab: 'settings' });
  }),
);

manageFormsRouter.post(
  '/:id/settings',
  asyncHandler(async (req, res) => {
    const { name, category, description, allowAllDepartments } = req.body;
    const rawAllowed = req.body.allowedDepartmentIds;
    const selected = Array.isArray(rawAllowed) ? rawAllowed : rawAllowed ? [rawAllowed] : [];
    await updateFormMeta(req.params.id, req.user.emp_id, {
      name,
      category,
      description,
      allowedDepartmentIds: allowAllDepartments === 'on' ? [] : selected,
    });
    res.redirect(`/manage/forms/${req.params.id}/settings`);
  }),
);

manageFormsRouter.post(
  '/:id/publish',
  asyncHandler(async (req, res) => {
    const form = await publishForm(req.params.id, req.user.emp_id);
    await writeAuditLog({
      actorEmpId: req.user.emp_id,
      actorName: req.user.name,
      action: 'publish_form',
      entityType: 'form',
      entityId: form._id.toString(),
      summary: `${req.user.name} เผยแพร่ฟอร์ม "${form.name}"`,
    });
    res.redirect(`/manage/forms/${req.params.id}/settings`);
  }),
);

manageFormsRouter.post(
  '/:id/close',
  asyncHandler(async (req, res) => {
    const form = await closeForm(req.params.id, req.user.emp_id);
    await writeAuditLog({
      actorEmpId: req.user.emp_id,
      actorName: req.user.name,
      action: 'close_form',
      entityType: 'form',
      entityId: form._id.toString(),
      summary: `${req.user.name} ปิดรับฟอร์ม "${form.name}"`,
    });
    res.redirect(`/manage/forms/${req.params.id}/settings`);
  }),
);

manageFormsRouter.post(
  '/:id/reopen',
  asyncHandler(async (req, res) => {
    await reopenForm(req.params.id, req.user.emp_id);
    res.redirect(`/manage/forms/${req.params.id}/settings`);
  }),
);

manageFormsRouter.post(
  '/:id/delete',
  asyncHandler(async (req, res) => {
    await deleteForm(req.params.id, req.user.emp_id);
    res.redirect('/manage/forms');
  }),
);

manageFormsRouter.post(
  '/:id/clone',
  asyncHandler(async (req, res) => {
    const copy = await cloneForm(req.params.id, req.user.emp_id);
    res.redirect(`/manage/forms/${copy._id}/design`);
  }),
);

// §10.7 "/manage/forms/{id}/submissions"
manageFormsRouter.get(
  '/:id/submissions',
  asyncHandler(async (req, res) => {
    const form = await loadOwnedForm(req);
    const submissions = await listSubmissionsForForm(form._id.toString(), req.query);
    res.render('form-submissions', { form, submissions, user: req.user, query: req.query });
  }),
);
