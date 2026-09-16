// §10.6 "ตั้งค่า" tab's co-owner list (§4.6 "ผู้ดูแลร่วม") — same
// add-via-search, remove-via-button pattern as the workflow editor's
// approver list, except these entries submit as plain hidden inputs
// inside the settings <form> (a normal POST, not the workflow editor's
// own fetch-based autosave) since this page already saves everything
// else that way.
(function () {
  const INIT = window.__FORM_SETTINGS_INIT__;
  if (!INIT) return;

  const list = document.getElementById('coowner-list');
  const hiddenWrap = document.getElementById('coowner-hidden-inputs');
  const searchRoot = document.getElementById('coowner-search');
  let coOwnerEmpIds = [...INIT.coOwnerEmpIds];

  function nameFor(empId) {
    const emp = INIT.employees.find((e) => e.emp_id === empId);
    return emp ? emp.name : empId;
  }

  function render() {
    list.innerHTML = '';
    hiddenWrap.innerHTML = '';
    coOwnerEmpIds.forEach((empId) => {
      const li = document.createElement('li');
      li.textContent = nameFor(empId) + ' ';
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.className = 'file-field-remove';
      rm.textContent = '(ลบ)';
      rm.addEventListener('click', () => {
        coOwnerEmpIds = coOwnerEmpIds.filter((id) => id !== empId);
        render();
      });
      li.appendChild(rm);
      list.appendChild(li);

      const hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = 'coOwnerEmpIds';
      hidden.value = empId;
      hiddenWrap.appendChild(hidden);
    });
    if (coOwnerEmpIds.length === 0) {
      const li = document.createElement('li');
      li.className = 'a4-save-status';
      li.textContent = 'ยังไม่มีผู้ดูแลร่วม';
      list.appendChild(li);
    }
  }

  const search = createEmployeeSearch(searchRoot, INIT.employees, { placeholder: 'พิมพ์ชื่อพนักงานเพื่อเพิ่มผู้ดูแลร่วม…' });
  searchRoot.addEventListener('empselect', (e) => {
    const empId = e.detail.emp_id;
    if (!coOwnerEmpIds.includes(empId) && !INIT.ownerEmpIds.includes(empId)) {
      coOwnerEmpIds.push(empId);
      render();
    }
    search.textInput.value = '';
    search.hiddenInput.value = '';
  });

  render();
})();
