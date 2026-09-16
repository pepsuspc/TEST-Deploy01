// Progressive enhancement only: the "บันทึกร่าง" and "ส่ง" buttons already
// work as plain HTML form submissions (formaction/formmethod) without this
// script. This adds background autosave every 30s (§7.2) plus a JS-driven
// save button that doesn't reload the page, showing "บันทึกแล้ว HH:MM:SS".
//
// The save request is sent as application/x-www-form-urlencoded — the
// exact same encoding a plain form POST produces — rather than hand-built
// into a JSON object. That matters once fields nest brackets more than one
// level deep (a table field's `values[t][rows][0][item]`, a date range's
// `values[d][from]`): reconstructing that shape with a regex is exactly
// the kind of thing that quietly breaks the moment a new field type is
// added, whereas the server's own querystring parser (the same one a
// native form submit already goes through for §submit) handles arbitrary
// nesting correctly without this script having to know the shape at all.
(function () {
  const form = document.getElementById('memo-form');
  const status = document.getElementById('save-status');
  const saveBtn = document.getElementById('btn-save');
  if (!form || !form.dataset.saveUrl) return;

  let dirty = false;
  form.addEventListener('input', function () {
    dirty = true;
  });

  async function save() {
    if (status) status.textContent = 'กำลังบันทึก…';
    const params = new URLSearchParams();
    for (const [key, val] of new FormData(form).entries()) params.append(key, val);
    try {
      const res = await fetch(form.dataset.saveUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: params.toString(),
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
      const versionField = document.getElementById('version-field');
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
