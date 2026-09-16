// Idempotent index creation — safe to call on every boot (E.3 of docs/requirement.md).
// If this throws (e.g. conflicting duplicate data), we want the app to refuse to
// start rather than run slow without an index nobody noticed was missing.

export async function ensureIndexes(db) {
  await db.collection('submissions').createIndex({ docNumber: 1 }, { unique: true, sparse: true });
  await db.collection('submissions').createIndex({ status: 1, 'current.approverEmpIds': 1 });
  await db.collection('submissions').createIndex({ 'submitter.emp_id': 1, createdAt: -1 });
  await db.collection('submissions').createIndex({ formId: 1, submittedAt: -1 });
  await db.collection('users').createIndex({ emp_id: 1 }, { unique: true });
  await db.collection('files').createIndex({ submissionId: 1 });
  await db.collection('files').createIndex({ uploadedAt: 1 });
  await db.collection('notifications').createIndex({ to: 1, createdAt: -1 }); // this app's own "my notifications" query
  await db.collection('email_queue').createIndex({ status: 1, nextAttemptAt: 1 }); // worker's due-emails scan
  await db.collection('audit_logs').createIndex({ at: -1 });
  await db.collection('audit_logs').createIndex({ actorEmpId: 1, at: -1 });
  await db.collection('audit_logs').createIndex({ entityType: 1, at: -1 });
  await db.collection('counters').createIndex({ _id: 1 });
  await db.collection('submissions').createIndex({ status: 1, 'current.deadlineAt': 1 }); // overdue digest scan
}
