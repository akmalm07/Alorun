# Goal planning and voice check-ins

Requested slice: share a goal → AI proposes actionable tasks → edit/approve → tasks and in-app calendar on Today. Add opt-in app-open voice questions about shared goals, gated by either an explicit skipped-check-in signal or overdue goal task, as confirmed by the user. Keep dismissal available; overdue tasks are an eligibility signal only, never an inferred motivation; microphone denial is not a trigger.

Spec traceability: §§4.2, 4.4, 4.6, 9, 10. User explicitly requested voice ahead of the original P2 roadmap.

Acceptance: proposals do not create tasks; accepted plans create tasks atomically and idempotently; schedules respect supplied windows and existing bookings; cross-user IDs are inaccessible; app activation checks eligibility without repeated prompts; text cannot answer a voice check-in; denied microphone access does not block tasks; audio/transcript are not persisted as memory; provider failure produces a retryable error.

Verification planned: domain tests, API/DB integration with fictional users, mobile/API typechecks, formatting, native smoke if tooling available. No production migration/deployment authorized or needed.

## Delivered

- Authenticated NestJS API and native email-code sign-in, tenant-scoped goals/tasks/proposals, idempotent plan approval, deterministic in-app scheduling and calendar preview.
- Today main page with next task, calendar, task completion/reopen, saved proposals and editable task breakdowns.
- Optional app-open/foreground voice-only questions when skipped check-ins OR overdue pending goal tasks qualify, one prompt per rolling 24 hours, explicit skip/disable controls.
- Microphone permission and bounded M4A recording/upload, background/unmount cleanup, transient transcription with no graph/history writes, request quotas and successful-call usage estimates.
- Additive Drizzle check-in migration with deny-by-default RLS and tenant-owned goal references. Existing migration history unchanged.

## Verification results

- `pnpm lint` — PASS.
- `pnpm typecheck` — PASS.
- `pnpm api:build` — PASS, including API/domain/test types.
- `pnpm format:check` — PASS.
- `TEST_DATABASE_URL=<disposable alorun_test> pnpm test` — PASS, 20 tests, 0 failures/skips. Includes both migrations on pgvector PostgreSQL 17; real SQL ownership/RLS, duplicate approvals, conflicting plans, provider failure, simultaneous check-in deduplication/charge release, actual concurrent quota races, skipped/overdue triggers, opt-out/cooldown, no memory/transcript persistence, HTTP auth and typed-answer rejection. AI/Auth provider calls use synthetic fixtures.
- `pnpm db:generate` — PASS, no additional schema drift after the checked-in migration.
- `EXPO_NO_TELEMETRY=1 EXPO_OFFLINE=1 pnpm exec expo export --platform android --output-dir /tmp/alorun-android-export --max-workers 2` — PASS, 1,374 modules bundled to Android Hermes output. This is not an APK/native-device test.
- Generated a one-second AAC M4A with ffmpeg and checked it with the upload container validator — PASS (duration 1 second).
- `git diff --check` — PASS.
- Independent code review identified five issues (unused quota charges, failed-skip recording state, cleanup paths, schedule visibility, calendar selection); reviewer subsequently scored all five resolved by inspection. No native screenshots or web design detector used. Design extraction records code evidence only.

## Remaining limitations and deployment

No Supabase/OpenAI credentials were supplied or used, and no emulator/Android device is available. Actual email delivery, provider output quality/safety, microphone denial/interruption/upload and native accessibility still require a configured device run. No production deployment or production migration was performed. The database used for verification contained fictional data only and is disposable. No Google Calendar integration, push reminders, subscription entitlement, or broader account deletion/export feature is included in this slice.

Follow-up: configure `.env` from `.env.example`, apply reviewed migrations in staging, set Supabase email token templates, start the API, then run the Android scenarios in README before release.
