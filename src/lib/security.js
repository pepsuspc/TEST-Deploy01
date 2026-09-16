// §12.4 CSRF: this app takes the spec's own explicitly-allowed alternative
// to per-form tokens — "SameSite=Lax cookie + ตรวจ Origin header" — rather
// than threading a CSRF token through every one of the many plain <form>
// POSTs across the app. SameSite=Lax (already set in auth/session.js) is
// the primary defense: browsers withhold the session cookie entirely on a
// cross-site POST, so a forged form on another site can't ride the
// victim's session in the first place. This Origin check is the second
// layer, mainly for older browsers that don't enforce SameSite.
//
// Compared against `req.get('host')` (this request's own Host header)
// rather than a fixed configured APP_URL, so it keeps working correctly
// behind a reverse proxy or under a hostname that doesn't exactly match
// whatever APP_URL happens to be set to.
import { HttpError } from './httpError.js';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export function requireSameOrigin(req, res, next) {
  if (!UNSAFE_METHODS.has(req.method)) return next();
  const origin = req.get('origin');
  // No Origin header, or the literal string "null" — sent by real
  // browsers for some legitimate same-site navigations too (observed live
  // from a plain <form> POST during testing, not just the sandboxed-iframe
  // case this value is usually associated with) — SameSite=Lax remains
  // the actual gate for either case.
  if (!origin || origin === 'null') return next();
  let originHost;
  try {
    originHost = new URL(origin).host;
  } catch {
    return next(new HttpError(403, 'คำขอถูกปฏิเสธ'));
  }
  if (originHost !== req.get('host')) {
    return next(new HttpError(403, 'คำขอถูกปฏิเสธ'));
  }
  next();
}
