// The email half of §9.2's notify(event): a durable queue so "sending is
// slow/down" never blocks a button press. `notifications.js` (the in-app
// bell) stays a separate collection/schema — it already shipped in Chunk 1
// with `status: 'unread'/'read'` semantics that don't fit an email's
// `queued -> sent/failed` lifecycle, and unifying them would mean forcing
// one `status` field to mean two different things. Keeping them apart is a
// deliberate deviation from §11.4's suggested single `notifications` queue
// schema — §11.1 allows that ("แนะนำ — ปรับได้").

import { getDb } from '../db/connection.js';

function collection() {
  return getDb().collection('email_queue');
}

export async function enqueueEmail({ to, subject, body, link }) {
  if (!to) return; // no email on file for this user — in-app notification still fired
  const now = new Date();
  await collection().insertOne({
    to,
    subject,
    body,
    link,
    status: 'queued',
    attempts: 0,
    lastError: null,
    createdAt: now,
    nextAttemptAt: now,
    sentAt: null,
  });
}

export function dueEmails(now = new Date(), limit = 50) {
  return collection().find({ status: 'queued', nextAttemptAt: { $lte: now } }).limit(limit).toArray();
}

export async function markSent(id, now = new Date()) {
  await collection().updateOne({ _id: id }, { $set: { status: 'sent', sentAt: now } });
}

export async function markRetry(id, attempts, nextAttemptAt, error) {
  await collection().updateOne({ _id: id }, { $set: { attempts, nextAttemptAt, lastError: String(error) } });
}

export async function markFailed(id, attempts, error) {
  await collection().updateOne({ _id: id }, { $set: { status: 'failed', attempts, lastError: String(error) } });
}

export function countQueued() {
  return collection().countDocuments({ status: 'queued' });
}

export function countFailed() {
  return collection().countDocuments({ status: 'failed' });
}
