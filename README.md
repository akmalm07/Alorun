# Alorun

An Expo Android app with goal planning, voice Companion chat, encrypted chat branches, and scheduled Missions.

## Run on a Pixel

1. Install Node.js and pnpm 11, then run `pnpm install` in this directory.
2. Install Expo Go from Google Play on your Pixel.
3. Connect your computer and phone to the same Wi-Fi network and run `pnpm start`.
4. Scan the QR code with your phone's camera and open the link in Expo Go. If LAN access fails, try `pnpm exec expo start --tunnel` (this may require Expo's tunnel package and network access).

Expo Go runs the app directly on your phone; it is not an Android emulator. Its installed version must support the app's Expo SDK.

## Run in an Android emulator

Install Android Studio, the Android SDK and an Android Virtual Device through Device Manager. Start the virtual device, then run `pnpm android`. An emulator runs on the computer, not on the Pixel.

## Database schema

Drizzle models live in `db/schema.ts`; checked-in migrations are in `drizzle/`. Copy `.env.example` to a secure local environment file and export the Supabase transaction pooler URL as `DATABASE_URL` and session pooler URL as `DIRECT_URL`. Never commit credentials. Run `pnpm db:generate` to generate a reviewed migration and `pnpm db:migrate` to apply it with the session connection.

The current schema declares a 1536-dimension embedding vector while the migration history records an unspecified-dimension vector. `pnpm db:generate` may therefore propose a separate `ALTER COLUMN` for embeddings. Do not apply that generated change without a reviewed data and extension compatibility plan.

The initial migration assumes a clean Supabase project, `auth.users`, and pgvector in the `extensions` schema. It enables deny-by-default RLS and includes SQL-only features, including the external auth foreign key and full-text index. Never use `drizzle-kit push`; review generated migrations against those features. Test on staging, review existing objects and extension placement, and verify backups before production. See [ADR 0002](docs/adr/0002-drizzle.md).

Do not run the Drizzle baseline on a database where the old Prisma migration was already applied: the migration histories are separate. An existing database needs a reviewed baseline/adoption procedure before Drizzle migrations are used.

To validate on a disposable PostgreSQL instance with pgvector, create a stub `auth.users(id uuid primary key)`, run the initial SQL migration in `drizzle/`, then run `tests/schema.sql` with `psql -v ON_ERROR_STOP=1`. Use fictional data only.

## Encrypted chat development preview

The chat app signs in to an existing Supabase account and uses a **separate encryption passphrase** to create or unlock an account key. The same account and passphrase unlock the encrypted conversations on another device connected to the same chat server. If the passphrase is lost, the stored data cannot be recovered. It is not the account password, and resetting the account password does not reset it.

Conversation titles and messages are encrypted on the client before storage. Supabase PostgreSQL stores ciphertext and a wrapped account key, scoped by the user’s verified Supabase identity and row-level security; account IDs, conversation IDs, revisions, record sizes, and access patterns remain visible. Only the latest bounded conversation context is sent in plaintext over HTTPS to the server and the selected AI provider for a reply and title. The server does not intentionally persist the AI payload. The selected provider's retention policies apply. The passphrase and unlocked key remain in application memory while unlocked and are not saved in secure device storage; lock or sign out to clear the app's references.

This is a development implementation, **not ready for production**. It requires an independent security review, a real multi-device Android test, reviewed HTTPS infrastructure, account recovery and deletion flows, protected backups, abuse controls and durable per-user quotas. Cloud Run and Supabase must be configured before use. No existing production database was migrated. See [the security review](docs/security/encrypted-chat-review.md).

1. Configure an existing Supabase project and test account. Review and apply the checked-in migrations to a staging database first, using the migration history requirements above. Migration `0001_shiny_aaron_stack.sql` adds encrypted vault and thread tables, account ownership policies and access grants. It references `auth.users`; it does not migrate SQLite data.
2. Configure Cloud Run using [the Terraform deployment guide](infra/terraform/README.md). The server verifies each Supabase access token, and uses that same token to access Supabase PostgreSQL through its REST API so row-level policies apply. Set only the Supabase publishable/anon key, never the service-role key.
3. Set `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, and the HTTPS Cloud Run URL as `EXPO_PUBLIC_CHAT_API_URL`, then start Expo. Sign in and create a separate encryption passphrase. On another device, sign into the same account and enter that passphrase. The app requires sign-in and unlock again after restart or session expiry. For local server testing, set the server environment variables in `.env.example` and run `CHAT_HOST=127.0.0.1 pnpm chat:server`; the mobile client requires an HTTPS endpoint.

The previous plaintext `chat-dev.sqlite` is not used by the new chat API and is never automatically deleted or assigned to an account. To import it, first create and unlock a vault in the app. On the trusted computer holding the old SQLite file, export `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and HTTPS `CHAT_API_URL`, then run the following in an interactive terminal. Passwords are entered without terminal echo and passed to the import process over stdin, not command-line arguments:

```sh
python3 -c 'import getpass,json,subprocess,sys; e=input("Account email: "); p=getpass.getpass("Account password: "); v=getpass.getpass("Encryption passphrase: "); sys.exit(subprocess.run(["node","server/migrate-cli.mjs","chat-dev.sqlite"],input=json.dumps({"email":e,"password":p,"passphrase":v}),text=True).returncode)'
```

The import preserves the source and verifies each encrypted copy. A repeated import checks matching records and refuses to overwrite conflicting data. Back up the source securely before import. Remove plaintext files and backups only after separately verifying the encrypted data and following your retention requirements.

The earlier encrypted SQLite store (`chat-encrypted.sqlite`) is also not migrated automatically. After the Supabase migration, a user can copy their existing encrypted vault and ciphertext to Supabase from the trusted machine holding that file. The import does not require the encryption passphrase and refuses to overwrite a different vault or conflicting thread. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY`, then run:

```sh
python3 -c 'import getpass,json,subprocess,sys; e=input("Account email: "); p=getpass.getpass("Account password: "); sys.exit(subprocess.run(["node","server/migrate-encrypted-cli.mjs","chat-encrypted.sqlite"],input=json.dumps({"email":e,"password":p}),text=True).returncode)'
```

Both import commands preserve the original database. Back up the source and verify sign-in, unlock and conversation contents before removing any old files.

The model selector displays the OpenAI and Anthropic models configured by the server. `OPENAI_MODELS` and `ANTHROPIC_MODELS` are comma-separated allowlists; configure each provider's key and list together. Only listed combinations can be requested. The selection applies to the current session and can be changed before sending a message. Model availability and cost depend on the provider account; choose and verify model IDs before configuration.

## Conversation branches

Select a chat and choose **+ Branch** to create a nested conversation. The orange conversation tree shows branches indented beneath their parent; select any item to return to it. A branch includes a snapshot of up to 20 messages from its immediate parent's own conversation at the time it was created, plus its own messages, with the combined AI context limited to the latest 20. It does not include siblings or earlier ancestors. Later messages in the parent do not change the snapshot. Titles, messages, parent links, and snapshots remain inside the encrypted conversation record.

**Auto-branch** is optional and off by default. When enabled, a separate AI request checks whether a new message deserves a child branch before the reply is generated. If the check fails, the app continues in the current conversation and shows a notice. **Find a branch** on a main conversation asks the selected provider to match your description against the titles and short message excerpts in that conversation tree; the app asks you to open the result. Search descriptions, candidate titles and short excerpts are sent to the selected provider, and automatic classification sends recent messages from the current branch. These AI steps add provider calls and cost. No embeddings or persistent memory are created. The current search is limited to 100 conversations per tree.


## Goal planning, voice companion and Missions

## Goal planning and voice check-ins

1. Install dependencies with `pnpm install`. Copy `.env.example` to `.env` and fill in the server and public app configuration. Model names and current prices are explicit configuration; no AI secrets belong in `EXPO_PUBLIC_*` values.
2. Use a clean staging Supabase database with the reviewed Drizzle migrations applied, including `0001_exotic_venom.sql`. Existing deployments must follow the baseline/adoption caveat above. The new migration only adds check-in preferences/events; it does not modify existing task data. No migration is applied automatically on API startup.
3. Configure Supabase email authentication. Both the **Magic Link** and **Confirm signup** email templates must display `{{ .Token }}`: this app accepts email OTP codes rather than requiring deep-link callbacks. Leave normal Supabase email rate limits enabled.
4. Run `pnpm api:build`, then `pnpm api:start` in a separate terminal. `pnpm api:start` reads `.env`. Run `pnpm start` for the app. A physical phone needs a reachable API host, not the computer's `localhost`; use HTTPS for deployed builds. The API exposes `/health` and authenticated `/v1/*` routes.
5. Sign in, share a goal, select **Plan this goal with AI**, and supply explicit local date/time slots. Review task titles, steps, durations, and the schedule preview. Approval saves the tasks and displays them on Today and the calendar. Edits are rescheduled and checked for conflicts server-side. Discarding a proposal creates no tasks.
6. Turn on **Voice goal check-ins** to opt in. On launch or foreground, a goal question appears only if a linked pending task is overdue **or** a prior check-in was explicitly skipped. There is one prompt per rolling 24 hours across all goals. Being overdue does not create a stored claim about the user's motivation. **Not now** skips the question without blocking the app; the switch disables future questions.
7. Tap **Record answer**, grant microphone access, stop, then explicitly send the clip. Answers accept native M4A audio, not typed text. Native capture stops at 60 seconds; the server validates container duration (up to 61 seconds for encoder padding) and a 2 MiB upload bound. Backgrounding discards the capture. Audio is sent to OpenAI for transcription; Alorun persists only question state/timestamps, not recordings, transcripts, or memory inferences. The provider's own retention is governed by the OpenAI account configuration. A voice answer does not complete a task.

`expo-audio`, `expo-secure-store`, `expo-crypto`, and `expo-file-system` are pinned to the installed Expo SDK's compatibility map. Rebuild a native development app after adding these modules or changing microphone configuration. This flow targets Android; browser voice capture is not supported by the M4A upload endpoint.

The server caps **all AI attempts**, including plan generation, questions, transcription, and failed provider calls, using `AI_DAILY_REQUEST_LIMIT` (default 3 per UTC day). It makes no automatic provider retries and records token usage and estimated costs. This internal development limit is not subscription entitlement enforcement. No calendar provider, notifications, or Google Calendar writes are used. The seven-day strip can move between weeks; tasks are grouped by local scheduled start.

## Verification

- `pnpm typecheck` — mobile/shared/Drizzle TypeScript.
- `pnpm api:build` — API, domain, and test TypeScript.
- `pnpm lint` and `pnpm format:check` — changed application source conventions.
- `pnpm test` — domain tests; integration suite is skipped unless `TEST_DATABASE_URL` is supplied.
- `TEST_DATABASE_URL=... pnpm test` — PostgreSQL/API integration on a **fresh disposable** database whose name contains `alorun_test`. This creates a stub auth schema and applies both migrations before using fictional users. It requires pgvector and permission to create a temporary non-login RLS test role. Never point this at a shared or production database. Recreate the disposable database before rerunning; the test intentionally refuses to silently reset existing data.
- `EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 pnpm exec expo export --platform android --output-dir /tmp/alorun-android-export --max-workers 2` — Android bundle verification, not an APK build or native device test.

Before release, test on Android: sign-in code, plan approval/relaunch persistence, edits and conflicts, microphone denial, 60-second auto-stop, interruption/background deletion, failed-send retry, failed-skip retry, opt-out, foreground cooldown, large text and screen reader use. Supabase/OpenAI credentials and a device are required for a real end-to-end run. An independent code review does not substitute for those checks. Account data export/deletion and broader MVP features in SPEC.md remain future work; this change is not a production-release claim.

## Companion, dictation, and voice chat

Open **Talk with Companion** from Today. Choose **Just listen**, **Help me think**, or **Make a plan**. Chat uses bounded recent conversation and the signed-in user's active goals/task statuses; it can explain problems and offer a goal-plan review button, but it cannot silently edit tasks or claim completion. See [the execution-layer design](docs/execution-layer.md) for the proposed action registry, approval gate, durable runner, and outcome feedback loop; those broader capabilities are not claimed as implemented.

- **Dictate a message:** record and stop, then select **Convert voice to text**. Edit the draft and explicitly send it. Dictation never auto-sends. Drafts have a 4,000-character limit; if adding dictation would overflow, the app preserves the current draft and lets you choose which draft to keep.
- **Start voice chat:** record/send a turn, hear the AI reply through Expo Speech and the device's configured speech engine, then record another turn. **Stop speaking** interrupts playback. **End voice chat and show transcript** adds both participants to text chat exactly once and cancels unfinished requests. Sessions allow 12 voice turns/24 transcript entries; each recording is capped at 60 seconds. This is turn-based voice chat, not continuous real-time audio. Transcription preserves the spoken language; it does not promise translation into another language.
- **Save chat history:** separate consent, off by default. To enable saving, set a server-only `CHAT_ENCRYPTION_KEY` to 64 hexadecimal characters (`openssl rand -hex 32` generates a suitable key), then restart the API. Do not put the key in `EXPO_PUBLIC_*`. Without this key, temporary chat and voice work but history saving is unavailable. Saving stores text encrypted with AES-256-GCM in existing chat tables; it does not save raw audio or enable graph memory. Do not change the key without re-encrypting stored data.
- Saving applies to the visible conversation and future completed turns. Voice turns are persisted only after ending the voice session. Returning to Companion loads the most recent 60 saved entries; older saved rows remain until cleared. Long transcripts are written in bounded chunks. **Clear conversation** deletes the user's saved chat and visible messages, with a version check that blocks stale queued writes from restoring cleared history. Turning saving off suppresses saved reads/new writes; it does not delete previously saved chat.
- Each transcription and reply consumes a request from the existing shared UTC-day development quota; there are no automatic provider retries. With the default 3 requests/day, extended voice testing requires increasing `AI_DAILY_REQUEST_LIMIT` explicitly. Cancelling a request cannot undo provider usage already incurred. This is not subscription turn accounting.
- Recording stops/discards on background/unmount; speech stops on background/end/navigation. Already transcribed voice entries stay in the active temporary session until End. Alorun sends audio to OpenAI for transcription; its account retention policy still applies. Device speech privacy depends on the selected OS engine/voice—use an installed offline voice when required. No transcript is sent to analytics or the memory graph.

No additional database migration is required for this feature; it uses the existing privacy/chat/usage tables. Rebuild the native app after installing the SDK-compatible `expo-speech` dependency. Configure the same OpenAI models/prices as goal planning.

Added authenticated routes: `POST /v1/chat/reply`, `POST /v1/chat/transcribe` (bounded M4A multipart upload), `GET/POST/DELETE /v1/chat/history`, and `PATCH /v1/chat/settings`. History writes include the latest consent/history version, so old requests fail after clear or a settings change. Transcript messages are client-origin conversation records, not trusted evidence for future action authorization.

On Android, verify microphone denial, record/stop/auto-stop, conversion before send, multiple spoken turns, stopping speech, backgrounding during a pending reply, End while transcription/reply is pending, hardware Back, provider failure/retry, history opt-in/opt-out, encrypted reload, clear with delayed saves, and account switching. No Android device or real provider credentials are available in this workspace, so those native/live checks remain pending.

## Missions

Open **Missions** on Today or **Suggest a mission** beside a goal. Goal-specific suggestions can become approved recurring practice packs, briefings, or progress reviews. Choose local-time schedule presets or advanced cron, preview upcoming runs, and select a private folder. View inputs, run history and generated documents; pause/resume or start a manual run.

The platform includes a Supabase serverless dispatcher/worker, durable PostgreSQL run state, shared AI quotas, duplicate protection and a fixed private bucket with owner/mission folder isolation. Without worker/storage configuration, missions can be saved paused. No live cron, cloud service, or production migration has been activated.

See [Missions setup and operation](docs/missions.md) for configuration, reviewed deployment/cron scripts, file/time limits, verification, retention and rollback, and [ADR 0005](docs/adr/0005-missions.md) for scope and authorization decisions.


## Merged chat interfaces

Today, voice Companion, and Missions use `EXPO_PUBLIC_API_URL` and the NestJS API. **Encrypted chat and branches** remains a separate screen using `EXPO_PUBLIC_CHAT_API_URL`, the existing Cloud Run server, and user-held encryption. Companion history uses separate opt-in server-side encryption; it is not the user-held vault. The encrypted screen is accessible from Today and from the setup screen when the new API is not configured.

Migration order preserves existing main history: `0000_wet_moondragon`, `0001_shiny_aaron_stack`, then additive `0002_conscious_hiroim` for voice check-ins/Missions. Unapplied feature-branch migrations were consolidated during merge; do not replay the feature branch migration lineage on an existing main database.
