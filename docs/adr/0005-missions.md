# 0005: Missions on scheduled serverless functions

## Context and decision

The user explicitly requested goal-based autonomous work called Missions, triggered by cron, with access to a folder in a bucket and friendly suggestions/setup. This brings a bounded autonomous action forward from the original roadmap. Use the existing Supabase platform for Edge Functions, private Storage, and PostgreSQL cron/queue state. No new data processor or second queue service is introduced. The earlier Graphile Worker choice remains for future always-on backend work; this user-requested serverless slice uses on-demand functions instead.

A private, server-secret-authenticated dispatcher runs every minute, coalesces missed occurrences, enqueues up to five due missions, and spawns separate function invocations via the documented background-task mechanism. Each worker claims one persisted run; duplicate invocations are no-ops. Mission cron is a validated five-field expression interpreted with the user's confirmed IANA timezone; intervals under 15 minutes are rejected. At most five missions per account are active.

## Bounded authority

Creation/activation is explicit recurring authorization to read the linked goal's tasks and the mission folder's approved text inputs and write a generated Markdown artifact in that same folder. The model has no shell, browser, arbitrary code, messaging, calendar writes, or selectable storage paths. Current useful mission kinds are practice packs, goal briefings, and recorded-progress reviews. Suggestions are deterministic, goal-specific templates, not fabricated AI recommendations; execution content is model-generated and validated.

Use one fixed private bucket, `alorun-missions`, matching the restrictive client-denial policy. Mission capabilities are constructed from persisted owner ID, mission ID and a validated immutable folder slug. Never pass credentials or an arbitrary object key to the model. Mobile clients use the JWT-verified API. The server-side service key bypasses Storage RLS, so all application paths are scoped and tested; a restrictive policy also blocks direct anon/authenticated access even in the presence of unrelated permissive policies.

A run reads at most the first four input files alphabetically, at most 4,000 characters each; up to ten files of 16,000 characters/64 KB may be saved. Output is validated and written to `outputs/<run-id>.md`. Existing memory consent/history are unaffected; no graph memories or raw conversations are used or written.

## State, concurrency, cost, and failure

Runs transition queued → running → succeeded/failed/cancelled. Composite owner foreign keys and unique schedule/request indexes enforce integrity. Worker claim and finalization lock mission then run; attempt admission locks user then mission/run, matching pause. A pause during file preparation prevents any new model attempt or quota charge. Already admitted AI work may finish, but publication is serialized with pause and fenced by status/claim token. No new document can be published after pause returns.

Every model attempt reserves from the existing shared UTC-day usage ledger before invocation; failures count and there are no automatic model retries. SDK timeouts, storage fetch timeouts, bounded context, batch size, and an interrupted-run reaper keep work bounded. A run interrupted longer than two minutes is failed by the dispatcher, not blindly repeated. Manual Run now starts a new authorized attempt; it does not claim external/personal task completion.

Object upload and SQL commit are separate systems. A crash after object upload but before run commit can leave an inaccessible orphan under the same private mission prefix; no unsafe retry or public link is used. Operator reconciliation/retention must address such objects before broad release.

## Alternatives

An always-on Graphile Worker does not meet the requested serverless execution model. A new cloud vendor adds credentials and a processor unnecessarily. Arbitrary agent code/tools broaden authorization and isolation requirements beyond this slice; useful generated documents provide a bounded first execution action.

## Migration and rollback

`0002_round_lockjaw.sql` adds only Missions/run tables with deny-by-default RLS, checks, indexes, and owner foreign keys. The composite mission owner index is deliberately created before its referencing foreign key. No existing migration is edited and no backfill is needed. Private bucket policy and cron activation are separate reviewed setup scripts, never automatic migration side effects.

Roll back by unscheduling the dispatcher, pausing missions, and withdrawing the function/API route. Preserve run records and private files for export/retention review before any destructive cleanup. Do not drop tables or purge buckets automatically. No production migration, live cron, service activation, or paid deployment has been performed.

## Evidence and deployment limits

Official Supabase documentation checked on 2026-11-16:

- [Scheduled Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions): pg_cron + pg_net; keep invocation secrets in Vault.
- [Function dependencies](https://supabase.com/docs/guides/functions/dependencies): npm packages and Node built-ins are supported; dependencies are pinned in the worker bundle and per-function Deno configuration/lock.
- [Background tasks](https://supabase.com/docs/guides/functions/background-tasks): function background work uses `EdgeRuntime.waitUntil` and remains subject to limits.
- [Function limits](https://supabase.com/docs/guides/functions/limits): hosted wall-clock, CPU, size and nested-call limits must be staging-tested. The fan-out is bounded to five.
- [Storage access control](https://supabase.com/docs/guides/storage/security/access-control): service credentials bypass RLS and must remain in trusted runtime.

Directory setup/search was attempted first but its website/installer returned 403. The existing documented Supabase integration was retained rather than choosing a new vendor. Node/PostgreSQL tests and a full Deno fixture smoke validate the implementation, not a deployed Supabase service or real model output quality. Native device validation and account/file deletion/export integration remain release follow-ups.
