import express from 'express';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { healthRouter } from './routes/health.routes.js';
import { authRouter } from './routes/auth.routes.js';
import { sessionMiddleware, requireAuth } from './auth/session.js';
import { findUserByEmpId } from './models/users.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

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

  app.get('/', (req, res) => {
    res.render('home', { user: res.locals.user });
  });

  return app;
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
