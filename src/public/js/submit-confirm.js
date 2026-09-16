// §10.3 "หน้ายืนยัน": before the real submit, resolve the workflow against
// whatever's currently in the form (including any submitter_choice picks)
// and show the submitter exactly who this will go to. A blocked resolution
// (e.g. no chief on file) surfaces here instead of failing silently later.
(function () {
  const form = document.getElementById('memo-form');
  if (!form) return;
  const submitBtn = document.querySelector('button[formaction$="/submit"]');
  if (!submitBtn) return;

  submitBtn.addEventListener('click', async function (e) {
    e.preventDefault();
    const params = new URLSearchParams();
    for (const [key, val] of new FormData(form).entries()) params.append(key, val);

    let body;
    try {
      const res = await fetch(`/submissions/${form.dataset.submissionId}/resolve-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: params.toString(),
      });
      body = await res.json();
    } catch (err) {
      alert('ตรวจสอบสายอนุมัติไม่สำเร็จ ลองใหม่');
      return;
    }

    if (!body.ok) {
      alert(body.blocked || 'ไม่สามารถส่งได้');
      return;
    }

    const summary = body.steps
      .map(function (s, i) {
        const who = s.approvers.length > 1 ? `${s.approvers.join(', ')} (${s.quorum} จาก ${s.approvers.length})` : s.approvers.join(', ');
        return `${i + 1}. ${s.name}: ${who}`;
      })
      .join('\n');

    if (window.confirm(`คำร้องนี้จะส่งไปตามลำดับนี้:\n\n${summary}\n\nยืนยันส่งคำร้อง?`)) {
      form.requestSubmit(submitBtn);
    }
  });
})();
