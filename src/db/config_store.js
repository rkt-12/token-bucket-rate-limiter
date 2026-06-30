// This file persists per-client rate-limit configs to SQLite via sql.js.
// On startup, loads all configs into Redis so the hot path never touches disk.

import initSqlJs from 'sql.js';
import fs from 'fs';
import path from 'path';

const DB_PATH = process.env.DB_PATH || './data/ratelimiter.db';

let db = null;

export async function initDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

  const SQL = await initSqlJs();

  // Load existing db or create a fresh one
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS clients (
      client_key    TEXT PRIMARY KEY,
      algorithm     TEXT NOT NULL DEFAULT 'token_bucket',
      capacity      INTEGER NOT NULL DEFAULT 100,
      refill_rate   REAL NOT NULL DEFAULT 10,
      window_ms     INTEGER NOT NULL DEFAULT 1000,
      limit_count   INTEGER NOT NULL DEFAULT 100,
      created_at    INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    )
  `);

  persist();
  return db;
}

function persist() {
  if (!db) return;
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

export function upsertClient(config) {
  if (!db) throw new Error('DB not initialised');
  const now = Date.now();
  db.run(`
    INSERT INTO clients
      (client_key, algorithm, capacity, refill_rate, window_ms, limit_count, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(client_key) DO UPDATE SET
      algorithm   = excluded.algorithm,
      capacity    = excluded.capacity,
      refill_rate = excluded.refill_rate,
      window_ms   = excluded.window_ms,
      limit_count = excluded.limit_count,
      updated_at  = excluded.updated_at
  `, [
    config.client_key,
    config.algorithm    ?? 'token_bucket',
    config.capacity     ?? 100,
    config.refill_rate  ?? 10,
    config.window_ms    ?? 1000,
    config.limit_count  ?? 100,
    now, now
  ]);
  persist();
}

export function getClient(clientKey) {
  if (!db) throw new Error('DB not initialised');
  const stmt = db.prepare('SELECT * FROM clients WHERE client_key = ?');
  stmt.bind([clientKey]);
  if (stmt.step()) return stmt.getAsObject();
  return null;
}

export function getAllClients() {
  if (!db) throw new Error('DB not initialised');
  const results = [];
  const stmt = db.prepare('SELECT * FROM clients');
  while (stmt.step()) results.push(stmt.getAsObject());
  return results;
}

export function deleteClient(clientKey) {
  if (!db) throw new Error('DB not initialised');
  db.run('DELETE FROM clients WHERE client_key = ?', [clientKey]);
  persist();
}