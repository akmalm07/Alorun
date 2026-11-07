# Starter API

The NestJS API delegates account creation, email/password sign-in and token refresh to Supabase Auth. Protected routes validate the bearer token with Supabase on every request; the API never accepts a user ID as proof of identity. Use a Supabase project configured for your environment and enable email/password sign-in. Email confirmation can make the sign-up session null until the user confirms their email.

Set `SUPABASE_URL` and `SUPABASE_ANON_KEY` in the server environment (never use a service-role key in the mobile app). Optionally set `PORT` (default 3000) and `CORS_ORIGINS` to a comma-separated list of allowed web origins. Build and run from the repository root:

```sh
pnpm exec tsc -p api/tsconfig.json
node api/dist/src/main.js
```

Endpoints: `GET /v1/health`; `POST /v1/auth/sign-up` and `/v1/auth/sign-in` with `{ "email", "password" }`; `POST /v1/auth/refresh` with `{ "refreshToken" }`; `POST /v1/auth/sign-out` and `GET /v1/me` with `Authorization: Bearer <accessToken>`. Auth responses include `{ user: { id, email }, session: { accessToken, refreshToken, expiresAt } | null }`. Token expiration is Unix seconds. Errors contain `code` and a generic `message`.

This is a development foundation: configure HTTPS, a trusted reverse proxy and rate limits, review account recovery and email verification settings, and independently review authentication before release. Sign-out revokes the refresh session; already issued access tokens may remain valid until expiry. No database, domain data, notifications, or production deployment is configured here.
