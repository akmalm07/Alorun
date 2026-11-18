# Companion thread metadata and guided settings

## Context

Companion saved only the latest conversation, while the separate user-held encrypted vault already offered nested branches. The requested sidebar needs titles, branch provenance and user-authoritative pin choices without creating a competing transcript store or retaining conversations without consent.

## Decision

Reuse `chat_threads` and encrypted `chat_messages`. Store a version-recognizable `protected:` encrypted metadata envelope in the existing `title` text field, bound by existing AES-GCM associated data to owner and thread ID. Metadata contains title, parent ID, a bounded fixed snapshot, manual pin choice, automatic goal-link importance and last activity. Legacy plain titles remain readable; no bulk rewrite or schema migration. A future schema change can move this envelope to a dedicated column without re-encrypting messages.

Companion forks call the existing `chat/branches.mjs` `makeBranch`: only the direct parent's own last 20 turns are copied. Retrieval sends a bounded combined context. For a saved child's first write, the backend checks ownership and that the proposed snapshot is a contiguous sequence of its parent's own recent saved messages. It refuses forged context, cycles through new IDs, and foreign parent links. Parent linkage/snapshot become immutable after creation.

Pins use `manualPin = pinned | unpinned | null` plus `autoPin`. Automatic importance is goal-linked planning, not an inferred personal trait. Server saves preserve manual choice under the same per-user advisory lock. Thread listings and history reads use the consent lock, scope by JWT owner, and omit snapshots from sidebar summaries.

Settings chat uses a deterministic catalogue to select up to three relevant controls. No model, new processor or autonomous settings tool is introduced. Requests are local and temporary; explicit control interactions reuse existing authenticated settings APIs.

## Options and risks

- No change leaves Companion without the requested sidebar/branch flow.
- A new parallel transcript database would duplicate consent, encryption and account semantics.
- New metadata columns would be cleaner long-term but require a schema rollout; the existing text field supports a reversible, bounded extension now.

Old backend builds cannot render protected titles as plain text. Deploy compatible API and app together. Keep the backend encryption key stable and backed up; losing it makes saved histories and metadata unreadable. The client holds temporary conversations only during a mounted session. Listings currently cover the newest 100 created threads and history the latest 60 entries. A branch first saved after its parent advances beyond that validation window must be created again; rejection is safe and user-visible.

## Rollback and verification

No historical migrations are changed. Roll back UI independently only to an API-compatible client. To roll back metadata interpretation, retain this decoder or export/decrypt titles with the existing key; do not expose raw envelopes to users or drop saved data. No backfill is required for legacy titles. Unit/contract tests, real development API checks, tenant denial checks, independent review and emulator checks are recorded in the task report. No production rollout is implied.
