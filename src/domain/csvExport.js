// §10.7's CSV export: "UTF-8 with BOM เพื่อให้ Excel เปิดไทยได้; 1 แถว = 1
// คำร้อง; คอลัมน์ = ข้อมูลหลัก + ทุกฟิลด์ตามลำดับบนกระดาษ; table เป็น
// JSON string; file เป็นชื่อไฟล์คั่น ;". A pure string-building function —
// easy to unit test without a real HTTP response/DB round trip; the route
// just adds the BOM + headers and writes the result.

import { STATUS_LABEL } from './statusLabels.js';

const CORE_COLUMNS = ['เลขที่เอกสาร', 'ผู้ยื่น', 'แผนก', 'สถานะ', 'ขั้นปัจจุบัน', 'ส่งเมื่อ', 'จบเมื่อ'];

function csvCell(value) {
  const s = value === undefined || value === null ? '' : String(value);
  if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function isoDate(date) {
  return date ? new Date(date).toISOString() : '';
}

// Elements a submission actually has a value for; `static` is layout-only.
function exportableElements(elements) {
  return elements.filter((el) => el.type !== 'static');
}

function fieldValueToCsv(el, submission) {
  const value = el.type === 'auto' ? submission.autoValues?.[el.id] : submission.values?.[el.id];
  if (value === undefined || value === null || value === '') return '';
  switch (el.type) {
    case 'select_many':
      return Array.isArray(value) ? value.join(', ') : '';
    case 'date': {
      const parts = [];
      if (value.from) parts.push(value.from);
      if (value.to) parts.push(value.to);
      return parts.join(' – ');
    }
    case 'file':
      return Array.isArray(value) ? value.map((f) => f.name).join(';') : '';
    case 'table':
      return JSON.stringify(value.rows ?? value);
    case 'auto':
      return el.props?.source === 'submitted_at' ? isoDate(value) : String(value);
    default:
      return String(value);
  }
}

// `elements` is the column layout (typically the form's CURRENT elements,
// so every row lines up under the same headers even though older
// submissions may carry a different snapshot) — a field an older
// submission's snapshot never had simply exports blank for that row.
export function buildSubmissionsCsv(elements, submissions) {
  const fields = exportableElements(elements);
  const header = [...CORE_COLUMNS, ...fields.map((el) => el.props?.label || el.id)];
  const rows = submissions.map((s) => [
    s.docNumber || '(ร่าง)',
    s.submitter.name,
    s.submitter.department ? s.submitter.department.name : '',
    STATUS_LABEL[s.status] || s.status,
    s.current ? s.current.stepName : '',
    isoDate(s.submittedAt),
    isoDate(s.finishedAt),
    ...fields.map((el) => fieldValueToCsv(el, s)),
  ]);
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(','));
  return lines.join('\r\n') + '\r\n';
}
