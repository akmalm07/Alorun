# Missions: scheduled serverless work for a goal

User request: autonomous tasks called Missions, serverless runs triggered by cron, access limited to a specific folder in a bucket, friendly frontend and concrete suggestions based on shared goals. Preserve all existing goal/chat/voice work.

Slice: user-approved mission definition and IANA timezone cron schedule; goal-specific useful suggestions; bounded Supabase Edge Function runs, PostgreSQL due-run queue and idempotency; Supabase private-bucket prefix scoped by owner and mission; approved text inputs and generated Markdown outputs; run status/history, manual run and pause/resume. No production schedule or paid service activation without a concrete deployment review.

Acceptance: duplicate cron dispatch/worker invocations do not duplicate AI work; missed ticks coalesce; local timezone/DST correct; wrong owner IDs and path traversal inaccessible; no cross-mission folder reads/writes; creation is explicit authorization of recurring file generation; pause fences new/finalizing work; quota/time/file bounds enforced; failure leaves useful retryable status and no fabricated result. API/domain/real PostgreSQL and storage-adapter tests, worker bundle/type validation, Android bundle, independent security/native code review.

Directory CLI/website unavailable (403). Use existing Supabase integration rather than adding a new vendor. Official Supabase docs are checked for cron/Edge Functions/private storage. No credentials or production data accessed.

## Delivered

- Missions API, native route, Today links and specific goal-based practice/briefing/review suggestions; explicit cron preview and recurring approval; paused setup when runner unavailable; pause/resume, manual run, history and documents.
- Shared serverless dispatcher/worker with separate per-run invocation, unique schedule/request identity, lock-based claims, missed-tick coalescing, bounded fan-out, shared AI request/cost ledger, interrupted-run handling and final publication fencing.
- Fixed private bucket with owner/mission/folder capabilities, simple text input names, bounded inputs and derived output paths; restrictive direct-client policy protects against unrelated permissive policies. Model receives no storage credentials or arbitrary execution tools.
- Additive migration 0002 plus separate reviewed bucket/cron setup, reproducible Edge bundle, Deno entry/lock, local-runtime smoke, deployment/rollback/retention docs and optional server configuration. No existing migrations were edited.
- Code-derived design notes extended with unchanged native tokens. Existing planning, chat and voice changes preserved on local branch feat/missions; no commit/PR/deployment claimed.

## Files/modules

- api/missions — contracts-to-controller flow, cron, storage, model, scheduling/execution and internal worker authentication.
- api/config.ts, main.ts, errors.ts — optional platform configuration, dependency wiring and shared safe domain error mapping.
- src/shared/missions.ts, src/domain/missions.ts — validated data, goal suggestions and scope/name rules.
- src/mobile/Missions.tsx, app/missions.tsx, Today.tsx — suggested mission creation, preview/approval, list/detail, files/run outcomes and navigation.
- db/schema.ts, drizzle/0002_round_lockjaw.sql and metadata — owner-constrained mission/run tables.
- serverless, scripts/build-missions.mjs, scripts/test-missions-edge.mjs, supabase/functions/missions, supabase/setup, supabase/config.toml — typechecked shared Edge bundle, actual Deno test and deployment artifacts. Generated worker.js is ignored and rebuilt before deploy.
- tests/missions-domain.test.ts and missions.test.ts — domain/authentication, real PostgreSQL/HTTP and minimal Storage policy fixtures.
- README, SPEC, ADR 0005, docs/missions.md, env example and package lock/scripts — scope, operation, setup and verified limits.

## Verification results

- `pnpm lint` — PASS.
- `pnpm typecheck` — PASS.
- `pnpm api:build` — PASS.
- `pnpm format:check` — PASS.
- `TEST_DATABASE_URL=<fresh disposable alorun_test> pnpm test` — PASS: 55 tests, 0 failures/skips. Both existing regressions and new migrations, concurrent dispatch, duplicate claims, manual idempotency, redacted failure, shared quota, tenant/path isolation, direct RLS denial, pause during model work, pause during blocked file preparation (no model call/charge), private bucket policy overriding an unrelated permissive policy, and HTTP approval/identity/cron validation passed. External model/storage use fixtures, not live services.
- `pnpm missions:build` — PASS: shared TypeScript and reproducible pinned npm Edge bundle.
- Deno 2.9.6 import and `deno check --config supabase/functions/missions/deno.json supabase/functions/missions/index.ts` — PASS.
- `TEST_DATABASE_URL=<local test DB> deno run --config supabase/functions/missions/deno.json --allow-env --allow-net=127.0.0.1:55432 --allow-read --allow-sys scripts/test-missions-edge.mjs` — PASS: actual bundled Deno runtime with real disposable PostgreSQL; dispatch → queued run → one fixture OpenAI SDK response → private scoped Storage SDK upload → succeeded; duplicate run ignored. No real provider calls.
- `EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 pnpm exec expo export --platform android --output-dir /tmp/alorun-missions-android --max-workers 2` — PASS: 1,385 modules, Android Hermes bundle. Not an APK or device test.
- `pnpm db:generate` — PASS: no schema drift after migration 0002.
- Production API bootstrap with synthetic configuration — PASS: health 200, unauthenticated Today/chat/Missions 401; no provider calls.
- `git diff --check` — PASS.
- Independent security/native-source review — four findings scored resolved after fixes: pause admission race, off-screen form/detail, paused Run now, input limit disclosure. Review did not independently rerun tests or native rendering.

## Remaining limitations / deployment

No real Supabase project, credentials, hosted cron/storage or live model output was exercised. No production migration, cron activation, paid provisioning, or external deployment occurred. Android device rendering, accessibility and user flows remain unverified; bundle output is not native QA. Account export/delete and object retention/purge integration remain release follow-ups; current artifacts persist, and a crash between upload/SQL commit can leave a private orphan. Model/tool authority is deliberately bounded to generating documents, not arbitrary code, browsing, messaging or calendar writes. Setup, operational limits and rollback are documented in docs/missions.md.

Follow-up: configure staging secrets, review/apply migration and private bucket policy, build/deploy/test the function, then explicitly activate cron after staging verification. Complete native/live-provider acceptance before a public release.
