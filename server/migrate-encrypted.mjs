import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';

// Copy existing ciphertext only; no key or plaintext is needed. Never overwrite a different vault or record.
export async function migrateEncryptedSqlite({ path, accountId, target }) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const sourceVault = db.prepare('SELECT envelope FROM vaults WHERE owner = ?').get(accountId);
    if (!sourceVault) throw new Error('No encrypted vault for this account in the source database');
    const vault = JSON.parse(sourceVault.envelope);
    let remoteVault = await target.getVault(accountId);
    if (!remoteVault) {
      if (!(await target.createVault(accountId, vault))) throw new Error('Vault was created concurrently; retry');
      remoteVault = await target.getVault(accountId);
    }
    if (!isDeepStrictEqual(vault, remoteVault)) throw new Error('Target vault differs; nothing was overwritten');
    const records = db.prepare('SELECT id, envelope FROM encrypted_threads WHERE owner = ? ORDER BY id').all(accountId);
    let imported = 0;
    for (const source of records) {
      const envelope = JSON.parse(source.envelope);
      let existing = (await target.list(accountId)).find(row => row.id === source.id);
      if (!existing) {
        if (!(await target.save(accountId, source.id, envelope, 0))) throw new Error('Record was created concurrently; retry');
        imported++;
        existing = (await target.list(accountId)).find(row => row.id === source.id);
      }
      if (!existing || !isDeepStrictEqual(existing.envelope, envelope)) throw new Error('Target record differs or could not be verified; nothing was overwritten');
    }
    return { imported, verified: records.length };
  } finally { db.close(); }
}
