import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { chmodSync } from 'node:fs';

// This single-user development store is not a substitute for tenant-scoped production storage.
export function createStore(path) {
  const db = new DatabaseSync(path);
  if (path !== ':memory:') chmodSync(path, 0o600);
  db.exec(`PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, title_locked INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), role TEXT NOT NULL, content TEXT NOT NULL);
    PRAGMA foreign_keys = ON;`);
  const get = (id) => {
    const row = db.prepare('SELECT id, title, title_locked AS titleLocked, updated_at AS updatedAt FROM conversations WHERE id = ?').get(id);
    if (!row) return null;
    return { ...row, titleLocked: Boolean(row.titleLocked), messages: db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id').all(id) };
  };
  return {
    create() { const id = randomUUID(); db.prepare('INSERT INTO conversations VALUES (?, ?, 0, ?)').run(id, 'New conversation', new Date().toISOString()); return get(id); },
    list() { return db.prepare('SELECT id, title, updated_at AS updatedAt FROM conversations ORDER BY updated_at DESC, rowid DESC').all(); },
    get,
    rename(id, title) { db.prepare('UPDATE conversations SET title = ?, title_locked = 1, updated_at = ? WHERE id = ?').run(title, new Date().toISOString(), id); return get(id); },
    appendTurn(id, user, assistant, title) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const insert = db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)');
        insert.run(id, 'user', user); insert.run(id, 'assistant', assistant);
        db.prepare('UPDATE conversations SET title = CASE WHEN title_locked = 0 AND ? IS NOT NULL THEN ? ELSE title END, updated_at = ? WHERE id = ?').run(title, title, new Date().toISOString(), id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      return get(id);
    },
    close() { db.close(); },
  };
}
