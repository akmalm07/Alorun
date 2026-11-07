# Alorun starter

An Android-first Expo app and NestJS REST API foundation for the personal life companion described in [SPEC.md](SPEC.md). The app includes an authenticated shell for Today, Companion, My World, tasks, goals, focus, onboarding and settings. These are starting points: the product's task, AI, memory and planning services are not implemented, and the screens say so.

## Local setup

1. Install Node.js and pnpm 11, then run `pnpm install`.
2. Create a development Supabase project, enable email/password authentication, and configure email confirmation as desired. Copy `.env.example` to `.env` for Expo; set `EXPO_PUBLIC_API_URL` to an API origin reachable from the device. For a physical phone, use your computer's LAN IP instead of `10.0.2.2`. Only public configuration belongs in Expo variables.
3. Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the **server shell** (the API does not load `.env` automatically). Optionally set `PORT` and `CORS_ORIGINS`. Never put a service-role key in the app.
4. Run `pnpm api:build` and `pnpm api:start`. In another terminal run `pnpm start`, then open the app in a compatible Expo development build or Android emulator. `pnpm android` opens an emulator. Push notifications require a development build and additional EAS/FCM setup; see [notifications](docs/notifications.md).

The API defaults to port 3000. Use `GET /v1/health` to check it. See [API setup and endpoints](api/README.md). Registration may require email confirmation before sign-in. Native refresh tokens are stored in the device keystore; browser sessions are temporary.

## Working on the app

- `app/` contains Expo Router screens. The replaceable placeholder logo is `Logo` in `src/ui/shell.tsx`.
- `src/auth/` contains the session provider and typed transport; add domain API methods there or in dedicated modules.
- `api/` contains the NestJS auth and health foundation. Add validated, authenticated domain modules here.
- `src/notifications/` and `worker/notifications/` contain opt-in device and delivery building blocks. No scheduler or token persistence is wired yet.
- `pnpm typecheck`, `pnpm api:test`, and `pnpm test:notifications` run the current checks.

## Before a release

The starter uses email/password, while the specification calls for magic link or Google sign-in; account recovery and production auth hardening remain to be implemented. Domain persistence, migrations, onboarding persistence, reminders, quiet-hour preferences, memory consent and management, export/deletion, offline behavior, and AI are not implemented. No production service or credentials are provisioned. Independently review authentication and privacy and complete the security and device tests in `AGENTS.md` before release.
