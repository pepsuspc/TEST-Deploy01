// Daily (+ on-demand) sync of the org chart into our own `users` collection,
// so name/department lookups never have to hit the org API on every page
// view (§6), and so old submissions can still show the names of people who
// have since left (§D.8).

import { orgApi } from './client.js';
import { upsertUserFromOrg } from '../models/users.js';
import { recordOrgSync } from '../models/settings.js';
import { env } from '../config/env.js';

export async function syncUsers() {
  const employees = await orgApi.allEmployees({ active: 'all' });
  let count = 0;
  for (const emp of employees) {
    if (!emp.emp_id) continue; // §D.3: no emp_id = not counted as staff
    await upsertUserFromOrg(emp, { adminEmpIds: env.adminEmpIds });
    count++;
  }

  const now = new Date();
  await recordOrgSync(count, now);

  return { count, at: now };
}
