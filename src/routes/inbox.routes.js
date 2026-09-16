import { Router } from 'express';
import { listPendingForApprover, listMySubmissions, subjectText, isOverdue } from '../models/submissions.js';
import { humanizeWaited } from '../domain/humanizeDuration.js';

export const inboxRouter = Router();

inboxRouter.get('/', async (req, res) => {
  const tab = req.query.tab === 'mine' ? 'mine' : 'pending';
  const [pending, mine] = await Promise.all([
    listPendingForApprover(req.user.emp_id),
    listMySubmissions(req.user.emp_id),
  ]);
  res.render('inbox', { tab, pending, mine, user: req.user, subjectText, isOverdue, humanizeWaited });
});
