# Alorun

A minimal Expo hello-world app for Android.

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
