// Every import below is dynamic (inside main()) rather than a static
// top-level import. config/env.js throws synchronously if .env is invalid,
// and a *static* import that throws crashes the process before our own
// code runs at all — printing Node's raw stack trace instead of the clean
// message env.js built. Dynamic imports turn that into a normal rejected
// promise we can catch below.
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

async function main() {
  const { env } = await import('./config/env.js');
  const { connectDb } = await import('./db/connection.js');
  const { ensureIndexes } = await import('./db/indexes.js');
  const { createApp } = await import('./app.js');
  const { syncUsers } = await import('./org/sync.js');
  const { sweepOrphanFiles } = await import('./models/files.js');
  const { seedMemoForm } = await import('./db/seedForms.js');
  const { processEmailQueue, runOverdueDigestIfDue } = await import('./mail/worker.js');

  const db = await connectDb();
  await ensureIndexes(db);

  // §D.8: sync the org chart once at boot (plus a button in the admin page
  // — chunk 4 — and daily thereafter). This has to happen before anyone
  // can be resolved as an approver (§7.5's `relative`/fixed rules read the
  // local `users` cache, not the org API directly) — a fresh deployment
  // with an empty cache would otherwise reject every approver as "not
  // found" until each of them happened to log in first, which is exactly
  // the bug a clean `docker compose up` test against a brand-new database
  // caught here. A failure must not crash startup (§D.2: "API นี้ล่ม ->
  // ระบบคุณต้องยังยื่น/อนุมัติได้" — the whole point is that the app stays
  // usable from whatever was cached last).
  try {
    const { count } = await syncUsers();
    console.log(`org sync at boot: ${count} employees`);
  } catch (err) {
    console.error(`org sync at boot failed (continuing with whatever is already cached): ${err.message}`);
  }
  setInterval(() => {
    syncUsers().catch((err) => console.error(`daily org sync failed: ${err.message}`));
  }, DAY_MS);

  // Idempotent: only inserts MEMO if no form with that docPrefix exists yet.
  await seedMemoForm(env.adminEmpIds[0] ?? 'E001').catch((err) => {
    console.error(`seeding MEMO form failed: ${err.message}`);
  });

  // §8.8: sweep files uploaded but never attached to a saved submission
  // (the user picked a file, then closed the tab without saving).
  setInterval(() => {
    sweepOrphanFiles()
      .then((n) => n > 0 && console.log(`orphan file sweep: removed ${n}`))
      .catch((err) => console.error(`orphan file sweep failed: ${err.message}`));
  }, DAY_MS);

  // §9.2: retry queue drained every minute; the digest job itself only
  // fires once it's actually 08:00 Asia/Bangkok (runOverdueDigestIfDue
  // no-ops otherwise), so checking every few minutes costs nothing.
  setInterval(() => {
    processEmailQueue().catch((err) => console.error(`email queue processing failed: ${err.message}`));
  }, MINUTE_MS);
  setInterval(() => {
    runOverdueDigestIfDue().catch((err) => console.error(`overdue digest failed: ${err.message}`));
  }, 5 * MINUTE_MS);

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
