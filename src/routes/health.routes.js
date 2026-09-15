import { Router } from 'express';
import { pingDb } from '../db/connection.js';

export const healthRouter = Router();

// GET /healthz — no login required (§13: "ไม่ต้อง login").
healthRouter.get('/', async (req, res) => {
  try {
    await pingDb();
    res.status(200).json({ status: 'ok', db: 'ok' });
  } catch (err) {
    res.status(200).json({ status: 'ok', db: 'error', error: err.message });
  }
});
