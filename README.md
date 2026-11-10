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

The Prisma models and reviewed SQL live in `prisma/`. Copy `.env.example` to a secure local environment file and provide the Supabase transaction pooler URL as `DATABASE_URL` and session pooler URL as `DIRECT_URL`; never commit credentials. Prisma's CLI needs these variables exported (or loaded from `.env`), since it does not automatically load `.env.local`.

The initial migration assumes a clean Supabase project, the `auth.users` table, and pgvector in the `extensions` schema. It enables deny-by-default RLS: direct client access is unavailable until deliberately designed policies are added. It uses SQL-only tenant constraints, so do not run `prisma db push` or overwrite the migration with generated SQL. Test on staging, review existing objects and extension placement, and verify backups before deploying to production. See [ADR 0001](docs/adr/0001-prisma.md) for limitations and rollback considerations.

To validate on a disposable PostgreSQL instance with pgvector, create a stub `auth.users(id uuid primary key)`, apply `prisma/migrations/20261110000000_initial/migration.sql`, then run `tests/schema.sql` with `psql -v ON_ERROR_STOP=1`. Use fictional data only.
