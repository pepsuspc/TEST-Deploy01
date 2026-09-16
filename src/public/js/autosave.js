// Progressive enhancement only: the "บันทึกร่าง" and "ส่ง" buttons already
// work as plain HTML form submissions (formaction/formmethod) without this
// script. This adds background autosave every 30s (§7.2) plus a JS-driven
// save button that doesn't reload the page, showing "บันทึกแล้ว HH:MM:SS".
(function () {
  const form = document.getElementById('memo-form');
  const status = document.getElementById('save-status');
  const saveBtn = document.getElementById('btn-save');
  if (!form || !form.dataset.saveUrl) return;

  let dirty = false;
  form.addEventListener('input', function () {
    dirty = true;
  });

  function serializeValues() {
    const formData = new FormData(form);
    const values = {};
    for (const [key, val] of formData.entries()) {
      const m = key.match(/^values\[(.+?)\](\[\])?$/);
      if (!m) continue;
      const id = m[1];
      const isArray = Boolean(m[2]);
      if (isArray) {
        if (!Array.isArray(values[id])) values[id] = [];
        values[id].push(val);
      } else {
        values[id] = val;
      }
    }
    return values;
  }

  async function save() {
    if (status) status.textContent = 'กำลังบันทึก…';
    const versionField = document.getElementById('version-field');
    try {
      const res = await fetch(form.dataset.saveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ values: serializeValues(), version: versionField ? versionField.value : undefined }),
      });
      if (res.status === 409) {
        if (status) status.textContent = 'มีการเปลี่ยนแปลงจากที่อื่น กรุณาโหลดหน้าใหม่ก่อนบันทึกต่อ';
        return;
      }
      if (!res.ok) throw new Error('save failed');
      const body = await res.json();
      dirty = false;
      // §8.9: keep the version this tab thinks it's editing in sync with
      // what the server now has, so the *next* save still guards correctly
      // instead of immediately 409-ing against its own prior save.
      if (versionField && body.version !== undefined) versionField.value = body.version;
      const time = new Date(body.savedAt).toLocaleTimeString('th-TH', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
      if (status) status.textContent = `บันทึกแล้ว ${time}`;
    } catch (err) {
      if (status) status.textContent = 'บันทึกไม่สำเร็จ ลองใหม่';
    }
  }

  if (saveBtn) {
    saveBtn.addEventListener('click', function (e) {
      e.preventDefault();
      save();
    });
  }

  setInterval(function () {
    if (dirty) save();
  }, 30000);
})();
