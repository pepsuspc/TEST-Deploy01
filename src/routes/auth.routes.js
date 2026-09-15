import { Router } from 'express';
import { env } from '../config/env.js';
import { mockAuthRouter } from '../auth/mock.js';
import { ssoAuthRouter } from '../auth/sso.js';

export const authRouter = Router();

// Only one of these is ever mounted — under AUTH_MODE=sso the mock routes
// must not exist at all (404), not just be hidden from the UI (§5.6).
if (env.authMode === 'mock') {
  authRouter.use(mockAuthRouter);
} else {
  authRouter.use(ssoAuthRouter);
}
