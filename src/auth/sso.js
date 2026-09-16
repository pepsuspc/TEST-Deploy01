// Real SSO login against sellcenter (§5 of docs/requirement.md). Used when
// AUTH_MODE=sso. NOTE: this code follows the spec's 5-step flow and
// checklist (§5.8) exactly, but has not been exercised against a real
// digital.in.th + ORG_API_TOKEN — only AUTH_MODE=mock has been live-tested
// in this environment. Run through the §5.8 checklist against real
// credentials before trusting this in production.

import { Router } from 'express';
import crypto from 'node:crypto';
import { env } from '../config/env.js';
import { orgApi } from '../org/client.js';
import { upsertUserFromOrg } from '../models/users.js';
import { startSession } from './session.js';
import { writeAuditLog } from '../models/auditLog.js';

export const ssoAuthRouter = Router();

const STATE_COOKIE = 'sso_state';
const STATE_MAX_AGE_MS = 5 * 60 * 1000;

// GET /auth/login — §5.2
ssoAuthRouter.get('/login', (req, res) => {
  const state = crypto.randomBytes(16).toString('base64url');
  res.cookie(STATE_COOKIE, state, {
    httpOnly: true,
    maxAge: STATE_MAX_AGE_MS,
    sameSite: 'lax',
    secure: env.appUrl.startsWith('https://'),
  });
  const redirectUri = `${env.appUrl}/auth/callback?state=${state}`;
  const url = new URL('/system81/login', env.sellcenterUrl);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('app_name', 'its-forms');
  res.redirect(url.toString());
});

// GET /auth/callback — §5.3, §5.4, §5.5
ssoAuthRouter.get('/callback', async (req, res) => {
  const { state, token } = req.query;

  // §5.3.1: state must match the cookie and not be expired/missing.
  if (!state || !token || state !== req.cookies?.[STATE_COOKIE]) {
    return res.status(400).render('auth-error', { message: 'เซสชัน SSO หมดอายุ กรุณาลองใหม่' });
  }
  res.clearCookie(STATE_COOKIE); // §5.3.2: state is single-use

  // §5.4: verify the token with sellcenter — we never decode/verify the JWT ourselves.
  let userInfo;
  try {
    const r = await fetch(new URL('/system81/userinfo', env.sellcenterUrl), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5000),
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.success || !body.user?.emp_id) {
      throw new Error(`userinfo rejected token (status ${r.status})`);
    }
    userInfo = body.user;
  } catch (err) {
    return res.status(400).render('auth-error', { message: 'เข้าสู่ระบบไม่สำเร็จ ลองใหม่' });
  }

  // §5.5.1-2: fetch full profile from the org API; is_active=false blocks login.
  let emp = null;
  let orgApiDown = false;
  try {
    emp = await orgApi.employee(userInfo.emp_id);
  } catch (err) {
    orgApiDown = true; // §5.5.4: org API being down must not block login entirely
  }

  if (emp && emp.is_active === false) {
    return res.status(403).render('auth-error', { message: 'บัญชีนี้ไม่ได้ใช้งานแล้ว' });
  }

  if (orgApiDown) {
    // Fall back to whatever we already have cached; if we've truly never
    // seen this person, log them in with just the bare userinfo fields.
    const existing = await import('../models/users.js').then((m) => m.findUserByEmpId(userInfo.emp_id));
    emp = existing ?? {
      emp_id: userInfo.emp_id,
      id: userInfo.sub,
      email: userInfo.username,
      name: userInfo.name,
      nickname: '',
      department: null,
      position: null,
      chief: null,
      is_active: true,
    };
  }

  await upsertUserFromOrg(emp, { adminEmpIds: env.adminEmpIds, touchLastLogin: true });
  startSession(req, userInfo.emp_id);
  await writeAuditLog({
    actorEmpId: userInfo.emp_id,
    actorName: emp.name,
    action: 'login_sso',
    entityType: 'user',
    entityId: userInfo.emp_id,
    summary: `${emp.name} เข้าสู่ระบบ (SSO)`,
  });
  res.redirect('/');
});

// POST /auth/logout — §5.5
ssoAuthRouter.post('/logout', async (req, res) => {
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
  const url = new URL('/system81/logout', env.sellcenterUrl);
  url.searchParams.set('redirect_uri', env.appUrl);
  res.redirect(url.toString());
});
