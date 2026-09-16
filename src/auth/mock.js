// Dev-only login, used when AUTH_MODE=mock (§5.6). routes/auth.routes.js
// only mounts this router when AUTH_MODE is actually "mock" — under
// AUTH_MODE=sso these paths must 404, not just hide the button.

import { Router } from 'express';
import { orgApi } from '../org/client.js';
import { upsertUserFromOrg } from '../models/users.js';
import { startSession } from './session.js';
import { env } from '../config/env.js';
import { writeAuditLog } from '../models/auditLog.js';

export const mockAuthRouter = Router();

mockAuthRouter.get('/login', async (req, res) => {
  const employees = await orgApi.allEmployees({ active: '1' });
  res.render('login-mock', { employees });
});

mockAuthRouter.post('/mock-login', async (req, res) => {
  const emp = await orgApi.employee(req.body.emp_id);
  if (!emp || emp.is_active === false) {
    return res.status(400).render('auth-error', {
      message: 'บัญชีนี้ไม่ได้ใช้งานแล้ว หรือไม่พบพนักงานนี้',
    });
  }
  await upsertUserFromOrg(emp, { adminEmpIds: env.adminEmpIds, touchLastLogin: true });
  startSession(req, emp.emp_id);
  await writeAuditLog({
    actorEmpId: emp.emp_id,
    actorName: emp.name,
    action: 'login_mock',
    entityType: 'user',
    entityId: emp.emp_id,
    summary: `${emp.name} เข้าสู่ระบบ (mock)`,
  });
  res.redirect('/');
});

mockAuthRouter.post('/logout', async (req, res) => {
  const empId = req.session?.emp_id;
  req.session = null;
  if (empId) {
    await writeAuditLog({
      actorEmpId: empId,
      actorName: empId,
      action: 'logout',
      entityType: 'user',
      entityId: empId,
      summary: `${empId} ออกจากระบบ`,
    });
  }
  res.redirect('/auth/login');
});
