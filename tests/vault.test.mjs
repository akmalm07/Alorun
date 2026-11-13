import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createVault, unlockVault, wrapKey, encryptRecord, decryptRecord } from '../security/vault.mjs';

const rng = (length) => new Uint8Array(randomBytes(length));
const phrase = 'a test passphrase for devices';
const flip = (hex) => (hex[0] === '0' ? '1' : '0') + hex.slice(1);

test('user-controlled encryption resists theft, tampering, and substitution', async () => {
  const { key, wrappedKey } = await createVault('user-a', phrase, rng);
  const restored = await unlockVault('user-a', phrase, wrappedKey);
  assert.deepEqual(restored, key, 'another device can unwrap the same key');
  await assert.rejects(unlockVault('user-a', 'a wrong test passphrase', wrappedKey));
  await assert.rejects(unlockVault('user-b', phrase, wrappedKey));
  await assert.rejects(unlockVault('user-a', phrase, { ...wrappedKey, ciphertext: flip(wrappedKey.ciphertext) }));
  await assert.rejects(unlockVault('user-a', phrase, { ...wrappedKey, nonce: flip(wrappedKey.nonce) }));
  await assert.rejects(unlockVault('user-a', phrase, { ...wrappedKey, salt: flip(wrappedKey.salt) }));
  await assert.rejects(unlockVault('user-a', phrase, { ...wrappedKey, N: 1 }));
  const data = 'Private test conversation: 🐈';
  const encrypted = encryptRecord(key, 'user-a', 'message', 'record-1', data, rng);
  const second = encryptRecord(key, 'user-a', 'message', 'record-1', data, rng);
  assert.notEqual(encrypted.nonce, second.nonce);
  assert.notEqual(encrypted.ciphertext, second.ciphertext);
  assert.ok(!JSON.stringify(encrypted).includes(data));
  assert.equal(decryptRecord(restored, 'user-a', 'message', 'record-1', encrypted), data);
  assert.throws(() => decryptRecord(rng(32), 'user-a', 'message', 'record-1', encrypted));
  assert.throws(() => decryptRecord(key, 'user-b', 'message', 'record-1', encrypted));
  assert.throws(() => decryptRecord(key, 'user-a', 'title', 'record-1', encrypted));
  assert.throws(() => decryptRecord(key, 'user-a', 'message', 'record-2', encrypted));
  assert.throws(() => decryptRecord(key, 'user-a', 'message', 'record-1', { ...encrypted, nonce: flip(encrypted.nonce) }));
  assert.throws(() => decryptRecord(key, 'user-a', 'message', 'record-1', { ...encrypted, ciphertext: flip(encrypted.ciphertext) }));
  assert.throws(() => decryptRecord(key, 'user-a', 'message', 'record-1', { ...encrypted, version: 2 }));
  assert.equal(decryptRecord(key, 'user-a', 'message', 'record-1', encrypted), data, 'attack attempts do not alter original data');
  const rewrapped = await wrapKey('user-a', 'a new passphrase for devices', key, rng);
  assert.notEqual(rewrapped.salt, wrappedKey.salt);
  assert.deepEqual(await unlockVault('user-a', 'a new passphrase for devices', rewrapped), key);
  key.fill(0); restored.fill(0);
});
