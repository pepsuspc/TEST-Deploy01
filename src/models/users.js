// Thin data-access helpers for the `users` collection — a cache of org-chart
// data (§6) plus roles that we own and the org API knows nothing about.

import { getDb } from '../db/connection.js';

function collection() {
  return getDb().collection('users');
}

export function findUserByEmpId(empId) {
  return collection().findOne({ emp_id: empId });
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
