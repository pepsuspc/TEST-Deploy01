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
