// Thin data-access helpers for the `users` collection — a cache of org-chart
// data (§6) plus roles that we own and the org API knows nothing about.

import { getDb } from '../db/connection.js';

function collection() {
  return getDb().collection('users');
}

export function findUserByEmpId(empId) {
  return collection().findOne({ emp_id: empId });
}

// §10.8 "ผู้ดูแลฟอร์ม / admin: ค้นพนักงาน (จาก users) ติ๊กบทบาท" — only ever
// searches the local cache, never the org API directly, same as every
// other name lookup in this app (§6).
export function searchUsers(q, limit = 20) {
  const filter = q
    ? { $or: [{ name: { $regex: escapeRegex(q), $options: 'i' } }, { emp_id: { $regex: escapeRegex(q), $options: 'i' } }] }
    : {};
  return collection().find(filter).sort({ name: 1 }).limit(limit).toArray();
}

export function listUsersWithRoles() {
  return collection().find({ roles: { $exists: true, $ne: [] } }).sort({ name: 1 }).toArray();
}

const VALID_ROLES = ['form_owner', 'admin'];

export async function setUserRoles(empId, roles) {
  const filtered = [...new Set(roles.filter((r) => VALID_ROLES.includes(r)))];
  await collection().updateOne({ emp_id: empId }, { $set: { roles: filtered } });
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Upsert org-chart fields for one employee without ever touching `roles`,
// `lastLoginAt`, or other fields this app owns (§5.5 step 3, §D.8 step 3).
export async function upsertUserFromOrg(emp, { adminEmpIds = [], touchLastLogin = false } = {}) {
  const now = new Date();
  const set = {
    emp_id: emp.emp_id,
    sub: emp.id,
    email: (emp.email || '').toLowerCase(),
    name: emp.name,
    nickname: emp.nickname || '',
    department: emp.department ?? null,
    position: emp.position ?? null,
    chief: emp.chief ?? null,
    is_active: emp.is_active,
    syncedAt: now,
  };
  if (touchLastLogin) set.lastLoginAt = now;

  await collection().updateOne(
    { emp_id: emp.emp_id },
    {
      $set: set,
      $setOnInsert: {
        roles: adminEmpIds.includes(emp.emp_id) ? ['admin'] : [],
        createdAt: now,
      },
    },
    { upsert: true }
  );
}
