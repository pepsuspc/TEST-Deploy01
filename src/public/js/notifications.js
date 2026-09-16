// §9.2: bell icon + 30s polling + mark-read on open. Included on every page
// via the topbar partial.
(function () {
  const bell = document.getElementById('notif-bell');
  const countEl = document.getElementById('notif-count');
  const panel = document.getElementById('notif-panel');
  const list = document.getElementById('notif-list');
  if (!bell) return;

  async function refresh() {
    try {
      const res = await fetch('/notifications');
      if (!res.ok) return;
      const body = await res.json();
      if (body.unreadCount > 0) {
        countEl.textContent = String(body.unreadCount);
        countEl.hidden = false;
      } else {
        countEl.hidden = true;
      }
      list.innerHTML = '';
      if (body.items.length === 0) {
        const li = document.createElement('li');
        li.className = 'notif-empty';
        li.textContent = 'ไม่มีการแจ้งเตือน';
        list.appendChild(li);
        return;
      }
      body.items.forEach(function (n) {
        const li = document.createElement('li');
        li.className = 'notif-item' + (n.status === 'unread' ? ' is-unread' : '');
        const a = document.createElement('a');
        a.href = n.link;
        a.textContent = n.subject;
        li.appendChild(a);
        list.appendChild(li);
      });
    } catch (err) {
      // network hiccup — next poll will retry
    }
  }

  bell.addEventListener('click', function () {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      fetch('/notifications/mark-read', { method: 'POST' }).then(refresh);
    }
  });

  document.addEventListener('click', function (e) {
    if (!panel.hidden && !panel.contains(e.target) && e.target !== bell) panel.hidden = true;
  });

  refresh();
  setInterval(refresh, 30000);
})();
