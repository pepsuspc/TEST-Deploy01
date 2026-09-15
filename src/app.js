import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { healthRouter } from './routes/health.routes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createApp() {
  const app = express();

  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'views'));

  app.use(express.static(path.join(__dirname, 'public')));
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  app.use(requestLogger);

  app.use('/healthz', healthRouter);

  app.get('/', (req, res) => {
    res.type('text/plain').send('its-forms');
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
