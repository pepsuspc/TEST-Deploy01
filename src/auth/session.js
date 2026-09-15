import cookieSession from 'cookie-session';
import { env } from '../config/env.js';

// §5.5: session cookie holds just emp_id + an expiry we check ourselves.
// cookie-session sets a Max-Age header for the browser's benefit, but
// doesn't itself re-validate expiry server-side against a tampered/replayed
// cookie — so requireAuth() below checks `expiresAt` explicitly too.
export const SESSION_MAX_AGE_MS = 9 * 60 * 60 * 1000; // sellcenter tokens also live 9h (§5.4)

export function sessionMiddleware() {
  return cookieSession({
    name: 'its_forms_session',
    keys: [env.sessionSecret],
    maxAge: SESSION_MAX_AGE_MS,
    httpOnly: true,
    sameSite: 'lax',
    secure: env.appUrl.startsWith('https://'),
  });
}

export function startSession(req, empId) {
  req.session.emp_id = empId;
  req.session.expiresAt = Date.now() + SESSION_MAX_AGE_MS;
}

export function requireAuth(req, res, next) {
  const session = req.session;
  if (!session?.emp_id || !session?.expiresAt || Date.now() > session.expiresAt) {
    req.session = null;
    return res.redirect('/auth/login');
  }
  next();
}
