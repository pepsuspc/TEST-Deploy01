// Atomic document-number issuance (§7.7). One counter document per
// prefix+year, bumped with $inc — never "read the count, add 1, write it
// back", which races under concurrent submits and hands out duplicates.
//
// NOTE on the MongoDB driver: docs/requirement.md's pseudocode (§7.7, §8.9)
// reads `result.value` after findOneAndUpdate. That was correct for the
// driver versions available when the spec was written, but the installed
// driver (mongodb@6) returns the matched/updated document directly instead
// of wrapping it in `{ value }` — confirmed by testing against the actual
// driver rather than trusting the spec's snippet. Every findOneAndUpdate
// call in this codebase uses the document directly for that reason.

import { buddhistYear } from './thaiDate.js';

export async function nextDocNumber(db, prefix, { now = new Date() } = {}) {
  const year = buddhistYear(now);
  const counterId = `${prefix}-${year}`;
  const counter = await db.collection('counters').findOneAndUpdate(
    { _id: counterId },
    { $inc: { seq: 1 } },
    { upsert: true, returnDocument: 'after' },
  );
  const seq = counter.seq;
  return `${prefix}-${year}-${String(seq).padStart(4, '0')}`;
}
