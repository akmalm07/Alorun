export type WrappedKey = { version: 1; salt: string; nonce: string; ciphertext: string };
export type Envelope = { version: 1; nonce: string; ciphertext: string };
export function createVault(accountId: string, passphrase: string, randomBytes: (length: number) => Uint8Array): Promise<{key: Uint8Array; wrappedKey: WrappedKey}>;
export function unlockVault(accountId: string, passphrase: string, input: unknown): Promise<Uint8Array>;
export function encryptRecord(key: Uint8Array, accountId: string, type: string, recordId: string, plaintext: string, randomBytes: (length: number) => Uint8Array): Envelope;
export function decryptRecord(key: Uint8Array, accountId: string, type: string, recordId: string, input: unknown): string;
