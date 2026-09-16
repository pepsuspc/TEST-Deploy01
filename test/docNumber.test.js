// Integration test: needs a real MongoDB reachable (e.g. `docker compose up`
// on the dev stack, which exposes it at localhost:27017 — see README).
// This one is deliberately NOT a pure unit test: the whole point of §7.7's
// atomic $inc counter is that it behaves correctly under real concurrent
// writes, which an in-memory fake can't prove.

import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';
import { nextDocNumber } from '../src/domain/docNumber.js';
import { buddhistYear } from '../src/domain/thaiDate.js';

const uri = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/its_forms_test';

test('nextDocNumber: 20 concurrent calls yield 0001..0020 with no duplicates or gaps', async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  await db.collection('counters').deleteMany({});

  try {
    const now = new Date();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => nextDocNumber(db, 'TEST', { now })),
    );

    const year = buddhistYear(now);
    const expected = Array.from({ length: 20 }, (_, i) => `TEST-${year}-${String(i + 1).padStart(4, '0')}`);

    assert.deepEqual([...results].sort(), expected);
    assert.equal(new Set(results).size, 20, 'no duplicate doc numbers');
  } finally {
    await db.collection('counters').deleteMany({});
    await client.close();
  }
});

test('nextDocNumber: separate prefixes get independent sequences', async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();
  await db.collection('counters').deleteMany({});

  try {
    const now = new Date();
    const a1 = await nextDocNumber(db, 'MEMO', { now });
    const b1 = await nextDocNumber(db, 'PR', { now });
    const a2 = await nextDocNumber(db, 'MEMO', { now });

    const year = buddhistYear(now);
    assert.equal(a1, `MEMO-${year}-0001`);
    assert.equal(b1, `PR-${year}-0001`);
    assert.equal(a2, `MEMO-${year}-0002`);
  } finally {
    await db.collection('counters').deleteMany({});
    await client.close();
  }
});
