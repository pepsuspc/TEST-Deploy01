// Central registry of the 10 field types (§7.3) — what the designer's
// palette offers, and each type's default props when first placed. Kept
// separate from validateField.js (behavior) and the view templates
// (rendering) so "what types exist and what do they default to" has one
// home.

export const FIELD_TYPES = [
  { type: 'short_text', label: 'ข้อความสั้น' },
  { type: 'long_text', label: 'ข้อความยาว' },
  { type: 'number', label: 'ตัวเลข' },
  { type: 'date', label: 'วันที่' },
  { type: 'select_one', label: 'เลือกหนึ่งตัวเลือก' },
  { type: 'select_many', label: 'เลือกได้หลายตัวเลือก' },
  { type: 'file', label: 'ไฟล์แนบ' },
  { type: 'table', label: 'ตารางรายการ' },
  { type: 'static', label: 'ข้อความ/เส้นคั่น' },
  { type: 'auto', label: 'ค่าอัตโนมัติ' },
];

export const AUTO_SOURCES = [
  { value: 'submitter_name', label: 'ชื่อผู้ยื่น' },
  { value: 'submitter_department', label: 'แผนกผู้ยื่น' },
  { value: 'submitter_position', label: 'ตำแหน่งผู้ยื่น' },
  { value: 'submitter_email', label: 'อีเมลผู้ยื่น' },
  { value: 'submitted_at', label: 'วันที่ยื่น' },
  { value: 'doc_number', label: 'เลขที่เอกสาร' },
  { value: 'form_name', label: 'ชื่อฟอร์ม' },
];

export const FILE_ACCEPT_DEFAULT = ['pdf', 'jpg', 'jpeg', 'png', 'gif', 'webp', 'xlsx', 'xls', 'docx', 'doc', 'csv', 'txt'];

export function defaultPropsFor(type) {
  switch (type) {
    case 'short_text':
      return { label: 'ข้อความ', required: false, maxLength: 200, placeholder: '' };
    case 'long_text':
      return { label: 'ข้อความ', required: false, maxLength: 5000, rows: 4 };
    case 'number':
      return { label: 'ตัวเลข', required: false, decimals: 0, prefix: '', suffix: '' };
    case 'date':
      return { label: 'วันที่', required: false, mode: 'single' };
    case 'select_one':
      return { label: 'ตัวเลือก', required: false, options: ['ตัวเลือก 1', 'ตัวเลือก 2'], display: 'dropdown', allowOther: false };
    case 'select_many':
      return { label: 'ตัวเลือก', required: false, options: ['ตัวเลือก 1', 'ตัวเลือก 2'], layout: 'list' };
    case 'file':
      return { label: 'ไฟล์แนบ', required: false, maxFiles: 5, accept: FILE_ACCEPT_DEFAULT };
    case 'table':
      return {
        label: 'รายการ',
        columns: [{ key: 'col1', label: 'คอลัมน์ 1', type: 'short_text', width: 1, required: false }],
        minRows: 1,
        maxRows: 50,
        sumColumns: [],
      };
    case 'static':
      return { variant: 'paragraph', text: 'ข้อความ', size: 'normal' };
    case 'auto':
      return { label: 'อัตโนมัติ', source: 'submitted_at' };
    default:
      throw new Error(`unknown field type: ${type}`);
  }
}

export function newElement(type, id, row) {
  return { id, type, row, col: 1, colSpan: 24, align: 'left', props: defaultPropsFor(type) };
}
