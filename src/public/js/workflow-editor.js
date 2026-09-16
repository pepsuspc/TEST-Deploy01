// §7.5/§10.6 "สายอนุมัติ" tab. Simpler interaction model than the paper
// designer (public/js/designer.js): steps are a plain ordered list, so
// reordering is up/down buttons rather than drag-and-drop — the same
// capability (any order you want), much less code for something used far
// less often than placing a field.
(function () {
  const INIT = window.__WORKFLOW_INIT__;
  if (!INIT) return;

  const container = document.getElementById('workflow-steps');
  const saveStatus = document.getElementById('workflow-save-status');
  let steps = clone(INIT.steps);
  let dirty = false;

  function clone(x) { return JSON.parse(JSON.stringify(x)); }
  function uid() { return 's_' + Math.random().toString(36).slice(2, 9); }
  function mkButton(text, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'button secondary';
    btn.textContent = text;
    btn.addEventListener('click', onClick);
    return btn;
  }

  function markDirty() {
    dirty = true;
    if (saveStatus) saveStatus.textContent = 'มีการเปลี่ยนแปลงยังไม่บันทึก — กด "บันทึกสายอนุมัติ"';
  }

  function approverSummary(a) {
    if (a.type === 'user') {
      const emp = INIT.employees.find((e) => e.emp_id === a.emp_id);
      return 'ระบุตัวคน: ' + (emp ? emp.name : a.emp_id);
    }
    if (a.type === 'relative') {
      return a.relation === 'chief' ? 'หัวหน้าโดยตรงของผู้ยื่น' : 'ผู้จัดการฝ่ายของผู้ยื่น';
    }
    if (a.type === 'submitter_choice') {
      return 'ผู้ยื่นเลือกเอง (' + (a.label || '') + ')' + (a.restrictDepartment ? ' — เฉพาะแผนกที่กำหนด' : '');
    }
    return a.type;
  }

  function render() {
    container.innerHTML = '';
    steps.forEach((step, idx) => container.appendChild(renderStepCard(step, idx)));
  }

  function renderStepCard(step, idx) {
    const card = document.createElement('div');
    card.className = 'action-panel';

    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.gap = '0.5rem';
    header.style.alignItems = 'center';
    header.style.marginBottom = '0.5rem';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'a4-input';
    nameInput.style.width = 'auto';
    nameInput.value = step.name;
    nameInput.placeholder = 'ชื่อขั้น เช่น ผู้ตรวจสอบ';
    nameInput.addEventListener('change', () => { step.name = nameInput.value; markDirty(); });
    header.appendChild(nameInput);

    const upBtn = mkButton('↑', () => { if (idx > 0) { [steps[idx - 1], steps[idx]] = [steps[idx], steps[idx - 1]]; markDirty(); render(); } });
    upBtn.disabled = idx === 0;
    const downBtn = mkButton('↓', () => { if (idx < steps.length - 1) { [steps[idx + 1], steps[idx]] = [steps[idx], steps[idx + 1]]; markDirty(); render(); } });
    downBtn.disabled = idx === steps.length - 1;
    header.appendChild(upBtn);
    header.appendChild(downBtn);

    const deadlineLabel = document.createElement('label');
    deadlineLabel.style.fontSize = '0.85rem';
    deadlineLabel.textContent = 'กำหนด (วัน): ';
    const deadlineInput = document.createElement('input');
    deadlineInput.type = 'number';
    deadlineInput.min = '1';
    deadlineInput.style.width = '4rem';
    deadlineInput.className = 'a4-input';
    deadlineInput.value = step.deadlineDays ?? '';
    deadlineInput.placeholder = 'ไม่มี';
    deadlineInput.addEventListener('change', () => { step.deadlineDays = deadlineInput.value ? Number(deadlineInput.value) : null; markDirty(); });
    deadlineLabel.appendChild(deadlineInput);
    header.appendChild(deadlineLabel);

    const spacer = document.createElement('span');
    spacer.style.flex = '1';
    header.appendChild(spacer);

    const delStepBtn = document.createElement('button');
    delStepBtn.type = 'button';
    delStepBtn.className = 'button danger';
    delStepBtn.textContent = 'ลบขั้น';
    delStepBtn.addEventListener('click', () => {
      if (steps.length <= 1) return alert('ต้องมีอย่างน้อย 1 ขั้น');
      steps = steps.filter((s) => s.id !== step.id);
      markDirty();
      render();
    });
    header.appendChild(delStepBtn);

    card.appendChild(header);

    // approvers list
    const list = document.createElement('ul');
    list.style.listStyle = 'none';
    list.style.padding = '0';
    step.approvers.forEach((a, aIdx) => {
      const li = document.createElement('li');
      li.style.padding = '0.3rem 0';
      li.textContent = approverSummary(a) + ' ';
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'link-button';
      rm.textContent = '(ลบ)';
      rm.addEventListener('click', () => {
        step.approvers = step.approvers.filter((_, i) => i !== aIdx);
        if (step.quorum > step.approvers.length) step.quorum = Math.max(1, step.approvers.length);
        markDirty();
        render();
      });
      li.appendChild(rm);
      list.appendChild(li);
    });
    card.appendChild(list);

    card.appendChild(renderAddApproverForm(step));

    // quorum
    const quorumWrap = document.createElement('div');
    quorumWrap.className = 'props-field';
    quorumWrap.style.marginTop = '0.5rem';
    const quorumLabel = document.createElement('label');
    quorumLabel.textContent = 'ต้องอนุมัติ (N จาก M คน)';
    const quorumSelect = document.createElement('select');
    quorumSelect.className = 'a4-input';
    const m = Math.max(1, step.approvers.length);
    for (let n = 1; n <= m; n++) {
      const opt = document.createElement('option');
      opt.value = String(n);
      opt.textContent = n === m ? `ทุกคน (${n} จาก ${m})` : `${n} จาก ${m}`;
      if (step.quorum === n) opt.selected = true;
      quorumSelect.appendChild(opt);
    }
    quorumSelect.addEventListener('change', () => { step.quorum = Number(quorumSelect.value); markDirty(); });
    quorumWrap.appendChild(quorumLabel);
    quorumWrap.appendChild(quorumSelect);
    card.appendChild(quorumWrap);

    return card;
  }

  function renderAddApproverForm(step) {
    const wrap = document.createElement('div');
    wrap.style.borderTop = '1px solid var(--color-border)';
    wrap.style.paddingTop = '0.5rem';
    wrap.style.marginTop = '0.5rem';

    const typeSelect = document.createElement('select');
    typeSelect.className = 'a4-input';
    typeSelect.style.width = 'auto';
    [
      ['user', 'ระบุตัวคน'],
      ['relative:chief', 'หัวหน้าโดยตรงของผู้ยื่น'],
      ['relative:department_head', 'ผู้จัดการฝ่ายของผู้ยื่น'],
      ['submitter_choice', 'ให้ผู้ยื่นเลือกเอง'],
    ].forEach(([value, label]) => {
      const opt = document.createElement('option');
      opt.value = value;
      opt.textContent = label;
      typeSelect.appendChild(opt);
    });

    const detailWrap = document.createElement('span');

    function renderDetail() {
      detailWrap.innerHTML = '';
      if (typeSelect.value === 'user') {
        const sel = document.createElement('select');
        sel.className = 'a4-input';
        sel.style.width = 'auto';
        INIT.employees.forEach((e) => {
          const opt = document.createElement('option');
          opt.value = e.emp_id;
          opt.textContent = e.name + (e.department ? ' — ' + e.department.name : '');
          sel.appendChild(opt);
        });
        detailWrap.appendChild(sel);
      } else if (typeSelect.value === 'submitter_choice') {
        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.className = 'a4-input';
        labelInput.style.width = 'auto';
        labelInput.placeholder = 'ป้าย เช่น เรียน';
        labelInput.value = 'เรียน';
        detailWrap.appendChild(labelInput);
      }
    }
    typeSelect.addEventListener('change', renderDetail);
    renderDetail();

    const addBtn = document.createElement('button');
    addBtn.type = 'button';
    addBtn.className = 'button secondary';
    addBtn.textContent = '+ เพิ่มผู้อนุมัติ';
    addBtn.addEventListener('click', () => {
      let approver;
      if (typeSelect.value === 'user') {
        const sel = detailWrap.querySelector('select');
        approver = { type: 'user', emp_id: sel.value };
      } else if (typeSelect.value === 'relative:chief') {
        approver = { type: 'relative', relation: 'chief' };
      } else if (typeSelect.value === 'relative:department_head') {
        approver = { type: 'relative', relation: 'department_head' };
      } else {
        const labelInput = detailWrap.querySelector('input');
        approver = { type: 'submitter_choice', label: labelInput.value || 'เลือกผู้รับ', restrictDepartment: null };
      }
      step.approvers.push(approver);
      if (step.approvers.length === 1) step.quorum = 1;
      markDirty();
      render();
    });

    wrap.appendChild(typeSelect);
    wrap.appendChild(detailWrap);
    wrap.appendChild(addBtn);
    return wrap;
  }

  document.getElementById('btn-add-step').addEventListener('click', () => {
    steps.push({ id: uid(), name: '', quorum: 1, approvers: [], deadlineDays: null });
    markDirty();
    render();
  });

  async function save() {
    if (saveStatus) saveStatus.textContent = 'กำลังบันทึก…';
    try {
      const res = await fetch(`/manage/forms/${INIT.formId}/workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: 'steps=' + encodeURIComponent(JSON.stringify(steps)),
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
  document.getElementById('btn-save-workflow').addEventListener('click', save);

  window.addEventListener('beforeunload', (e) => {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  render();
})();
