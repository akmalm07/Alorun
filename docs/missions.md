# Missions: setup, execution, and operation

Missions prepare useful documents for a goal while the app is closed. Supported mission kinds are practice packs, next-step briefings, and reviews grounded in recorded task outcomes. The user approves the mission, schedule, and folder once; it runs until paused. Creating reports does not complete user tasks or silently change their calendar.

## Using Missions

Open **Missions** on Today or **Suggest a mission** beside a goal. Suggestions use that actual goal's title and a suitable practice/briefing/review template. They do not spend an AI request. Choose one or create a custom document mission, edit instructions, pick a schedule/timezone, preview the next three runs, and approve recurring access. Daily/weekday/weekly presets expose optional advanced five-field cron.

If the runner is not configured, the app can save a mission paused. Activation and Run now remain disabled until the server is configured. Active missions can be paused/resumed; run history shows queued/running/succeeded/failed/cancelled states and generated documents. Form/detail views replace the list so the selected controls are immediately visible.

Files stay inside the fixed private `alorun-missions` bucket at:

```text
<owner-id>/missions/<mission-id>/<chosen-folder>/
  inputs/<simple-name>.txt|md|json
  outputs/<run-id>.md
```

Input editing and document reading use the authenticated API, never public Storage URLs. Up to ten text files may be saved, each up to 16,000 characters/64 KB. A run uses only the first four alphabetically and their first 4,000 characters; these limits are disclosed beside file controls. Put priority material first. Folder names are immutable after creation and cannot contain paths, encoded separators, or traversal. Current configuration intentionally fixes the bucket name to match its private access policy.

## Runtime architecture

1. A Vault-authenticated cron call invokes the dispatcher every minute.
2. The dispatcher reads due active missions, inserts unique queued run records, advances next-run times, and coalesces missed ticks rather than replaying a backlog. A mission never overlaps another queued/running run of itself.
3. `EdgeRuntime.waitUntil` fans out at most five separate function calls. Each invocation claims one queued run using database locks and a unique claim token.
4. After loading bounded inputs and task context, the worker rechecks authorization and reserves from the shared user quota. Pause before this point prevents the model request; already admitted work may finish but cannot publish after pause.
5. One bounded model call produces validated title/summary/Markdown. The scoped storage adapter writes the run-derived output path and the database marks the run succeeded.
6. Duplicate worker invocations are no-ops. Failed attempts are visible and are not auto-retried. Queued work can be dispatched again after a network interruption. Running work interrupted for over two minutes is failed by a later tick. Users may start a new manual attempt when ready.

This is a bounded artifact-generation platform, not an arbitrary code or autonomous external-action sandbox. It reads no raw chat transcripts or memory graph and exposes no shell/network tool to the model. Cron timezone/DST behavior follows the installed cron parser; daily schedules retain the chosen local hour. Shared AI request quotas use UTC days, independently of the mission timezone.

## Configure a staging deployment

No step below was performed on a live account. Review these concrete files before applying them, particularly cron activation and service-key handling.

1. Supply the existing app/API environment and a staging Supabase transaction pooler `DATABASE_URL`. Apply reviewed Drizzle migrations with the staging session connection, including `0002_round_lockjaw.sql`. Follow the baseline/adoption notes in README for databases with historical Prisma state.
2. Review/apply `supabase/setup/missions-storage.sql` in staging. It creates a private bucket with a 64 KB object bound and a restrictive policy denying direct anon/authenticated access. It refuses an existing public/incompatible bucket and does not alter other bucket policies.
3. Configure the API's optional server-only variables:

   ```text
   MISSION_BUCKET=alorun-missions
   MISSION_STORAGE_SERVICE_KEY=<staging service-role/secret key with Storage access>
   MISSION_WORKER_URL=https://<project-ref>.supabase.co/functions/v1/missions
   MISSION_WORKER_SECRET=<random 32–256 character secret shared only by trusted services>
   ```

   Generate a random secret with `openssl rand -hex 32` and save it directly in secret management. Never put either secret into an `EXPO_PUBLIC_*` variable or mobile bundle. Restart the API after configuration changes.

4. Build shared worker code with `pnpm missions:build`. This typechecks `serverless/missions.ts` and generates ignored `supabase/functions/missions/worker.js` with npm dependency versions rewritten from the exact installed manifest pins. The per-function `deno.json`/`deno.lock` preserve runtime dependencies. Local Supabase serving uses the checked-in `edge_runtime.policy = "per_worker"` so background tasks survive the dispatch response. Do not deploy without rebuilding after shared source changes.
5. Using a current installed Supabase CLI and the correct staging project, set function secrets through a secure env file, then deploy:

   ```sh
   supabase secrets set --project-ref <staging-project-ref> --env-file <secure-worker-env-file>
   supabase functions deploy missions --project-ref <staging-project-ref>
   ```

   The worker env file needs `DATABASE_URL`, `MISSION_WORKER_URL`, `MISSION_WORKER_SECRET`, `MISSION_BUCKET`, `OPENAI_API_KEY`, `OPENAI_MODEL`, current input/output token prices, and `AI_DAILY_REQUEST_LIMIT`. `SUPABASE_URL` and the service-role key are normally supplied by the Edge environment; an explicit `MISSION_STORAGE_SERVICE_KEY` overrides the latter when needed. Do not try to set reserved `SUPABASE_*` names through custom function secrets. Use a backend database role that can access the required tables; mobile roles remain denied.

6. `supabase/config.toml` sets `verify_jwt=false` only for this internal function. Every request is instead authenticated using a separate constant-time-checked `x-mission-secret`. Do not use a public/publishable key as this secret. User JWTs continue to protect the API routes. The function accepts only dispatch/wake/run commands with validated IDs; it accepts no caller-provided user ID or storage path.
7. Test a manual run against staging before scheduling it. Confirm the model response, private bucket/policy, one run record, one artifact, correct user/timezone, quota accounting, duplicate protection, and pause behavior. The API's `runnerAvailable` field indicates configuration, not a cloud health guarantee.
8. Only after that review, enable supported `pg_cron`, `pg_net`, and Vault extensions, create Vault secrets named `mission_worker_url` and `mission_worker_secret`, and review/apply `supabase/setup/missions-cron.sql`. This activates the every-minute dispatcher. Keep database logins and the pg_net request queue restricted: the provider documents that request secrets temporarily appear in that queue.
9. Production needs a separate reviewed migration/deployment, matching secrets, provider budgets, monitoring, and native acceptance. No paid service or live schedule is automatically activated by application startup.

The default daily development limit remains three total AI attempts shared with chat/planning/check-ins. Mission runs consume one attempt; provider/storage failure is not a free retry. Increase the limit only deliberately after setting provider budgets. Model retries are disabled. Storage/model fetches and database statements are bounded; test hosted wall-clock/CPU and nested-call limits in staging.

## Verification

- `pnpm lint`, `pnpm typecheck`, `pnpm api:build`, `pnpm format:check`.
- `pnpm missions:build` — shared source typecheck and reproducible Edge bundle.
- `TEST_DATABASE_URL=<fresh local alorun_test> pnpm test` — existing regressions plus Missions tests. The Missions suite creates/drops its own randomly named disposable database; use only a local throwaway PostgreSQL/pgvector instance with test-role/database-creation privileges. Existing root API tests require a fresh base database each run.
- `TEST_DATABASE_URL=<local alorun_test> pnpm missions:smoke` — optional Deno 2 runtime smoke. Requires Deno installed and local PostgreSQL at 127.0.0.1:55432. It creates/drops its own disposable DB, runs the actual bundled worker, and uses fixture OpenAI/Storage HTTP responses. It verifies dispatch → execution → scoped artifact → duplicate no-op. No real cloud/model calls.
- `EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 pnpm exec expo export --platform android --output-dir /tmp/alorun-missions-android --max-workers 2` — bundle verification, not device testing.

The checked implementation passed real PostgreSQL/HTTP tests and a Deno fixture run. Real Supabase cron/storage/model execution and native Android interaction remain unverified without account configuration and a device. The restrictive storage policy is tested against a minimal SQL fixture, not a hosted Storage service.

## Retention, recovery, and rollback

Pausing stops future attempts and publication, not previously stored documents. Existing mission inputs/outputs persist until explicitly purged. The broader account export/delete flow is not yet implemented; before public release it must include mission rows/runs and the owner's entire private Storage prefix. No claim of automatic account-file deletion is made.

Storage upload and SQL commit cannot be one distributed transaction. A crash between them may leave a private orphan artifact; reconcile against successful run IDs before any authorized cleanup. Do not retry arbitrary uncertain side effects or run model calls blindly. If cron is interrupted, queued work remains durable and missed future occurrences are coalesced. A queue larger than the five-item dispatch batch may take additional minutes.

Global pause: run `SELECT cron.unschedule('alorun-missions-dispatch');` in the correct project and pause individual missions. Preserve definitions, run records and private files during rollback. Withdraw the deployed function/API feature before any separately approved destructive migration or bucket purge. Monitor cron response errors, queued age, failed/interrupted runs, quota failures, provider costs and storage errors without logging personal document bodies or secrets.

Primary deployment references: [scheduling functions](https://supabase.com/docs/guides/functions/schedule-functions), [background tasks](https://supabase.com/docs/guides/functions/background-tasks), [npm/Node dependencies](https://supabase.com/docs/guides/functions/dependencies), [runtime limits](https://supabase.com/docs/guides/functions/limits), [private storage access](https://supabase.com/docs/guides/storage/security/access-control).
