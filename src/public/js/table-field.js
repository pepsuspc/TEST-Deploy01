// §7.3 table field: add/remove rows client-side, keeping each input's
// `name="values[id][rows][N][col]"` renumbered contiguously so the server
// (which relies on qs parsing bracketed numeric indices into a real array)
// always sees a clean 0..N-1 sequence — a gap from a removed middle row
// would otherwise parse into a sparse/object-like structure instead.
(function () {
  document.querySelectorAll('.table-field').forEach(function (field) {
    const tbody = field.querySelector('tbody');
    const template = field.querySelector('.table-field-row-template');
    const maxRows = Number(field.dataset.maxRows || 50);
    const minRows = Number(field.dataset.minRows || 1);

    function renumber() {
      Array.from(tbody.querySelectorAll('tr')).forEach(function (tr, rowIndex) {
        tr.querySelectorAll('input, select').forEach(function (input) {
          input.name = input.name.replace(/\[rows\]\[\d+\]/, '[rows][' + rowIndex + ']');
        });
      });
      const removeButtons = tbody.querySelectorAll('.table-field-remove');
      removeButtons.forEach(function (btn) {
        btn.disabled = removeButtons.length <= minRows;
      });
    }

    field.querySelector('.table-field-add').addEventListener('click', function () {
      if (tbody.querySelectorAll('tr').length >= maxRows) return;
      const clone = template.content.cloneNode(true);
      clone.querySelectorAll('input, select').forEach(function (input) {
        input.name = input.name.replace('__INDEX__', String(tbody.querySelectorAll('tr').length));
      });
      tbody.appendChild(clone);
      renumber();
    });

    tbody.addEventListener('click', function (e) {
      if (!e.target.classList.contains('table-field-remove')) return;
      if (tbody.querySelectorAll('tr').length <= minRows) return;
      e.target.closest('tr').remove();
      renumber();
    });

    renumber();
  });
})();
