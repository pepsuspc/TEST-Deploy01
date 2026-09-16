// §7.2/§10.6: the drag-drop form designer. Vanilla JS, native HTML5 drag
// events — no framework, matching the rest of this app.
//
// Key simplification that makes the whole thing tractable: row numbers are
// never manually shifted. Inserting a row "between row 2 and row 3" just
// assigns the dropped element row 2.5, then normalizeRows() immediately
// collapses every row number back to a clean 1..N sequence by sorted
// order. Deleting the last element in a row is the same operation in
// reverse — the empty row number just disappears on the next normalize.
(function () {
  const INIT = window.__DESIGNER_INIT__;
  if (!INIT) return;

  const DEFAULT_COL_SPAN = {
    short_text: 24, long_text: 24, number: 8, date: 8,
    select_one: 12, select_many: 24, file: 24, table: 24, static: 24, auto: 8,
  };

  const canvas = document.getElementById('designer-canvas');
  const rowsContainer = document.getElementById('canvas-rows');
  const propsPanel = document.getElementById('designer-props');
  const saveStatus = document.getElementById('designer-save-status');
  const btnUndo = document.getElementById('btn-undo');
  const btnRedo = document.getElementById('btn-redo');
  const btnToggleGrid = document.getElementById('btn-toggle-grid');
  const btnPreview = document.getElementById('btn-preview');

  let elements = clone(INIT.elements);
  let selectedId = elements[0]?.id ?? null;
  let showGrid = false;
  let history = [clone(elements)];
  let historyIndex = 0;
  let dirty = false;
  let saveTimer = null;

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function uid() { return 'el_' + Math.random().toString(36).slice(2, 9); }

  function groupRowNumbers(els) {
    return [...new Set(els.map((e) => e.row))].sort((a, b) => a - b);
  }

  function normalizeRows(els) {
    const rowNums = groupRowNumbers(els);
    const remap = new Map(rowNums.map((r, i) => [r, i + 1]));
    return els.map((e) => ({ ...e, row: remap.get(e.row) }));
  }

  function overlaps(a, b) {
    return a.col < b.col + b.colSpan && b.col < a.col + a.colSpan;
  }

  function hasOverlap(els, candidate, excludeId) {
    return els.some((e) => e.row === candidate.row && e.id !== excludeId && overlaps(e, candidate));
  }

  // ---- history / persistence ----

  function commit(newElements) {
    elements = normalizeRows(newElements);
    history = history.slice(0, historyIndex + 1);
    history.push(clone(elements));
    if (history.length > 50) history.shift();
    historyIndex = history.length - 1;
    dirty = true;
    render();
    scheduleSave();
  }

  function undo() {
    if (historyIndex === 0) return;
    historyIndex--;
    elements = clone(history[historyIndex]);
    dirty = true;
    render();
    scheduleSave();
  }

  function redo() {
    if (historyIndex >= history.length - 1) return;
    historyIndex++;
    elements = clone(history[historyIndex]);
    dirty = true;
    render();
    scheduleSave();
  }

  function scheduleSave() {
    if (saveStatus) saveStatus.textContent = 'มีการเปลี่ยนแปลงยังไม่บันทึก…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 10000); // §7.2: autosave every 10s
  }

  async function save() {
    if (!dirty) return;
    if (saveStatus) saveStatus.textContent = 'กำลังบันทึก…';
    try {
      const res = await fetch(`/manage/forms/${INIT.formId}/elements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: 'elements=' + encodeURIComponent(JSON.stringify(elements)),
      });
      const body = await res.json();
      if (!res.ok) {
        if (saveStatus) saveStatus.textContent = body.error || 'บันทึกไม่สำเร็จ';
        return;
      }
      dirty = false;
      const time = new Date(body.updatedAt).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (saveStatus) saveStatus.textContent = `บันทึกแล้ว ${time}`;
    } catch (err) {
      if (saveStatus) saveStatus.textContent = 'บันทึกไม่สำเร็จ ลองใหม่';
    }
  }

  // ---- rendering ----

  function render() {
    rowsContainer.innerHTML = '';
    const rowNums = groupRowNumbers(elements);

    appendGap(rowNums.length > 0 ? rowNums[0] - 0.5 : 0.5);
    rowNums.forEach((rowNum, idx) => {
      appendRow(rowNum);
      const nextBoundary = idx < rowNums.length - 1 ? (rowNum + rowNums[idx + 1]) / 2 : rowNum + 0.5;
      appendGap(nextBoundary);
    });

    btnUndo.disabled = historyIndex === 0;
    btnRedo.disabled = historyIndex >= history.length - 1;
    renderProps();
  }

  function appendGap(insertRow) {
    const gap = document.createElement('div');
    gap.className = 'designer-row-gap';
    gap.dataset.insertRow = String(insertRow);
    wireDropTarget(gap, { kind: 'gap', insertRow });
    rowsContainer.appendChild(gap);
  }

  function appendRow(rowNum) {
    const rowEls = elements.filter((e) => e.row === rowNum).sort((a, b) => a.col - b.col);
    const row = document.createElement('div');
    row.className = 'designer-row' + (showGrid ? ' show-grid' : '');
    row.dataset.row = String(rowNum);
    wireDropTarget(row, { kind: 'row', row: rowNum });

    rowEls.forEach((el) => {
      const box = document.createElement('div');
      box.className = 'designer-element' + (el.id === selectedId ? ' selected' : '');
      box.style.gridColumn = `${el.col} / span ${el.colSpan}`;
      box.draggable = true;
      box.dataset.id = el.id;
      box.tabIndex = 0;
      const typeLabel = (INIT.fieldTypes.find((t) => t.type === el.type) || {}).label || el.type;
      box.innerHTML = `<span class="el-type-badge">${typeLabel}</span><span class="el-label">${escapeHtml(el.props.label || el.props.text || '(ไม่มีป้าย)')}</span>`;
      box.addEventListener('click', () => { selectedId = el.id; render(); });
      box.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'move', id: el.id }));
        e.dataTransfer.effectAllowed = 'move';
      });
      row.appendChild(box);
    });

    rowsContainer.appendChild(row);
  }

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- drag & drop ----

  function colFromClientX(clientX) {
    const rect = canvas.getBoundingClientRect();
    const contentLeft = rect.left + mmToPx(15); // 15mm page padding
    const contentWidth = rect.width - mmToPx(30);
    const frac = (clientX - contentLeft) / contentWidth;
    return Math.max(1, Math.min(24, Math.round(frac * 24) + 1));
  }
  function mmToPx(mm) { return (mm / 25.4) * 96; }

  function wireDropTarget(el, target) {
    el.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (e) => {
      e.preventDefault();
      el.classList.remove('drag-over');
      handleDrop(target, e);
    });
  }

  function handleDrop(target, event) {
    let payload;
    try {
      payload = JSON.parse(event.dataTransfer.getData('text/plain'));
    } catch {
      return;
    }

    if (target.kind === 'gap') {
      const type = payload.kind === 'new' ? payload.type : elements.find((e) => e.id === payload.id).type;
      const base = payload.kind === 'new'
        ? { id: uid(), type, row: target.insertRow, col: 1, colSpan: DEFAULT_COL_SPAN[type] || 24, align: 'left', props: clone(INIT.defaultProps[type]) }
        : { ...elements.find((e) => e.id === payload.id), row: target.insertRow, col: 1 };
      const rest = payload.kind === 'new' ? elements : elements.filter((e) => e.id !== payload.id);
      selectedId = base.id;
      commit([...rest, base]);
      return;
    }

    // dropping into an existing row
    const dropCol = colFromClientX(event.clientX);
    if (payload.kind === 'new') {
      const type = payload.type;
      const span = Math.min(DEFAULT_COL_SPAN[type] || 24, 24 - dropCol + 1);
      const candidate = { id: uid(), type, row: target.row, col: dropCol, colSpan: span, align: 'left', props: clone(INIT.defaultProps[type]) };
      if (hasOverlap(elements, candidate, null)) return flashReject(target.row);
      selectedId = candidate.id;
      commit([...elements, candidate]);
    } else {
      const existing = elements.find((e) => e.id === payload.id);
      const span = Math.min(existing.colSpan, 24 - dropCol + 1);
      const candidate = { ...existing, row: target.row, col: dropCol, colSpan: span };
      const others = elements.filter((e) => e.id !== payload.id);
      if (hasOverlap(others, candidate, null)) return flashReject(target.row);
      commit([...others, candidate]);
    }
  }

  function flashReject(rowNum) {
    const row = rowsContainer.querySelector(`.designer-row[data-row="${rowNum}"]`);
    if (!row) return;
    row.classList.remove('reject-flash');
    void row.offsetWidth; // restart animation
    row.classList.add('reject-flash');
  }

  // palette items
  document.querySelectorAll('.palette-item').forEach((item) => {
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', JSON.stringify({ kind: 'new', type: item.dataset.type }));
      e.dataTransfer.effectAllowed = 'copy';
    });
  });

  // ---- properties panel ----

  function renderProps() {
    const el = elements.find((e) => e.id === selectedId);
    if (!el) {
      propsPanel.innerHTML = '<h3>คุณสมบัติ</h3><p class="designer-hint">คลิกองค์ประกอบเพื่อแก้ไข</p>';
      return;
    }
    propsPanel.innerHTML = '';
    const h3 = document.createElement('h3');
    h3.textContent = 'คุณสมบัติ: ' + el.type;
    propsPanel.appendChild(h3);

    const fields = propsFieldsFor(el);
    fields.forEach((f) => propsPanel.appendChild(f));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'button danger';
    del.textContent = 'ลบองค์ประกอบ';
    del.addEventListener('click', () => {
      selectedId = null;
      commit(elements.filter((e) => e.id !== el.id));
    });
    propsPanel.appendChild(del);
  }

  function field(labelText, inputEl) {
    const wrap = document.createElement('div');
    wrap.className = 'props-field';
    const label = document.createElement('label');
    label.textContent = labelText;
    wrap.appendChild(label);
    wrap.appendChild(inputEl);
    return wrap;
  }

  function updateProp(el, path, value) {
    const next = clone(el);
    let obj = next;
    const parts = path.split('.');
    for (let i = 0; i < parts.length - 1; i++) obj = obj[parts[i]];
    obj[parts[parts.length - 1]] = value;
    commit(elements.map((e) => (e.id === el.id ? next : e)));
  }

  function textInput(value, onChange) {
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value ?? '';
    input.addEventListener('change', () => onChange(input.value));
    return input;
  }
  function numberInput(value, onChange) {
    const input = document.createElement('input');
    input.type = 'number';
    input.value = value ?? '';
    input.addEventListener('change', () => onChange(input.value === '' ? undefined : Number(input.value)));
    return input;
  }
  function checkbox(checked, onChange) {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = Boolean(checked);
    input.addEventListener('change', () => onChange(input.checked));
    return input;
  }
  function select(options, value, onChange) {
    const sel = document.createElement('select');
    options.forEach((o) => {
      const opt = document.createElement('option');
      opt.value = o.value;
      opt.textContent = o.label;
      if (o.value === value) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  }
  function textarea(value, onChange) {
    const ta = document.createElement('textarea');
    ta.value = value ?? '';
    ta.addEventListener('change', () => onChange(ta.value));
    return ta;
  }

  function propsFieldsFor(el) {
    const out = [];
    const p = el.props;

    if (el.type !== 'static') {
      out.push(field('ป้ายกำกับ (label)', textInput(p.label, (v) => updateProp(el, 'props.label', v))));
    }
    if (['short_text', 'long_text', 'number', 'date', 'select_one', 'select_many', 'file'].includes(el.type)) {
      out.push(field('บังคับกรอก', checkbox(p.required, (v) => updateProp(el, 'props.required', v))));
    }

    if (el.type === 'short_text' || el.type === 'long_text') {
      out.push(field('ความยาวสูงสุด', numberInput(p.maxLength, (v) => updateProp(el, 'props.maxLength', v))));
    }
    if (el.type === 'long_text') {
      out.push(field('จำนวนแถว', numberInput(p.rows, (v) => updateProp(el, 'props.rows', v))));
    }
    if (el.type === 'number') {
      out.push(field('ค่าต่ำสุด', numberInput(p.min, (v) => updateProp(el, 'props.min', v))));
      out.push(field('ค่าสูงสุด', numberInput(p.max, (v) => updateProp(el, 'props.max', v))));
      out.push(field('ทศนิยม', numberInput(p.decimals, (v) => updateProp(el, 'props.decimals', v))));
      out.push(field('หน่วยนำหน้า', textInput(p.prefix, (v) => updateProp(el, 'props.prefix', v))));
      out.push(field('หน่วยต่อท้าย', textInput(p.suffix, (v) => updateProp(el, 'props.suffix', v))));
    }
    if (el.type === 'date') {
      out.push(field('โหมด', select([{ value: 'single', label: 'วันเดียว' }, { value: 'range', label: 'ช่วงวันที่' }], p.mode, (v) => updateProp(el, 'props.mode', v))));
    }
    if (el.type === 'select_one' || el.type === 'select_many') {
      out.push(field('ตัวเลือก (บรรทัดละ 1)', textarea((p.options || []).join('\n'), (v) => updateProp(el, 'props.options', v.split('\n').map((s) => s.trim()).filter(Boolean)))));
      if (el.type === 'select_one') {
        out.push(field('รูปแบบ', select([{ value: 'dropdown', label: 'dropdown' }, { value: 'radio', label: 'radio' }], p.display, (v) => updateProp(el, 'props.display', v))));
      } else {
        out.push(field('จัดวาง', select([{ value: 'inline', label: 'แถวเดียว' }, { value: 'list', label: 'รายการ' }], p.layout, (v) => updateProp(el, 'props.layout', v))));
      }
    }
    if (el.type === 'file') {
      out.push(field('จำนวนไฟล์สูงสุด', numberInput(p.maxFiles, (v) => updateProp(el, 'props.maxFiles', v))));
    }
    if (el.type === 'table') {
      out.push(field('แถวต่ำสุด', numberInput(p.minRows, (v) => updateProp(el, 'props.minRows', v))));
      out.push(field('แถวสูงสุด', numberInput(p.maxRows, (v) => updateProp(el, 'props.maxRows', v))));
      out.push(field(
        'คอลัมน์ (key|ป้าย|ชนิด|บังคับ ต่อบรรทัด)',
        textarea(
          (p.columns || []).map((c) => `${c.key}|${c.label}|${c.type}|${c.required ? '1' : '0'}`).join('\n'),
          (v) => updateProp(el, 'props.columns', v.split('\n').filter(Boolean).map((line) => {
            const [key, label, type, required] = line.split('|');
            return { key: (key || 'col').trim(), label: (label || key || '').trim(), type: (type || 'short_text').trim(), required: required === '1', width: 1 };
          })),
        ),
      ));
    }
    if (el.type === 'static') {
      out.push(field('รูปแบบ', select([{ value: 'heading', label: 'หัวข้อ' }, { value: 'paragraph', label: 'ย่อหน้า' }, { value: 'line', label: 'เส้นคั่น' }], p.variant, (v) => updateProp(el, 'props.variant', v))));
      out.push(field('ข้อความ', textarea(p.text, (v) => updateProp(el, 'props.text', v))));
    }
    if (el.type === 'auto') {
      out.push(field('แหล่งค่า', select(INIT.autoSources.map((s) => ({ value: s.value, label: s.label })), p.source, (v) => updateProp(el, 'props.source', v))));
    }

    out.push(field('จัดตำแหน่ง', select([{ value: 'left', label: 'ซ้าย' }, { value: 'center', label: 'กลาง' }, { value: 'right', label: 'ขวา' }], el.align, (v) => updateProp(el, 'align', v))));
    out.push(field('ความกว้าง (คอลัมน์)', numberInput(el.colSpan, (v) => {
      const span = Math.max(1, Math.min(24 - el.col + 1, Number(v) || 1));
      const candidate = { ...el, colSpan: span };
      if (hasOverlap(elements, candidate, el.id)) return flashReject(el.row);
      commit(elements.map((e) => (e.id === el.id ? candidate : e)));
    })));

    return out;
  }

  // ---- toolbar ----

  btnUndo.addEventListener('click', undo);
  btnRedo.addEventListener('click', redo);
  btnToggleGrid.addEventListener('click', () => { showGrid = !showGrid; render(); });
  btnPreview.addEventListener('click', () => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `/manage/forms/${INIT.formId}/preview`;
    form.target = '_blank';
    const input = document.createElement('input');
    input.type = 'hidden';
    input.name = 'elements';
    input.value = JSON.stringify(elements);
    form.appendChild(input);
    document.body.appendChild(form);
    form.submit();
    form.remove();
  });

  // ---- keyboard ----

  canvas.addEventListener('keydown', (e) => {
    const el = elements.find((x) => x.id === selectedId);
    if (e.key === 'Delete' && el) {
      e.preventDefault();
      selectedId = null;
      commit(elements.filter((x) => x.id !== el.id));
      return;
    }
    if ((e.key === 'Tab') && elements.length > 0) {
      e.preventDefault();
      const ordered = [...elements].sort((a, b) => (a.row - b.row) || (a.col - b.col));
      const idx = ordered.findIndex((x) => x.id === selectedId);
      const nextIdx = e.shiftKey ? (idx <= 0 ? ordered.length - 1 : idx - 1) : (idx >= ordered.length - 1 ? 0 : idx + 1);
      selectedId = ordered[nextIdx].id;
      render();
      return;
    }
    if (el && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault();
      if (e.key === 'ArrowLeft') updateProp(el, 'col', Math.max(1, el.col - 1));
      if (e.key === 'ArrowRight') updateProp(el, 'col', Math.min(24 - el.colSpan + 1, el.col + 1));
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const rowNums = groupRowNumbers(elements);
        const idx = rowNums.indexOf(el.row);
        const targetIdx = e.key === 'ArrowUp' ? idx - 1 : idx + 1;
        if (targetIdx >= 0 && targetIdx < rowNums.length) {
          const candidate = { ...el, row: rowNums[targetIdx] };
          if (!hasOverlap(elements, candidate, el.id)) commit(elements.map((x) => (x.id === el.id ? candidate : x)));
        }
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') { e.preventDefault(); redo(); }
  });

  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  render();
})();
