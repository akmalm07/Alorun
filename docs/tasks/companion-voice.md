# Companion conversation, dictation, and voice transcripts

User request: explain the execution layer, add voice-to-text input and a voice conversation whose transcript appears in chat after ending. Preserve the existing goal/task/calendar/check-in work.

Slice: grounded conversational replies using owned goals/tasks and bounded recent conversation; explicit Listen/Think/Plan modes; editable dictation; turn-based voice chat with native spoken replies; merge user/assistant turns into text chat on End voice chat. Separate optional encrypted transcript history from persistent memory; history is off by default and never stores raw audio. Keep all task/calendar writes on existing proposal/approval routes.

Acceptance: transcription failure does not send a fabricated message; dictation is editable before send; both voice participants appear exactly once when ended; ending/backgrounding stops microphone/speech and late responses cannot reopen a session; missing permission leaves text chat usable; history consent checked at writes and reads, tenant IDs cannot disclose transcripts; provider actions are schema-validated suggestions and cannot mutate tasks; retries are bounded by the shared quota. No production deployment, provider credentials, or real-user data required for verification.

## Delivered

- Companion route linked from Today, grounded Listen/Think/Plan replies, editable speech-to-text drafts, native spoken turn-based voice chat, explicit stop/cancel/end, and both participants merged into text chat after ending. Hardware Back finalizes known voice entries before leaving.
- Validated owned-goal plan affordances reuse existing plan approval instead of exposing action tools. Execution-layer architecture is documented in docs/execution-layer.md; general action registry/runner remains proposed.
- Separate optional encrypted chat-history persistence using existing tables. AES-256-GCM binds owner/thread/message; opt-out suppresses reads/writes, queued requests pin account identity, and clear/consent versions fence stale saves. No raw audio, automatic graph memory, new calendar integration, or new processor.
- Existing native design tokens preserved; code-derived design documentation extended for Companion. No native screenshot or visual approval claim.

## Files changed in this slice

- api/chat-service.ts, chat-controller.ts, chat-crypto.ts — conversations, transcription, encrypted/history consent and clearing.
- api/provider.ts, config.ts, main.ts, service.ts — provider contract, optional encryption config, wiring/body limit, shared quota boundary.
- src/mobile/Companion.tsx, useCompanion.ts, useVoiceCapture.ts, client.ts, Today.tsx, app/companion.tsx — native conversation, audio lifecycle, transcript merge, owner pinning and navigation.
- src/shared/contracts.ts, src/domain/conversation.ts — validated conversation contracts, bounded context, deduplicated merge and dictation overflow handling.
- tests/api.test.ts, domain.test.ts, fixtures.ts — fictional API/provider fixtures, real database integration, encryption/contracts/lifecycle-domain invariants.
- README.md, .env.example, SPEC.md, ADR 0004, docs/execution-layer.md, DESIGN.md and .impeccable/design.json — setup, product scope, architecture and code-derived native patterns.
- package.json/pnpm-lock.yaml — SDK-compatible expo-speech and targeted formatting scope.

## Verification

- `pnpm lint` — PASS.
- `pnpm typecheck` — PASS.
- `pnpm api:build` — PASS.
- `pnpm format:check` — PASS.
- `TEST_DATABASE_URL=<fresh disposable alorun_test> pnpm test` — PASS, 36 tests, 0 failures/skips. Includes existing goal/task regressions and new chat context ownership, no direct task actions, valid bounded M4A multipart transcription with fixture provider, absent speech, consent defaults, encrypted ordered/idempotent voice transcript, tenant/thread/message isolation, wrong-key failure, opt-out, scoped clear, maximum 240 KB JSON transcript, 72 stored entries, and stale-save-after-clear rejection. Domain tests cover transcript deduplication, bounded context, authenticated encryption/tampering, request validation and dictation overflow.
- `pnpm db:generate` — PASS, no new migration/schema drift.
- `EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 pnpm exec expo export --platform android --output-dir /tmp/alorun-chat-android --max-workers 2` — PASS, Android Hermes bundle with 1,382 modules. Not an APK or native-device run.
- Production API bootstrap with synthetic configuration — PASS: health 200; unauthenticated Today/chat 401; no provider calls.
- `git diff --check` — PASS.
- Independent review — original dictation length/body-size/long-session/speech lifecycle findings resolved; queued-save resurrection additionally fixed with a server history-version fence and scored resolved by reviewer. Review was by inspection; no native/live-provider verdict implied.

## Limitations and deployment

No actual OpenAI, Supabase email delivery, or Android microphone/TTS run was performed; credentials/device are unavailable. The API/DB tests use fictional data and fixture model/auth providers. A configured Android device must verify capture permission/auto-stop/interruption, playback, End/cancel while awaiting requests, hardware Back, account switching, and transcript history as listed in README. Voice chat uses explicit turns, not continuous real-time streaming; transcription is not cross-language translation. Saving requires a server key and explicit user consent. The default daily development quota is 3 provider requests; extended voice testing needs an intentional quota configuration change. No production deployment or migration was performed. Existing goal-planning changes remain intact.

Follow-up: configure providers and optional encryption, rebuild/run Android, complete native/live-model acceptance, then implement the first typed execution action beyond existing plan approval.
