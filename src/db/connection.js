import { MongoClient } from 'mongodb';
import { env } from '../config/env.js';

const client = new MongoClient(env.mongodbUri);
let db;

export async function connectDb() {
  if (db) return db;
  await client.connect();
  db = client.db();
  return db;
}

export function getDb() {
  if (!db) throw new Error('getDb() called before connectDb() — connect first in server.js');
  return db;
}

// Test-only: point getDb() at an already-connected test database, bypassing
// connectDb()/env.mongodbUri entirely (used by integration tests that need
// a specific throwaway database rather than whatever dev/prod is pointed at).
export function setDbForTest(testDb) {
  db = testDb;
}

export async function closeDb() {
  await client.close();
  db = undefined;
}

export async function pingDb() {
  await client.db().command({ ping: 1 });
}
