import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createEncryptedStore } from '../server/encrypted-store.mjs';
import { createEncryptedHandler } from '../server/encrypted-api.mjs';
import { createStore } from '../server/store.mjs';
import { migrateLegacy } from '../server/migrate-legacy.mjs';
import { createVault, encryptRecord, decryptRecord, unlockVault } from '../security/vault.mjs';

const rng = n => new Uint8Array(randomBytes(n));
test('authenticated encrypted API isolates accounts, rejects stale writes, and never stores message plaintext', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alorun-sec-')); const path = join(dir, 'cipher.sqlite');
  const store = createEncryptedStore(path);
  const server = createServer(createEncryptedHandler({ store, authenticate: async t => ({ tokenA: 'user-a', tokenB: 'user-b' })[t] ?? null, providers: { list: () => [{ provider: 'openai', model: 'test' }], get: (p, m) => p === 'openai' && m === 'test' ? { reply: async () => 'AI response', title: async () => 'Topic' } : null } }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(token, path, method = 'GET', body) { const res = await fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? {body: JSON.stringify(body)} : {}) }); return { status: res.status, json: await res.json() }; }
  try {
    const a = await createVault('user-a', 'test passphrase number one', rng);
    const b = await createVault('user-b', 'test passphrase number two', rng);
    assert.equal((await request('invalid', '/v1/vault')).status, 401);
    assert.equal((await request('tokenA', '/v1/vault', 'POST', a.wrappedKey)).status, 201);
    assert.equal((await request('tokenA', '/v1/vault', 'POST', b.wrappedKey)).status, 409);
    assert.equal((await request('tokenB', '/v1/vault', 'POST', b.wrappedKey)).status, 201);
    const id = '11111111-1111-4111-8111-111111111111';
    const content = 'synthetic secret message';
    const envelope = encryptRecord(a.key, 'user-a', 'thread', id, content, rng);
    assert.equal((await request('tokenA', `/v1/encrypted-threads/${id}`, 'PUT', { envelope, revision: 0 })).status, 200);
    assert.equal((await request('tokenA', `/v1/encrypted-threads/${id}`, 'PUT', { envelope, revision: 0 })).status, 409);
    assert.equal((await request('tokenB', `/v1/encrypted-threads/${id}`, 'PUT', { envelope, revision: 1 })).status, 409);
    assert.deepEqual((await request('tokenB', '/v1/encrypted-threads')).json.threads, []);
    const got = (await request('tokenA', '/v1/encrypted-threads')).json.threads[0];
    assert.equal(decryptRecord(a.key, 'user-a', 'thread', id, got.envelope), content);
    assert.equal((await request('tokenA', '/v1/chat/threads')).status, 404);
    const ai = await request('tokenA', '/v1/ai/reply', 'POST', { messages: [{ role: 'user', content }], title: 'New conversation', titleLocked: false, provider: 'openai', model: 'test' });
    assert.equal(ai.json.reply, 'AI response');
    assert.deepEqual((await request('tokenA', '/v1/ai/models')).json.models, [{ provider: 'openai', model: 'test' }]);
    const invalid = await request('tokenA', '/v1/ai/reply', 'POST', { messages: [{ role: 'user', content }], title: 'New conversation', titleLocked: false, provider: 'openai', model: 'unapproved' });
    assert.equal(invalid.status, 400);
    store.close();
    assert.equal(readFileSync(path).includes(Buffer.from(content)), false);
    assert.equal(readFileSync(path).includes(Buffer.from('AI response')), false);
    a.key.fill(0); b.key.fill(0);
  } finally { await new Promise(resolve => server.close(resolve)); rmSync(dir, { recursive:true, force:true }); }
});

test('synthetic legacy conversations migrate, decrypt on a second device, and remain intact at the source', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'alorun-import-'));
  const path = join(dir, 'old.sqlite'); const legacy = createStore(path);
  const first = legacy.create(); const second = legacy.create();
  legacy.appendTurn(first.id, 'Synthetic private message', 'Synthetic response', 'Synthetic title');
  legacy.appendTurn(second.id, 'Another topic', 'Another response', 'Second title');
  legacy.close();
  const encrypted = createEncryptedStore(join(dir, 'new.sqlite'));
  const { key, wrappedKey } = await createVault('user-a', 'synthetic migration passphrase', rng);
  const input = { path, accountId: 'user-a', key, list: async () => encrypted.list('user-a'), save: async (id, envelope) => { assert.equal(encrypted.save('user-a', id, envelope, 0), true); } };
  try {
    assert.deepEqual(await migrateLegacy(input), { imported: 2, verified: 2 });
    assert.deepEqual(await migrateLegacy(input), { imported: 0, verified: 2 });
    const otherDeviceKey = await unlockVault('user-a', 'synthetic migration passphrase', wrappedKey);
    const copy = encrypted.list('user-a').find(item => item.id === first.id);
    const decoded = JSON.parse(decryptRecord(otherDeviceKey, 'user-a', 'thread', first.id, copy.envelope));
    assert.equal(decoded.messages[0].content, 'Synthetic private message');
    const source = createStore(path); assert.equal(source.get(first.id).messages[0].content, 'Synthetic private message');
    source.rename(first.id, 'Changed after import'); source.close();
    await assert.rejects(migrateLegacy(input), /differs/);
    const unchanged = JSON.parse(decryptRecord(otherDeviceKey, 'user-a', 'thread', first.id, encrypted.list('user-a').find(item => item.id === first.id).envelope));
    assert.equal(unchanged.title, 'Synthetic title');
    otherDeviceKey.fill(0);
  } finally { key.fill(0); encrypted.close(); rmSync(dir, {recursive:true, force:true}); }
});

test('encrypted SQLite migration preserves ciphertext and refuses conflicting target vaults', async () => {
  const { migrateEncryptedSqlite } = await import('../server/migrate-encrypted.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'alorun-cipher-move-'));
  const path = join(dir, 'source.sqlite');
  const source = createEncryptedStore(path); const target = createEncryptedStore(join(dir, 'target.sqlite'));
  const { key, wrappedKey } = await createVault('user-a', 'synthetic encrypted migration passphrase', rng);
  const id = '11111111-1111-4111-8111-111111111111';
  try {
    source.createVault('user-a', wrappedKey);
    const envelope = encryptRecord(key, 'user-a', 'thread', id, 'synthetic', rng);
    source.save('user-a', id, envelope, 0);
    assert.deepEqual(await migrateEncryptedSqlite({ path, accountId: 'user-a', target }), { imported: 1, verified: 1 });
    assert.deepEqual(await migrateEncryptedSqlite({ path, accountId: 'user-a', target }), { imported: 0, verified: 1 });
    assert.deepEqual(target.list('user-a')[0].envelope, envelope);
    await assert.rejects(migrateEncryptedSqlite({ path, accountId: 'user-b', target }));
    const conflict = createEncryptedStore(':memory:');
    try {
      conflict.createVault('user-a', { ...wrappedKey, salt: '0'.repeat(32) });
      await assert.rejects(migrateEncryptedSqlite({ path, accountId: 'user-a', target: conflict }), /vault differs/);
      assert.deepEqual(conflict.list('user-a'), []);
    } finally { conflict.close(); }
  } finally { key.fill(0); source.close(); target.close(); rmSync(dir, { recursive: true, force: true }); }
});
