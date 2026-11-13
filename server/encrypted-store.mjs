import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';

// SQLite is a development storage adapter. Account identity comes from verified auth, never request data.
export function createEncryptedStore(path) {
  const db = new DatabaseSync(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS vaults (owner TEXT PRIMARY KEY, envelope TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS encrypted_threads (owner TEXT NOT NULL, id TEXT NOT NULL, envelope TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY(owner,id));`);
  return {
    getVault(owner) { const row = db.prepare('SELECT envelope FROM vaults WHERE owner=?').get(owner); return row ? JSON.parse(row.envelope) : null; },
    createVault(owner, envelope) { return db.prepare('INSERT OR IGNORE INTO vaults VALUES (?, ?)').run(owner, JSON.stringify(envelope)).changes === 1; },
    list(owner) { return db.prepare('SELECT id, envelope, revision FROM encrypted_threads WHERE owner=?').all(owner).map((r) => ({ ...r, envelope: JSON.parse(r.envelope) })); },
    save(owner, id, envelope, revision) {
      if (revision === 0) return db.prepare('INSERT OR IGNORE INTO encrypted_threads VALUES (?, ?, ?, 1)').run(owner, id, JSON.stringify(envelope)).changes === 1;
      return db.prepare('UPDATE encrypted_threads SET envelope=?, revision=revision+1 WHERE owner=? AND id=? AND revision=?').run(JSON.stringify(envelope), owner, id, revision).changes === 1;
    },
    close() { db.close(); },
  };
}
