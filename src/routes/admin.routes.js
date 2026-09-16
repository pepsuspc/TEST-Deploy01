// §10.8 "/admin/settings" + §10.9 "/admin/audit" — both admin-only, gated
// by requireAdmin below rather than each handler checking req.user.roles
// itself (same "one central gate" principle §12.1 already uses for login).

import { Router } from 'express';
import multer from 'multer';
import { HttpError } from '../lib/httpError.js';
import { searchUsers, listUsersWithRoles, setUserRoles, findUserByEmpId } from '../models/users.js';
import { listLetterheads, createLetterhead, updateLetterhead, setLetterheadEnabled, setLetterheadLogo, deleteLetterhead } from '../models/letterheads.js';
import { getGlobalSettings } from '../models/settings.js';
import { syncUsers } from '../org/sync.js';
import { enqueueEmail, countQueued, countFailed } from '../models/emailQueue.js';
import { listAuditLogs } from '../models/auditLog.js';
import { writeAuditLog } from '../models/auditLog.js';

export const adminRouter = Router();

function asyncHandler(fn) {
  return (req, res, next) => fn(req, res, next).catch(next);
}

function requireAdmin(req, res, next) {
  if (!req.user.roles?.includes('admin')) throw new HttpError(403, 'ต้องเป็น admin เท่านั้น');
  next();
}
adminRouter.use(requireAdmin);

const logoUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 + 1024 } });

adminRouter.get(
  '/settings',
  asyncHandler(async (req, res) => {
    const [letterheads, roledUsers, settings] = await Promise.all([
      listLetterheads(),
      listUsersWithRoles(),
      getGlobalSettings(),
    ]);
    const q = req.query.q || '';
    const searchResults = q ? await searchUsers(q) : [];
    const [queuedEmails, failedEmails] = await Promise.all([countQueued(), countFailed()]);
    res.render('admin-settings', {
      user: req.user,
      letterheads,
      roledUsers,
      settings,
      q,
      searchResults,
      queuedEmails,
      failedEmails,
      testEmailSent: req.query.testEmailSent,
    });
  }),
);

adminRouter.post(
  '/settings/sync',
  asyncHandler(async (req, res) => {
    const { count } = await syncUsers();
    await writeAuditLog({
      actorEmpId: req.user.emp_id,
      actorName: req.user.name,
      action: 'org_sync_manual',
      entityType: 'settings',
      entityId: 'global',
      summary: `${req.user.name} สั่ง sync ผังองค์กรด้วยตนเอง (${count} คน)`,
    });
    res.redirect('/admin/settings');
  }),
);

adminRouter.post(
  '/settings/test-email',
  asyncHandler(async (req, res) => {
    const me = await findUserByEmpId(req.user.emp_id);
    if (!me?.email) throw new HttpError(400, 'บัญชีของคุณไม่มีอีเมลในระบบ');
    await enqueueEmail({
      to: me.email,
      subject: '[its-forms] อีเมลทดสอบ',
      body: `นี่คืออีเมลทดสอบจากหน้าตั้งค่าระบบ its-forms\nส่งโดย: ${req.user.name}\nเวลา: ${new Date().toISOString()}`,
    });
    res.redirect('/admin/settings?testEmailSent=1');
  }),
);

adminRouter.post(
  '/settings/roles',
  asyncHandler(async (req, res) => {
    const { empId } = req.body;
    if (!empId) throw new HttpError(400, 'กรุณาเลือกพนักงาน');
    const rawRoles = req.body.roles;
    const roles = Array.isArray(rawRoles) ? rawRoles : rawRoles ? [rawRoles] : [];
    await setUserRoles(empId, roles);
    await writeAuditLog({
      actorEmpId: req.user.emp_id,
      actorName: req.user.name,
      action: 'set_user_roles',
      entityType: 'user',
      entityId: empId,
      summary: `${req.user.name} ตั้งบทบาทของ ${empId} เป็น [${roles.join(', ') || '(ไม่มี)'}]`,
    });
    res.redirect('/admin/settings' + (req.body.returnQ ? `?q=${encodeURIComponent(req.body.returnQ)}` : ''));
  }),
);

adminRouter.post(
  '/settings/letterheads',
  asyncHandler(async (req, res) => {
    const { name, companyName, address, phone } = req.body;
    if (!name) throw new HttpError(400, 'กรุณากรอกชื่อหัวกระดาษ');
    const lh = await createLetterhead({ name, companyName, address, phone });
    await writeAuditLog({
      actorEmpId: req.user.emp_id,
      actorName: req.user.name,
      action: 'create_letterhead',
      entityType: 'settings',
      entityId: lh._id.toString(),
      summary: `${req.user.name} สร้างหัวกระดาษ "${name}"`,
    });
    res.redirect('/admin/settings');
  }),
);

adminRouter.post(
  '/settings/letterheads/:id',
  asyncHandler(async (req, res) => {
    const { name, companyName, address, phone } = req.body;
    await updateLetterhead(req.params.id, { name, companyName, address, phone });
    res.redirect('/admin/settings');
  }),
);

adminRouter.post(
  '/settings/letterheads/:id/logo',
  (req, res, next) => logoUpload.single('logo')(req, res, (err) => (err ? next(new HttpError(400, 'ไฟล์โลโก้ใหญ่เกินไป (สูงสุด 2 MB)')) : next())),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'ไม่มีไฟล์');
    await setLetterheadLogo(req.params.id, req.file.buffer, req.file.mimetype);
    res.redirect('/admin/settings');
  }),
);

adminRouter.post(
  '/settings/letterheads/:id/toggle',
  asyncHandler(async (req, res) => {
    await setLetterheadEnabled(req.params.id, req.body.enabled === '1');
    res.redirect('/admin/settings');
  }),
);

adminRouter.post(
  '/settings/letterheads/:id/delete',
  asyncHandler(async (req, res) => {
    await deleteLetterhead(req.params.id);
    res.redirect('/admin/settings');
  }),
);

// §10.9: append-only, no delete button anywhere in this UI.
adminRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const logs = await listAuditLogs(req.query);
    res.render('admin-audit', { user: req.user, logs, query: req.query });
  }),
);
