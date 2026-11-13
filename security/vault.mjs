import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { scryptAsync } from '@noble/hashes/scrypt.js';
import { z } from 'zod';

// Version 1 is intentionally fixed, so untrusted stored data cannot alter KDF cost.
const VERSION = 1;
const KDF = Object.freeze({ N: 131072, r: 8, p: 1, dkLen: 32 });
const hex = (n) => z.string().regex(new RegExp(`^[0-9a-f]{${n * 2}}$`));
const wrappedSchema = z.object({ version: z.literal(VERSION), salt: hex(16), nonce: hex(24), ciphertext: hex(48) }).strict();
const recordSchema = z.object({ version: z.literal(VERSION), nonce: hex(24), ciphertext: z.string().regex(/^(?:[0-9a-f]{2}){16,}$/).max(2_000_032) }).strict();
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
function toHex(bytes) { return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''); }
function fromHex(text) { return Uint8Array.from(text.match(/../g) ?? [], (part) => parseInt(part, 16)); }
function context(...parts) { return encoder.encode(JSON.stringify(['alorun-vault', VERSION, ...parts])); }
function checkId(id) { if (typeof id !== 'string' || !id || id.length > 200) throw new Error('Invalid identity'); }
function random(randomBytes, length) {
  const value = randomBytes(length);
  if (!(value instanceof Uint8Array) || value.length !== length) throw new Error('Secure random source required');
  return value;
}
function checkKey(key) { if (!(key instanceof Uint8Array) || key.length !== 32) throw new Error('Invalid key'); }
function checkPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < 12 || encoder.encode(passphrase).length > 1024) throw new Error('Passphrase must be at least 12 characters and at most 1024 bytes');
}

// The caller must supply bytes from the platform CSPRNG, never Math.random.
export async function createVault(accountId, passphrase, randomBytes) {
  checkId(accountId); checkPassphrase(passphrase);
  const key = random(randomBytes, 32);
  try { return { key, wrappedKey: await wrapKey(accountId, passphrase, key, randomBytes) }; }
  catch (error) { key.fill(0); throw error; }
}
export async function wrapKey(accountId, passphrase, key, randomBytes) {
  checkId(accountId); checkPassphrase(passphrase); checkKey(key);
  const salt = random(randomBytes, 16); const nonce = random(randomBytes, 24);
  const wrappingKey = await scryptAsync(encoder.encode(passphrase), salt, KDF);
  try {
    return { version: VERSION, salt: toHex(salt), nonce: toHex(nonce), ciphertext: toHex(xchacha20poly1305(wrappingKey, nonce, context('key', accountId)).encrypt(key)) };
  } finally { wrappingKey.fill(0); }
}
export async function unlockVault(accountId, passphrase, input) {
  checkId(accountId); checkPassphrase(passphrase);
  const wrapped = wrappedSchema.parse(input);
  const wrappingKey = await scryptAsync(encoder.encode(passphrase), fromHex(wrapped.salt), KDF);
  try { return xchacha20poly1305(wrappingKey, fromHex(wrapped.nonce), context('key', accountId)).decrypt(fromHex(wrapped.ciphertext)); }
  finally { wrappingKey.fill(0); }
}
export function encryptRecord(key, accountId, type, recordId, plaintext, randomBytes) {
  checkKey(key); [accountId, type, recordId].forEach(checkId);
  if (typeof plaintext !== 'string' || encoder.encode(plaintext).length > 1_000_000) throw new Error('Invalid plaintext');
  const nonce = random(randomBytes, 24);
  return { version: VERSION, nonce: toHex(nonce), ciphertext: toHex(xchacha20poly1305(key, nonce, context('record', accountId, type, recordId)).encrypt(encoder.encode(plaintext))) };
}
export function decryptRecord(key, accountId, type, recordId, input) {
  checkKey(key); [accountId, type, recordId].forEach(checkId);
  const envelope = recordSchema.parse(input);
  return decoder.decode(xchacha20poly1305(key, fromHex(envelope.nonce), context('record', accountId, type, recordId)).decrypt(fromHex(envelope.ciphertext)));
}
