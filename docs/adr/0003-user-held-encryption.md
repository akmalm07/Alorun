# ADR 0003: User-held encryption for account data

Status: development implementation; requires independent security review before release. See the security review for implemented scope and remaining blockers.

## Context

When this decision was proposed, the development chat server used a shared token and stored conversations in plaintext in SQLite, without accounts or per-user access control. The AI server receives plaintext conversations for processing. Encrypting only the server's SQLite file or storing a decryption key beside it would not satisfy the requirement that each user controls access to their own data.

The user chose a separate encryption passphrase for access on additional devices and approved temporary plaintext processing by the application server and AI provider to generate replies and titles. This is encryption of stored data under a user-held key, not end-to-end secrecy from the server or provider during an AI request. TLS is required on every network path. The provider's processing and retention policy must be disclosed before use.

## Proposed design

1. Establish authenticated accounts using the existing planned Supabase authentication and enforce account ownership on every API operation, with PostgreSQL RLS as defense in depth. Do not accept a user ID from the client as proof of ownership. Authenticate transport before distributing encrypted records.
2. On a device, generate a cryptographically random account data-encryption key (DEK). Encrypt each sensitive record with a standard, independently reviewed authenticated-encryption implementation, using a fresh random nonce and associated data binding the ciphertext to its account, record type, record ID, and format version. Persist only the versioned ciphertext envelope and the minimum metadata needed for operation. Cover titles and messages as well as other user-created fields; explicitly inventory fields that cannot be encrypted without breaking queries, indexes, reminders or other features. Do not claim all user data is encrypted until that inventory is addressed.
3. Derive a key-encryption key from the user's separate passphrase using a memory-hard password KDF with a unique, cryptographically random per-account salt and recorded, versioned parameters. Wrap the random DEK using authenticated encryption and upload only the wrapped key, salt, parameters, and format version to the account-scoped service. A salt is public; it is not a key. Select KDF parameters after measuring on supported low-end devices and reviewing current guidance. Never send the passphrase or unwrapped DEK to the server.
4. On another authenticated device, retrieve the wrapped key and unlock it locally using the passphrase. Cache only as appropriate in the platform's secure key storage, with explicit lock, device removal and logout semantics. Verify supported Expo and Android versions and backup/restore behavior; do not assume platform secure storage syncs between devices. A new device must enter the passphrase. A changed passphrase rewraps the DEK with a new salt; key rotation also requires authenticated re-encryption of records and a crash-safe resume strategy.
5. The client decrypts the bounded conversation context locally for a user-initiated AI request. The server may temporarily process and forward that context to the provider; it must not persist or log plaintext prompts, responses, titles, or keys. The client encrypts the resulting messages and titles before saving them. Data already disclosed to the provider is subject to that provider's policy. Ordinary storage endpoints accept ciphertext, not plaintext.
6. Loss of the encryption passphrase means data encrypted by its key cannot be recovered by the service unless a separate recovery mechanism is explicitly added. Account password reset must not silently reset the encryption passphrase or destroy existing encrypted data. Communicate this during setup and before changes. Do not implement an undisclosed server escrow or backdoor.

## Migration and rollout

The existing SQLite development store has no verified user identity and cannot safely be assigned to an account automatically. Leave it unchanged. Provide an explicit, local-only export/import flow after sign-in and passphrase setup: decrypt or read the legacy local data on the user's device, encrypt it there, import it into that user's account, verify record counts and decryptability, and retain the original until the user deliberately removes it. The server-hosted development SQLite file must first be transferred securely to the user's trusted device; do not expose it via the shared-token API. Require a verified backup and a tested rollback before migrating any real data. Never run a production migration as part of application startup.

The existing PostgreSQL baseline also contains plaintext fields and indexes used for operational queries. Each data type requires a reviewed versioned migration, compatibility strategy, consent and retention behavior, and query redesign. Ciphertext length, timestamps, record counts, relationships, and other operational metadata may remain observable and must be documented. Avoid any claim that the system is zero-knowledge until all relevant paths and metadata are assessed.

## Alternatives

- Server-managed database encryption: easier recovery and server-side queries, but the service can decrypt records and it does not meet user-held key requirements.
- Send the passphrase or DEK to the server: simpler integration with the existing chat flow, but exposes the user's key and defeats the requested trust boundary.
- Device-only keys: straightforward local protection, but do not provide access from a new device.
- Account password as the sole encryption passphrase: couples authentication reset to data recovery and may expose the encryption secret to an identity provider; a separate passphrase matches the user's choice.

## Verification and release gates

- Independent security review of cryptographic design, chosen libraries, KDF costs, nonce generation, key lifecycle, error handling, account recovery, and device storage.
- Test correct and incorrect passphrases; ciphertext, nonce and associated-data tampering; unique nonces; cross-account substitution; multiple devices; passphrase change; loss and reset behavior; interrupted migration and rotation; and no plaintext or secrets in storage, logs, crash reports, or analytics.
- Test tenant isolation on every account and key endpoint, RLS, token expiry, device logout, and requests with guessed IDs. Verify encrypted backup and restore, data deletion, and export flows.
- Exercise AI chat and title generation while inspecting storage and logs; verify the server and provider receive only the bounded context necessary for an explicitly initiated request.
- Run on supported Android devices and assess KDF latency and memory. Verify transport security and review the provider's retention settings before release.

## Consequences

The development chat uses authenticated, account-scoped Supabase ciphertext storage and requires a separate encryption passphrase. It does not automatically protect or delete the existing plaintext development database, and the remaining data model, key lifecycle, search, scheduling, infrastructure and independent review are not complete.

## Development implementation status

`security/vault.mjs` is connected to the chat client and the authenticated server stores encrypted chat records in Supabase PostgreSQL through user-scoped row-level security. A local import tool can read the original database, encrypt and verify copies, and leave the source untouched. The implementation uses XChaCha20-Poly1305, a random 256-bit data key, per-account random salt and scrypt (N=131072, r=8, p=1). The mobile client provides randomness using Expo Crypto. Android/Hermes behavior and KDF cost remain unverified on devices. The account key is kept in app memory while unlocked rather than stored on the device. No real data, Supabase database, or Cloud Run deployment has been migrated or deployed. See [the security review](../security/encrypted-chat-review.md) for limitations, evidence, and release blockers.
