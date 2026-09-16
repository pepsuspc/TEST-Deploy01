// Fabricated data for the designer's "ดูตัวอย่าง" (preview) — lets a form
// owner see roughly how their in-progress layout will look filled in,
// without needing a real submission. Reuses the exact same memo-a4.ejs
// view-mode rendering a real submission gets, just fed fake values.

export function sampleValueFor(el) {
  switch (el.type) {
    case 'short_text':
      return 'ตัวอย่างข้อความ';
    case 'long_text':
      return 'ตัวอย่างข้อความยาว\nบรรทัดที่สอง';
    case 'number':
      return 1234.5;
    case 'date':
      return el.props.mode === 'range'
        ? { from: '2026-09-01', to: '2026-09-10' }
        : { from: '2026-09-16' };
    case 'select_one':
      return el.props.options?.[0] ?? '';
    case 'select_many':
      return el.props.options?.slice(0, 1) ?? [];
    case 'file':
      return [{ fileId: 'sample', name: 'ตัวอย่าง.pdf', size: 102400, mime: 'application/pdf' }];
    case 'table':
      return {
        rows: [Object.fromEntries((el.props.columns || []).map((c) => [c.key, c.type === 'number' ? 100 : 'ตัวอย่าง']))],
      };
    default:
      return undefined;
  }
}

export function buildSampleSubmission({ formName, elements }) {
  const values = {};
  const autoValues = {};
  for (const el of elements) {
    if (el.type === 'auto') {
      autoValues[el.id] = el.props.source === 'submitted_at' ? new Date() : `ตัวอย่าง (${el.props.source})`;
    } else if (el.type !== 'static') {
      values[el.id] = sampleValueFor(el);
    }
  }
  return {
    _id: 'preview',
    docNumber: 'PREVIEW-2569-0000',
    status: 'draft',
    version: 1,
    submitter: { name: 'ตัวอย่าง ผู้ยื่น', department: { name: 'ฝ่ายตัวอย่าง' }, position: null, email: '' },
    snapshot: { formName, elements },
    values,
    autoValues,
    submittedAt: new Date(),
    rounds: [],
    comments: [],
  };
}
