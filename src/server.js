import { env } from './config/env.js'; // throws + exits before anything else if .env is broken
import { connectDb } from './db/connection.js';
import { ensureIndexes } from './db/indexes.js';
import { createApp } from './app.js';

async function main() {
  const db = await connectDb();
  await ensureIndexes(db);

  const app = createApp(db);
  app.listen(env.port, () => {
    console.log(`its-forms listening on ${env.appUrl} (port ${env.port}, AUTH_MODE=${env.authMode})`);
    if (env.authMode === 'mock') {
      console.log('*** MOCK AUTH ENABLED — DO NOT USE IN PRODUCTION ***');
    }
  });
}

main().catch((err) => {
  console.error('its-forms failed to start:');
  console.error(err.message);
  process.exit(1);
});
