// A small searchable-dropdown widget, shared by two spots that both need
// "type to filter, click to pick one real employee" rather than a plain
// <select> listing everyone: the submitter_choice picker on the edit page
// (memo-a4.ejs) and the workflow editor's "ระบุตัวคน" approver picker.
// Kept dependency-free (no datalist, which allows free text the server
// would then have to reject) — a text input + a filtered results list,
// backed by a hidden input that only ever holds a real emp_id.
//
// window.createEmployeeSearch(container, employees, opts) builds the
// widget inside `container`. opts: { name, initialEmpId, placeholder }.
(function () {
  function createEmployeeSearch(container, employees, opts) {
    opts = opts || {};
    container.classList.add('emp-search');
    container.innerHTML = '';

    const textInput = document.createElement('input');
    textInput.type = 'text';
    textInput.className = 'a4-input emp-search-input';
    textInput.autocomplete = 'off';
    textInput.placeholder = opts.placeholder || 'พิมพ์ชื่อเพื่อค้นหา…';

    const hiddenInput = document.createElement('input');
    hiddenInput.type = 'hidden';
    hiddenInput.name = opts.name || '';
    if (opts.form) hiddenInput.setAttribute('form', opts.form);

    const results = document.createElement('div');
    results.className = 'emp-search-results';
    results.hidden = true;

    if (opts.initialEmpId) {
      const initial = employees.find((e) => e.emp_id === opts.initialEmpId);
      if (initial) {
        textInput.value = labelFor(initial);
        hiddenInput.value = initial.emp_id;
      }
    }

    function labelFor(emp) {
      return emp.name + (emp.department ? ' — ' + emp.department.name : '');
    }

    function renderResults(query) {
      const q = query.trim().toLowerCase();
      const matches = q === ''
        ? employees.slice(0, 8)
        : employees.filter((e) => (e.name + ' ' + (e.department ? e.department.name : '')).toLowerCase().includes(q)).slice(0, 8);
      results.innerHTML = '';
      if (matches.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'emp-search-empty';
        empty.textContent = 'ไม่พบพนักงาน';
        results.appendChild(empty);
      }
      matches.forEach((emp) => {
        const item = document.createElement('div');
        item.className = 'emp-search-item';
        item.textContent = labelFor(emp);
        item.addEventListener('mousedown', (e) => {
          e.preventDefault(); // fire before the input's blur hides the list
          textInput.value = labelFor(emp);
          hiddenInput.value = emp.emp_id;
          results.hidden = true;
          container.dispatchEvent(new CustomEvent('empselect', { detail: emp, bubbles: true }));
        });
        results.appendChild(item);
      });
      results.hidden = false;
    }

    textInput.addEventListener('input', () => {
      hiddenInput.value = ''; // typing invalidates whatever was previously picked
      renderResults(textInput.value);
    });
    textInput.addEventListener('focus', () => renderResults(textInput.value));
    textInput.addEventListener('blur', () => { results.hidden = true; });

    container.appendChild(textInput);
    container.appendChild(hiddenInput);
    container.appendChild(results);

    return { textInput, hiddenInput };
  }

  window.createEmployeeSearch = createEmployeeSearch;
})();
