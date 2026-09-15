// Org Directory API client — sellcenter's org chart, read-only.
// Appendix D of docs/requirement.md. Switches transparently between the
// real HTTP API and the mock/org/*.json files via ORG_API_MOCK, so the rest
// of the app never has to know which one it's talking to (appendix D.9).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOCK_DIR = path.join(__dirname, '..', '..', 'mock', 'org');

async function readMock(file) {
  const raw = await fs.readFile(path.join(MOCK_DIR, file), 'utf8');
  return JSON.parse(raw).data;
}

async function orgFetch(pathname, query = {}) {
  const url = new URL(pathname, env.sellcenterUrl);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) url.searchParams.set(key, value);
  }
  let res;
  try {
    res = await fetch(url, {
      headers: { 'x-service-token': env.orgApiToken },
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    throw new Error(`org api unreachable: ${err.message}`);
  }
  if (res.status === 404) return null;
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.success) {
    throw new Error(`org api ${res.status}: ${body.error || 'unknown error'}`);
  }
  return body.data;
}

// GET /api/org/employees?active=1|0|all
async function allEmployees({ active = '1' } = {}) {
  if (env.orgApiMock) {
    const all = await readMock('employees.json');
    if (active === '1') return all.filter((e) => e.is_active);
    return all;
  }
  return orgFetch('/api/org/employees', { active });
}

// GET /api/org/employees?department=<id>
async function employeesByDepartment(departmentId) {
  if (env.orgApiMock) {
    const all = await readMock('employees.json');
    return all.filter((e) => e.is_active && e.department?.id === departmentId);
  }
  return orgFetch('/api/org/employees', { department: departmentId });
}

// GET /api/org/employees/{emp_id} — not filtered by is_active (§D.4)
async function employee(empId) {
  if (env.orgApiMock) {
    const all = await readMock('employees.json');
    return all.find((e) => e.emp_id === empId) ?? null;
  }
  return orgFetch(`/api/org/employees/${encodeURIComponent(empId)}`);
}

// GET /api/org/departments
async function departments() {
  if (env.orgApiMock) return readMock('departments.json');
  return orgFetch('/api/org/departments');
}

export const orgApi = { allEmployees, employeesByDepartment, employee, departments };
