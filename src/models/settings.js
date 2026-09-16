// §11.4: "settings — เอกสารเดียว {_id: 'global', orgSyncedAt, …}". A single
// document collection is simpler than a key/value table for the handful of
// system-wide knobs §10.8 needs (letterheads, last org sync, digest state)
// and needs no schema migration story since every field is optional.

import { getDb } from '../db/connection.js';

const GLOBAL_ID = 'global';

function collection() {
  return getDb().collection('settings');
}

export async function getGlobalSettings() {
  const doc = await collection().findOne({ _id: GLOBAL_ID });
  return doc ?? { _id: GLOBAL_ID, orgSyncedAt: null, orgSyncedCount: 0, lastOverdueDigestDate: null };
}

export async function recordOrgSync(count, at = new Date()) {
  await collection().updateOne(
    { _id: GLOBAL_ID },
    { $set: { orgSyncedAt: at, orgSyncedCount: count } },
    { upsert: true },
  );
}

export async function setLastDigestDate(dateKey) {
  await collection().updateOne({ _id: GLOBAL_ID }, { $set: { lastOverdueDigestDate: dateKey } }, { upsert: true });
}
