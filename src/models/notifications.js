// In-app notifications (§9) — the `inAppChannel` half of §9.2's single
// `notify(event)` layer; `notify`/`notifyMany` here ARE that layer, since
// every event in this app already funnels through one of them. The
// `emailChannel` half (src/models/emailQueue.js) fires from the same
// function when a call site passes `email` — see the four call sites in
// submissions.js that need it per §9.1's table (step_entered, returned,
// rejected, approved). This app's `notifications` collection deliberately
// keeps its own simpler `status: 'unread'/'read'` schema rather than
// reusing §11.4's `notifications` queue shape (status: 'queued'/'sent'),
// which describes the email queue, not the in-app bell — see
// emailQueue.js's header for why those two are kept as separate
// collections instead of one schema serving both.

import { getDb } from '../db/connection.js';
import { findUserByEmpId } from './users.js';
import { enqueueEmail } from './emailQueue.js';

function collection() {
  return getDb().collection('notifications');
}

export async function notify(toEmpId, { type, subject, body, link, email }) {
  await collection().insertOne({
    to: toEmpId,
    type,
    subject,
    body,
    link,
    status: 'unread',
    createdAt: new Date(),
    readAt: null,
  });
  if (email) {
    const user = await findUserByEmpId(toEmpId);
    if (user?.email) await enqueueEmail({ to: user.email, subject: email.subject, body: email.body });
  }
}

export async function notifyMany(toEmpIds, payload) {
  const unique = [...new Set(toEmpIds)];
  await Promise.all(unique.map((empId) => notify(empId, payload)));
}

export function listRecentForUser(empId, limit = 30) {
  return collection().find({ to: empId }).sort({ createdAt: -1 }).limit(limit).toArray();
}

export function countUnread(empId) {
  return collection().countDocuments({ to: empId, status: 'unread' });
}

export async function markAllRead(empId) {
  await collection().updateMany({ to: empId, status: 'unread' }, { $set: { status: 'read', readAt: new Date() } });
}
