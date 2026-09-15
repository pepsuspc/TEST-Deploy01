// Every import below is dynamic (inside main()) rather than a static
// top-level import. config/env.js throws synchronously if .env is invalid,
// and a *static* import that throws crashes the process before our own
// code runs at all — printing Node's raw stack trace instead of the clean
// message env.js built. Dynamic imports turn that into a normal rejected
// promise we can catch below.
async function main() {
  const { env } = await import('./config/env.js');
  const { connectDb } = await import('./db/connection.js');
  const { ensureIndexes } = await import('./db/indexes.js');
  const { createApp } = await import('./app.js');

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
