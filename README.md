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

The initial migration assumes a clean Supabase project, `auth.users`, and pgvector in the `extensions` schema. It enables deny-by-default RLS and includes SQL-only features, including the external auth foreign key and full-text index. Never use `drizzle-kit push`; review generated migrations against those features. Test on staging, review existing objects and extension placement, and verify backups before production. See [ADR 0002](docs/adr/0002-drizzle.md).

Do not run the Drizzle baseline on a database where the old Prisma migration was already applied: the migration histories are separate. An existing database needs a reviewed baseline/adoption procedure before Drizzle migrations are used.

To validate on a disposable PostgreSQL instance with pgvector, create a stub `auth.users(id uuid primary key)`, run the initial SQL migration in `drizzle/`, then run `tests/schema.sql` with `psql -v ON_ERROR_STOP=1`. Use fictional data only.
