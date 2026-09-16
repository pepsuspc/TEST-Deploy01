// §8.8 upload flow: "อัปโหลดทีละไฟล์ทันทีที่เลือก" — upload the instant a
// file is picked, not deferred until the draft is saved. The returned
// fileId is stashed as a hidden input so it rides along with the next
// save/submit like any other field value.
(function () {
  const form = document.getElementById('memo-form');
  if (!form) return;
  const submissionId = form.dataset.submissionId;

  document.querySelectorAll('.file-field').forEach(function (field) {
    const elementId = field.dataset.fieldId;
    const maxFiles = Number(field.dataset.maxFiles || 5);
    const accept = field.dataset.accept;
    const list = field.querySelector('.file-field-list');
    const input = field.querySelector('.file-field-input');
    const status = field.querySelector('.file-field-status');
    if (accept) input.setAttribute('accept', accept.split(',').map((e) => '.' + e).join(','));

    function currentCount() {
      return list.querySelectorAll('li').length;
    }

    function addRow(f) {
      const li = document.createElement('li');
      li.dataset.fileId = f.fileId;
      li.textContent = f.name + ' (' + Math.round(f.size / 1024) + ' KB) ';
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'file-field-remove';
      removeBtn.textContent = 'ลบ';
      const hidden = document.createElement('input');
      hidden.type = 'hidden';
      hidden.name = 'values[' + elementId + '][]';
      hidden.value = f.fileId;
      li.appendChild(removeBtn);
      li.appendChild(hidden);
      list.appendChild(li);
    }

    input.addEventListener('change', async function () {
      const file = input.files[0];
      if (!file) return;
      if (currentCount() >= maxFiles) {
        status.textContent = 'แนบได้ไม่เกิน ' + maxFiles + ' ไฟล์';
        input.value = '';
        return;
      }
      status.textContent = 'กำลังอัปโหลด…';
      const formData = new FormData();
      formData.append('file', file);
      if (submissionId) formData.append('submissionId', submissionId);
      formData.append('elementId', elementId);
      try {
        const res = await fetch('/files/upload', { method: 'POST', body: formData });
        const body = await res.json();
        if (!res.ok) {
          status.textContent = body.error || 'อัปโหลดไม่สำเร็จ';
          return;
        }
        addRow(body);
        status.textContent = '';
      } catch (err) {
        status.textContent = 'อัปโหลดไม่สำเร็จ ลองใหม่';
      }
      input.value = '';
    });

    list.addEventListener('click', function (e) {
      if (!e.target.classList.contains('file-field-remove')) return;
      e.target.closest('li').remove();
    });
  });
})();
