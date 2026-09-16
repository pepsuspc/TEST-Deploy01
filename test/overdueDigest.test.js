// Integration test against real Mongo (see docNumber.test.js for why):
// runOverdueDigest reads across submissions/users/notifications/email_queue,
// so a fake in-memory db would just be re-testing the mock instead of the
// query logic. Checks §9.1's last row: one BATCHED email per person per
// day (not one per overdue submission), covering both roles a person can
// be in — an approver waiting on someone else's overdue request, and a
// submitter whose own request is overdue.
//
// Deliberately never does a blanket `deleteMany({})` on `submissions` —
// unlike docNumber.test.js's `counters`, this collection is also used by
// decideStepConcurrency.test.js against the same shared test database, and
// `node --test` runs files concurrently by default. A wipe here raced with
// that test's insert-then-race-two-decides sequence once already and made
// both of its racing calls 404 instead of one succeeding/one 409ing. Every
// fixture below carries a random per-run suffix and cleanup removes only
// the exact `_id`s this test itself inserted.

import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoClient, ObjectId } from 'mongodb';

const uri = process.env.TEST_MONGODB_URI || 'mongodb://localhost:27017/its_forms_test';

test('runOverdueDigest: batches multiple overdue items into one email per person, both as approver and as submitter', async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  const { setDbForTest } = await import('../src/db/connection.js');
  setDbForTest(db);
  const { runOverdueDigest } = await import('../src/mail/digest.js');

  const tag = Math.random().toString(36).slice(2, 8);
  const approverEmpId = `DGA-${tag}`;
  const submitterEmpId = `DGS-${tag}`;
  const approverEmail = `${approverEmpId}@company.com`;
  const submitterEmail = `${submitterEmpId}@company.com`;

  await db.collection('users').insertMany([
    { emp_id: approverEmpId, name: 'ผู้อนุมัติ ทดสอบ', email: approverEmail },
    { emp_id: submitterEmpId, name: 'ผู้ยื่น ทดสอบ', email: submitterEmail },
  ]);

  const now = new Date();
  const past = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
  const elements = [{ id: 'el_subject', type: 'short_text', props: { label: 'เรื่อง' } }];

  function overdueSubmission(subject) {
    return {
      status: 'pending',
      formId: new ObjectId(),
      submitter: { emp_id: submitterEmpId, name: 'ผู้ยื่น ทดสอบ' },
      docNumber: `TEST-${tag}-${subject}`,
      snapshot: { formName: 'ทดสอบ', elements, workflow: { steps: [] } },
      values: { el_subject: subject },
      current: {
        round: 1,
        stepIndex: 0,
        stepId: 's1',
        stepName: 'ผู้ตรวจสอบ',
        approverEmpIds: [approverEmpId],
        enteredAt: past,
        deadlineAt: past,
      },
      rounds: [],
      version: 1,
    };
  }

  // Two separate overdue submissions from the same submitter, waiting on
  // the same approver — should collapse into ONE email each, not two.
  const insertResult = await db.collection('submissions').insertMany([
    overdueSubmission('เรื่องที่หนึ่ง'),
    overdueSubmission('เรื่องที่สอง'),
  ]);
  const insertedIds = Object.values(insertResult.insertedIds);

  try {
    await runOverdueDigest(now);

    const approverEmails = await db.collection('email_queue').find({ to: approverEmail }).toArray();
    assert.equal(approverEmails.length, 1, 'approver gets one combined email, not one per overdue submission');
    assert.match(approverEmails[0].body, /เรื่องที่หนึ่ง/);
    assert.match(approverEmails[0].body, /เรื่องที่สอง/);
    assert.match(approverEmails[0].body, /รอคุณอนุมัติและเกินกำหนดแล้ว \(2 ใบ\)/);

    const submitterEmails = await db.collection('email_queue').find({ to: submitterEmail }).toArray();
    assert.equal(submitterEmails.length, 1, 'submitter gets one combined email too');
    assert.match(submitterEmails[0].body, /คำร้องของคุณที่เกินกำหนด \(2 ใบ\)/);

    const approverNotifs = await db.collection('notifications').find({ to: approverEmpId }).toArray();
    assert.equal(approverNotifs.length, 1, 'in-app bell also gets exactly one summary entry, not one per submission');
  } finally {
    await db.collection('submissions').deleteMany({ _id: { $in: insertedIds } });
    await db.collection('users').deleteMany({ emp_id: { $in: [approverEmpId, submitterEmpId] } });
    await db.collection('email_queue').deleteMany({ to: { $in: [approverEmail, submitterEmail] } });
    await db.collection('notifications').deleteMany({ to: { $in: [approverEmpId, submitterEmpId] } });
    await client.close();
  }
});

test('runOverdueDigest: nothing overdue as of the given time -> no work done', async () => {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  const { setDbForTest } = await import('../src/db/connection.js');
  setDbForTest(db);
  const { runOverdueDigest } = await import('../src/mail/digest.js');

  // A `now` far enough in the past that nothing any concurrently-running
  // test could have inserted is "overdue" relative to it — avoids needing
  // to touch (let alone wipe) the shared collection to prove this path.
  const result = await runOverdueDigest(new Date('2000-01-01T00:00:00Z'));
  assert.equal(result.peopleNotified, 0);
  assert.equal(result.submissionCount, 0);

  await client.close();
});
