// Integration test against real Mongo (see docNumber.test.js for why):
// §8.9/§15 test 13 wants two people hitting "approve" on the same step at
// the same instant to result in exactly one recorded approval and a 409
// for the other. Chunk 1's own MEMO_STEPS never has 2 approvers on one
// step (each step is 1-of-1), so this can't be reproduced by hitting the
// real HTTP routes yet — but decideStep()'s version-guarded update is
// written generically (for chunk 3's N-of-M), so we can still exercise the
// exact guard by inserting a submission with a 2-approver, quorum-2 step
// directly and racing two DIFFERENT approvers against it.
//
// Both calls pass the SAME `expectedVersion` (1) explicitly — this is what
// actually models "two browser tabs that both rendered this page at
// version 1" (§8.9's real scenario). Letting each call re-read its own
// fresh version instead only proved a much weaker, uninteresting property:
// that this one function's own internal read-then-write doesn't race with
// itself a few microseconds later — a first attempt at this test did
// exactly that and passed for the wrong reason, which is what caught the
// bug (decideStep was using its own fresh re-read as the guard instead of
// a client-supplied version) in the first place.

import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient } from 'mongodb';

const uri = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/its_forms_test';

test('decideStep: two different approvers deciding simultaneously -> one succeeds, one gets 409', async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  // Point the app's db connection at this same test database.
  const { setDbForTest } = await import('../src/db/connection.js');
  setDbForTest(db);
  const { decideStep } = await import('../src/models/submissions.js');

  const now = new Date();
  const step = {
    stepId: 's1',
    name: 'ผู้อนุมัติ',
    quorum: 2,
    approvers: [
      { emp_id: 'A1', name: 'Approver One' },
      { emp_id: 'A2', name: 'Approver Two' },
    ],
    enteredAt: now,
    deadlineAt: null,
    decisions: [],
  };

  const { insertedId } = await db.collection('submissions').insertOne({
    docNumber: 'TEST-2569-0001',
    formId: 'memo',
    formVersion: 1,
    status: 'pending',
    version: 1,
    submitter: { emp_id: 'SUB1', name: 'Submitter', department: null, position: null, email: 's@x.com' },
    snapshot: { formName: 'test', elements: [] },
    values: {},
    autoValues: {},
    current: {
      round: 1,
      stepIndex: 0,
      stepId: 's1',
      stepName: step.name,
      approverEmpIds: ['A1', 'A2'],
      enteredAt: now,
      deadlineAt: null,
    },
    rounds: [{ round: 1, submittedAt: now, endedAt: null, endedBy: null, steps: [step] }],
    comments: [],
    createdAt: now,
    updatedAt: now,
    submittedAt: now,
    finishedAt: null,
  });

  try {
    const results = await Promise.allSettled([
      decideStep(String(insertedId), 'A1', 'approve', { comment: 'from A1', now, expectedVersion: 1 }),
      decideStep(String(insertedId), 'A2', 'approve', { comment: 'from A2', now, expectedVersion: 1 }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');

    assert.equal(fulfilled.length, 1, 'exactly one of the two racing decisions should succeed');
    assert.equal(rejected.length, 1, 'the other should be rejected');
    assert.equal(rejected[0].reason.status, 409, 'the rejection should be an HTTP 409 (version conflict)');

    const final = await db.collection('submissions').findOne({ _id: insertedId });
    assert.equal(final.rounds[0].steps[0].decisions.length, 1, 'only one decision was actually recorded');
    assert.equal(final.version, 2, 'version advanced exactly once');
  } finally {
    await db.collection('submissions').deleteOne({ _id: insertedId });
    await client.close();
  }
});
