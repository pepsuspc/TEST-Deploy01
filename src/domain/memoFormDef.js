// Chunk 1's MEMO form is hardcoded here rather than stored in a `forms`
// collection — the drag-drop designer that would let a form owner define
// this themselves is Chunk 2 (§7.2). The shape of each element already
// matches §11.2's `forms.elements`, so moving this into the database later
// is a data migration, not a rewrite of the renderer.
//
// Table and file fields from appendix B are deliberately left out — the
// spec's own task list (§14.5, task 1.8) excludes them from chunk 1.

export const MEMO_FORM_ID = 'memo';
export const MEMO_FORM_VERSION = 1;
export const MEMO_FORM_NAME = 'MEMO ขออนุมัติ';
export const MEMO_DOC_PREFIX = 'MEMO';

export const MEMO_ELEMENTS = [
  {
    id: 'el_date',
    type: 'auto',
    col: 17,
    colSpan: 8,
    align: 'right',
    props: { label: 'วันที่', source: 'submitted_at' },
  },
  {
    id: 'el_subject',
    type: 'short_text',
    col: 1,
    colSpan: 24,
    align: 'left',
    props: { label: 'เรื่อง', required: true, maxLength: 200 },
  },
  {
    id: 'el_to',
    type: 'short_text',
    col: 1,
    colSpan: 16,
    align: 'left',
    props: { label: 'เรียน', required: true, maxLength: 200 },
  },
  {
    id: 'el_purpose',
    type: 'select_many',
    col: 1,
    colSpan: 24,
    align: 'left',
    props: {
      label: '',
      layout: 'inline',
      options: ['เพื่อทราบ', 'เพื่อดำเนินการ', 'เพื่อบันทึก', 'เพื่อการอนุมัติของท่าน', 'อื่น ๆ'],
    },
  },
  {
    id: 'el_details',
    type: 'long_text',
    col: 1,
    colSpan: 24,
    align: 'left',
    props: { label: 'รายละเอียด', required: true, rows: 8, maxLength: 5000 },
  },
];

// §7.5's workflow, simplified for chunk 1 (task 1.13: "1 ขั้น 1 คน ระบุตัว
// คนตายตัวในโค้ด" per step). Two steps, matching the spec's own §8.10
// walkthrough exactly:
//   step 1 "ผู้ตรวจสอบ" — the submitter's direct chief, resolved from real
//     org data (§D.7) — not literally a fixed person, but a fixed *rule*.
//   step 2 "ผู้อนุมัติ" — a genuinely hardcoded emp_id (ศรัญญา, E003, same
//     person the spec's own walkthrough uses). The real mechanism here
//     (`submitter_choice`, where the submitter picks who) is chunk 3 —
//     without it there's no one else to hardcode against.
// Two steps (not one) matter for chunk 1's own acceptance test (§14.5 task
// 1.14): recalling an *approval* only has a reachable window when there's
// a next step still waiting — with a single 1-of-1 step, deciding always
// immediately ends the whole submission, so recall-after-approving could
// never be exercised at all.
export const MEMO_STEPS = [
  { stepId: 's1', name: 'ผู้ตรวจสอบ', resolve: 'chief' },
  { stepId: 's2', name: 'ผู้อนุมัติ', resolve: 'fixed', fixedEmpId: 'E003' },
];
