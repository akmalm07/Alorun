import { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { decryptRecord, encryptRecord } from '../security/vault.mjs';

// Caller authenticates, unlocks locally, and supplies an account-scoped encrypted API.
export async function migrateLegacy({ path, accountId, key, list, save }) {
  const source = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = source.prepare('SELECT id, title, title_locked FROM conversations ORDER BY rowid').all();
    const current = new Map((await list()).map((item) => [item.id, item]));
    let imported = 0; let verified = 0;
    for (const row of rows) {
      const messages = source.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id').all(row.id).map(m => ({ role: m.role, content: m.content }));
      const data = JSON.stringify({ title: row.title, titleLocked: Boolean(row.title_locked), messages });
      const existing = current.get(row.id);
      if (existing) {
        if (decryptRecord(key, accountId, 'thread', row.id, existing.envelope) !== data) throw new Error('Existing encrypted conversation differs; no data was overwritten.');
      } else {
        const envelope = encryptRecord(key, accountId, 'thread', row.id, data, (n) => new Uint8Array(randomBytes(n)));
        await save(row.id, envelope);
        imported++;
      }
      const uploaded = (await list()).find(item => item.id === row.id);
      if (!uploaded || decryptRecord(key, accountId, 'thread', row.id, uploaded.envelope) !== data) throw new Error('Encrypted copy could not be verified. Original data is unchanged.');
      verified++;
    }
    return { imported, verified };
  } finally { source.close(); }
}
