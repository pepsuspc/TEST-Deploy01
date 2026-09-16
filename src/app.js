import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { healthRouter } from './routes/health.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { submissionsRouter } from './routes/submissions.routes.js';
import { sessionMiddleware, requireAuth } from './auth/session.js';
import { findUserByEmpId } from './models/users.js';
import { formatThaiDate } from './domain/thaiDate.js';
import { formatNumber, formatFileSize } from './domain/formatters.js';
import { STATUS_LABEL } from './domain/statusLabels.js';
import { inboxRouter } from './routes/inbox.routes.js';
import { notificationsRouter } from './routes/notifications.routes.js';
import { filesRouter } from './routes/files.routes.js';
import { formsRouter, manageFormsRouter } from './routes/forms.routes.js';
import { adminRouter } from './routes/admin.routes.js';
import { HttpError } from './lib/httpError.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));
  app.locals.formatThaiDate = formatThaiDate;
  app.locals.formatNumber = formatNumber;
  app.locals.formatFileSize = formatFileSize;
  app.locals.STATUS_LABEL = STATUS_LABEL;

  // Static files and /healthz need no login (§12.1).
  app.use(express.static(path.join(__dirname, 'public')));
  app.use('/healthz', healthRouter);

  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());
  app.use(cookieParser());
  app.use(requestLogger);
  app.use(sessionMiddleware());

  // /auth/* also needs no login — it's how you get one.
  app.use('/auth', authRouter);

  // Every route below this line requires a valid session (§12.1).
  app.use(requireAuth);
  app.use(loadCurrentUser);

  // §10.1: the inbox is "หน้าแรกหลัง login" — home.ejs was only a chunk-1
  // placeholder before /inbox existed.
  app.get('/', (req, res) => res.redirect('/inbox'));

  app.use('/submissions', submissionsRouter);
  app.use('/inbox', inboxRouter);
  app.use('/notifications', notificationsRouter);
  app.use('/files', filesRouter);
  app.use('/forms', formsRouter);
  app.use('/manage/forms', manageFormsRouter);
  app.use('/admin', adminRouter);

  app.use((req, res) => {
    res.status(404).render('error', { status: 404, message: 'ไม่พบหน้านี้' });
  });

  app.use(errorHandler);

  return app;
}

function wantsJson(req) {
  return req.get('accept')?.includes('application/json') || req.get('content-type')?.includes('multipart/form-data');
}

function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    if (wantsJson(req)) return res.status(err.status).json({ error: err.message });
    return res.status(err.status).render('error', { status: err.status, message: err.message });
  }
  console.error(err);
  if (wantsJson(req)) return res.status(500).json({ error: 'เกิดข้อผิดพลาดที่ไม่คาดคิด' });
  res.status(500).render('error', { status: 500, message: 'เกิดข้อผิดพลาดที่ไม่คาดคิด' });
}

// §13: log every request — method, path, status, ms, emp_id.
function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    const empId = req.session?.emp_id || '-';
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms emp_id=${empId}`);
  });
  next();
}

// Attaches the full `users` document (name, department, roles, ...) to
// req.user / res.locals.user so views and route handlers don't each have to
// look it up themselves. If the session's emp_id has no matching user
// somehow, treat it as logged out rather than crashing downstream views.
async function loadCurrentUser(req, res, next) {
  const user = await findUserByEmpId(req.session.emp_id);
  if (!user) {
    req.session = null;
    return res.redirect('/auth/login');
  }
  req.user = user;
  res.locals.user = user;
  next();
}
