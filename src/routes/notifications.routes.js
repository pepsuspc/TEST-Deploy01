import { Router } from 'express';
import { listRecentForUser, countUnread, markAllRead } from '../models/notifications.js';

export const notificationsRouter = Router();

// §9.2: "รายการ 30 อันล่าสุด ... refresh ทุก 30 วินาที (polling)".
notificationsRouter.get('/', async (req, res) => {
  const [items, unreadCount] = await Promise.all([
    listRecentForUser(req.user.emp_id, 30),
    countUnread(req.user.emp_id),
  ]);
  res.json({ items, unreadCount });
});

notificationsRouter.post('/mark-read', async (req, res) => {
  await markAllRead(req.user.emp_id);
  res.json({ ok: true });
});
