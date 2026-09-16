// Plain-text email bodies for the events §9.1 marks "ส่งอีเมลทันที" —
// §9.2: "ข้อความล้วน พอ ไม่ต้อง HTML สวย", content = form name, subject,
// submitter, step, link.

import { env } from '../config/env.js';

function lines(rows) {
  return rows.filter(Boolean).join('\n');
}

export function stepEnteredEmail({ formName, subjText, submitterName, stepName, submissionId }) {
  return {
    subject: `[its-forms] รอคุณอนุมัติ — ${subjText || formName}`,
    body: lines([
      `ฟอร์ม: ${formName}`,
      `เรื่อง: ${subjText || '(ไม่มี)'}`,
      `ผู้ยื่น: ${submitterName}`,
      `ขั้น: ${stepName}`,
      '',
      `เปิดดูคำร้อง: ${env.appUrl}/submissions/${submissionId}`,
    ]),
  };
}

const OUTCOME_LABEL = {
  approved: 'อนุมัติครบแล้ว',
  rejected: 'ไม่อนุมัติ',
  returned: 'ถูกส่งกลับแก้ไข',
};

export function outcomeEmail(outcome, { formName, subjText, submissionId, docNumber }) {
  return {
    subject: `[its-forms] ${docNumber || ''} ${OUTCOME_LABEL[outcome]} — ${subjText || formName}`,
    body: lines([
      `ฟอร์ม: ${formName}`,
      `เรื่อง: ${subjText || '(ไม่มี)'}`,
      `สถานะ: ${OUTCOME_LABEL[outcome]}`,
      '',
      `เปิดดูคำร้อง: ${env.appUrl}/submissions/${submissionId}`,
    ]),
  };
}
