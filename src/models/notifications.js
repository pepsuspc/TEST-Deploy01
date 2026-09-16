// In-app notifications (§9). Chunk 1 is in-app only — email is chunk 4
// (§9.2 explicitly: "ยังไม่ต้องอีเมล", MAIL_MODE stays unused here). The
// spec's §11.4 `notifications` schema (status: 'queued', attempts,
// sentAt) is really the EMAIL queue's shape; this collection instead
// tracks the simpler thing an in-app bell actually needs — chunk 4 will
// likely split these into two collections/channels rather than force one
// schema to serve both.

import { getDb } from '../db/connection.js';

function collection() {
  return getDb().collection('notifications');
}

export async function notify(toEmpId, { type, subject, body, link }) {
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
