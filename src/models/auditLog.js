// §11.4: append-only audit trail. Chunk 1 only writes to it — the admin
// page to browse it is chunk 4 (§10.9). Written straight to the collection
// rather than exposed as a generic "log anything" helper, so every call
// site has to spell out what actually happened in Thai, in one place we
// can scan later.

import { getDb } from '../db/connection.js';

export async function writeAuditLog({ actorEmpId, actorName, action, entityType, entityId, summary, meta = {} }) {
  await getDb()
    .collection('audit_logs')
    .insertOne({
      at: new Date(),
      actorEmpId,
      actorName,
      action,
      entityType,
      entityId: String(entityId),
      summary,
      meta,
    });
}

// §10.9: "กรองผู้กระทำ/ชนิด/ช่วงเวลา · แบ่งหน้า 100 · ไม่มีปุ่มลบ"
export async function listAuditLogs({ actorEmpId, entityType, from, to, page } = {}) {
  const filter = {};
  if (actorEmpId) filter.actorEmpId = actorEmpId;
  if (entityType) filter.entityType = entityType;
  if (from || to) {
    filter.at = {};
    if (from) filter.at.$gte = new Date(from);
    if (to) filter.at.$lte = new Date(`${to}T23:59:59.999Z`);
  }
  const pageNum = Math.max(1, Number(page) || 1);
  const pageSize = 100;
  const collection = getDb().collection('audit_logs');
  const [items, total] = await Promise.all([
    collection.find(filter).sort({ at: -1 }).skip((pageNum - 1) * pageSize).limit(pageSize).toArray(),
    collection.countDocuments(filter),
  ]);
  return { items, total, page: pageNum, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) };
}
