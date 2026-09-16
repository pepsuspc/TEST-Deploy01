import { Router } from 'express';
import { listPendingForApprover, listMySubmissions, subjectText, isOverdue } from '../models/submissions.js';
import { humanizeWaited } from '../domain/humanizeDuration.js';

export const inboxRouter = Router();

async function withSubjects(submissions) {
  return Promise.all(submissions.map(async (s) => ({ ...s, subject: await subjectText(s) })));
}

inboxRouter.get('/', async (req, res) => {
  const tab = req.query.tab === 'mine' ? 'mine' : 'pending';
  const [pendingRaw, mineRaw] = await Promise.all([
    listPendingForApprover(req.user.emp_id),
    listMySubmissions(req.user.emp_id),
  ]);
  // subjectText is now async (it may need to load the live form), so the
  // subject is precomputed here rather than called from inside the EJS
  // loop — EJS can't await mid-template.
  const [pending, mine] = await Promise.all([withSubjects(pendingRaw), withSubjects(mineRaw)]);
  res.render('inbox', { tab, pending, mine, user: req.user, isOverdue, humanizeWaited });
});
