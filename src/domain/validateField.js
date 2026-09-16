// Per-field-type validation (§7.3). Pure and framework-free on purpose —
// no db/network access — so it runs identically on the client (fast
// feedback) and the server (the one that's actually trusted, §7.3: "ตรวจ
// ทั้งสองฝั่ง ... ห้ามเชื่อ client อย่างเดียว").
//
// Chunk 1 only implemented short_text/long_text/select_many/auto/static.
// Chunk 2 fills in the remaining number/date/select_one/file/table so the
// designer's full 10-type palette is actually usable, not just placeable.

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

    case 'number': {
      const isEmpty = value === undefined || value === null || value === '';
      if (props.required && isEmpty) return `กรุณากรอก ${label}`;
      if (isEmpty) return null;
      const num = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
      if (Number.isNaN(num)) return `${label} ต้องเป็นตัวเลข`;
      if (props.min !== undefined && num < props.min) return `${label} ต้องไม่น้อยกว่า ${props.min}`;
      if (props.max !== undefined && num > props.max) return `${label} ต้องไม่เกิน ${props.max}`;
      const decimals = props.decimals ?? 0;
      const decimalPart = String(num).split('.')[1];
      if (decimalPart && decimalPart.length > decimals) {
        return `${label} มีทศนิยมได้ไม่เกิน ${decimals} ตำแหน่ง`;
      }
      return null;
    }

    case 'date': {
      const v = value && typeof value === 'object' ? value : {};
      const isEmpty = !v.from;
      if (props.required && isEmpty) return `กรุณาเลือก ${label}`;
      if (isEmpty) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v.from)) return `${label} ไม่ถูกต้อง`;
      if (props.mode === 'range') {
        if (!v.to) return `กรุณาเลือกวันสิ้นสุดของ ${label}`;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v.to)) return `${label} ไม่ถูกต้อง`;
        if (v.to < v.from) return `${label}: วันสิ้นสุดต้องไม่ก่อนวันเริ่ม`;
      }
      if (props.minDate && props.minDate !== 'today' && v.from < props.minDate) {
        return `${label} ต้องไม่ก่อน ${props.minDate}`;
      }
      if (props.maxDate && props.maxDate !== 'today' && v.from > props.maxDate) {
        return `${label} ต้องไม่หลัง ${props.maxDate}`;
      }
      return null;
    }

    case 'select_one': {
      const str = typeof value === 'string' ? value : '';
      if (props.required && str.length === 0) return `กรุณาเลือก ${label}`;
      if (str.length > 0 && !props.options.includes(str) && !(props.allowOther && str.startsWith('อื่น ๆ:'))) {
        return `${label} ไม่ถูกต้อง`;
      }
      return null;
    }

    case 'select_many': {
      const selected = Array.isArray(value) ? value : [];
      const invalid = selected.filter((v) => !props.options.includes(v));
      if (invalid.length > 0) return `${label || 'ตัวเลือก'} ไม่ถูกต้อง`;
      if (props.required && selected.length === 0) return `กรุณาเลือก ${label}`;
      if (props.minSelected && selected.length < props.minSelected) {
        return `กรุณาเลือก ${label || ''} อย่างน้อย ${props.minSelected} ข้อ`;
      }
      if (props.maxSelected && selected.length > props.maxSelected) {
        return `เลือก ${label || ''} ได้ไม่เกิน ${props.maxSelected} ข้อ`;
      }
      return null;
    }

    case 'file': {
      const files = Array.isArray(value) ? value : [];
      if (props.required && files.length === 0) return `กรุณาแนบไฟล์ ${label}`;
      const maxFiles = props.maxFiles ?? 5;
      if (files.length > maxFiles) return `${label} แนบได้ไม่เกิน ${maxFiles} ไฟล์`;
      return null;
    }

    case 'table': {
      const rows = value && Array.isArray(value.rows) ? value.rows : [];
      const minRows = props.minRows ?? 1;
      const maxRows = props.maxRows ?? 50;
      if (rows.length < minRows) return `${label} ต้องมีอย่างน้อย ${minRows} แถว`;
      if (rows.length > maxRows) return `${label} มีได้ไม่เกิน ${maxRows} แถว`;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i] ?? {};
        for (const col of props.columns) {
          const cellError = validateTableCell(col, row[col.key]);
          if (cellError) return `${label} แถวที่ ${i + 1}: ${cellError}`;
        }
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

function validateTableCell(col, value) {
  const isEmpty = value === undefined || value === null || value === '';
  if (col.required && isEmpty) return `กรุณากรอก ${col.label}`;
  if (isEmpty) return null;
  if (col.type === 'number') {
    const num = typeof value === 'number' ? value : Number(String(value).replace(/,/g, ''));
    if (Number.isNaN(num)) return `${col.label} ต้องเป็นตัวเลข`;
  }
  if (col.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${col.label} ไม่ถูกต้อง`;
  }
  if (col.type === 'select_one' && col.options && !col.options.includes(value)) {
    return `${col.label} ไม่ถูกต้อง`;
  }
  return null;
}
