// Per-field-type validation (§7.3). Deliberately framework-free and pure —
// no db/network access — so it can run identically on the client (fast
// feedback) and the server (the one that's actually trusted, §7.3: "ตรวจ
// ทั้งสองฝั่ง ... ห้ามเชื่อ client อย่างเดียว").
//
// Only the types chunk 1's MEMO form uses are implemented here
// (short_text, long_text, select_many); auto/static never hold user input
// so they have nothing to validate.

export function validateValues(elements, values) {
  const errors = {};
  for (const el of elements) {
    const message = validateOne(el, values ? values[el.id] : undefined);
    if (message) errors[el.id] = message;
  }
  return errors;
}

function validateOne(el, value) {
  const { type, props } = el;
  const label = props.label || '';

  switch (type) {
    case 'short_text':
    case 'long_text': {
      const str = typeof value === 'string' ? value.trim() : '';
      const defaultMax = type === 'short_text' ? 200 : 5000;
      const maxLength = props.maxLength ?? defaultMax;
      if (props.required && str.length === 0) return `กรุณากรอก ${label}`;
      if (str.length > maxLength) return `${label} ต้องไม่เกิน ${maxLength} ตัวอักษร`;
      return null;
    }
    case 'select_many': {
      const selected = Array.isArray(value) ? value : [];
      const invalid = selected.filter((v) => !props.options.includes(v));
      if (invalid.length > 0) return `${label || 'ตัวเลือก'} ไม่ถูกต้อง`;
      if (props.minSelected && selected.length < props.minSelected) {
        return `กรุณาเลือก ${label || ''} อย่างน้อย ${props.minSelected} ข้อ`;
      }
      if (props.maxSelected && selected.length > props.maxSelected) {
        return `เลือก ${label || ''} ได้ไม่เกิน ${props.maxSelected} ข้อ`;
      }
      return null;
    }
    case 'auto':
    case 'static':
      return null;
    default:
      return null;
  }
}
