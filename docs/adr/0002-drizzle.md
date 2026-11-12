# 0002: Use Drizzle for PostgreSQL schema management

## Context and decision

The user requested replacing Prisma with Drizzle. Define the schema in Drizzle and retain the reviewed initial SQL as the Drizzle baseline. The old Prisma files have been removed from the repository. Runtime uses the transaction pooler; migration commands use the session pooler (`DIRECT_URL`).

## Alternatives and tradeoffs

Keeping Prisma avoids a tooling change but contradicts the requested direction. Drizzle is already a dependency and provides typed SQL. The external `auth.users` foreign key, extension setup and full-text index are maintained in SQL rather than the Drizzle model. Review every generated migration for effects on these objects; do not use schema push. See https://orm.drizzle.team/docs/migrations and https://orm.drizzle.team/docs/kit-overview.

## Migration, rollback and privacy

The baseline targets a clean Supabase project and preserves tenant foreign keys, checks and deny-by-default RLS. Existing databases that applied the Prisma migration must not run the baseline again; reconcile schema and migration history using a separately reviewed adoption plan. Test on staging and verify backups before production. Dropping tables destroys data and requires authorization and a verified backup. No backfill is included. The schema does not implement application-level authorization, consent, encryption, retention or deletion. Vector dimensions and indexing remain deferred. No production data was accessed or changed.
