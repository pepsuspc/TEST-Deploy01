// §9.1's last row: "คำร้องเกินกำหนดที่ขั้นของคุณ" -> the step's approvers,
// cc'd to the submitter, batched into one email per person per day instead
// of one email per overdue submission (§9.2: "รวมวันละครั้ง 08:00"). Run
// once a day by src/mail/worker.js's runOverdueDigestIfDue.

import { listOverduePending, subjectText } from '../models/submissions.js';
import { findUserByEmpId } from '../models/users.js';
import { enqueueEmail } from '../models/emailQueue.js';
import { notify } from '../models/notifications.js';
import { humanizeWaited } from '../domain/humanizeDuration.js';
import { env } from '../config/env.js';

export async function runOverdueDigest(now = new Date()) {
  const overdue = await listOverduePending(now);
  if (overdue.length === 0) return { peopleNotified: 0, submissionCount: 0 };

  // empId -> { waitingOnYou: [line...], yourSubmissions: [line...] }
  const perPerson = new Map();
  function bucket(empId) {
    if (!perPerson.has(empId)) perPerson.set(empId, { waitingOnYou: [], yourSubmissions: [] });
    return perPerson.get(empId);
  }

  for (const submission of overdue) {
    const subj = await subjectText(submission);
    const waited = humanizeWaited(submission.current.enteredAt, now);
    const line = `- ${submission.docNumber} "${subj}" (${submission.current.stepName}, ${waited}) — ${env.appUrl}/submissions/${submission._id}`;
    for (const empId of submission.current.approverEmpIds) {
      bucket(empId).waitingOnYou.push(line);
    }
    bucket(submission.submitter.emp_id).yourSubmissions.push(line);
  }

  for (const [empId, { waitingOnYou, yourSubmissions }] of perPerson) {
    const sections = [];
    if (waitingOnYou.length > 0) sections.push(`รอคุณอนุมัติและเกินกำหนดแล้ว (${waitingOnYou.length} ใบ):\n${waitingOnYou.join('\n')}`);
    if (yourSubmissions.length > 0) sections.push(`คำร้องของคุณที่เกินกำหนด (${yourSubmissions.length} ใบ):\n${yourSubmissions.join('\n')}`);
    const total = waitingOnYou.length + yourSubmissions.length;

    await notify(empId, {
      type: 'overdue_digest',
      subject: `มีคำร้องเกินกำหนด ${total} ใบ`,
      body: sections.join('\n\n'),
      link: '/inbox',
    });

    const user = await findUserByEmpId(empId);
    if (user?.email) {
      await enqueueEmail({
        to: user.email,
        subject: `[its-forms] สรุปคำร้องเกินกำหนด ${total} ใบ`,
        body: sections.join('\n\n'),
      });
    }
  }

  return { peopleNotified: perPerson.size, submissionCount: overdue.length };
}
