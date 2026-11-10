> Superseded by [ADR 0002](0002-drizzle.md). This document records the previous decision.

# 0001: Use Prisma for the PostgreSQL schema

## Context and decision
The user requested Prisma and a Supabase pooler configuration, replacing the specification's original Drizzle choice. Use Prisma 6 with a checked-in SQL migration. Use the transaction pooler for runtime and the session pooler for migrations. The SQL migration also contains PostgreSQL-specific ownership constraints, RLS and pgvector setup that the Prisma model does not represent.

## Alternatives and tradeoffs
Drizzle matches the initial specification and is already a dependency; Prisma was selected at the user's explicit direction. Keep the existing Drizzle dependencies until application integration is decided. Prisma cannot represent every PostgreSQL feature here. Never use `prisma db push` to update this database: it can remove SQL-only constraints or change objects unexpectedly. Review every generated migration against the SQL-only parts.

## Operations and privacy
The initial migration targets a clean Supabase project, references `auth.users`, enables deny-by-default RLS, and assumes pgvector is installed in the `extensions` schema. Check existing objects and extension placement before applying. Run against staging first; confirm backup and a recovery plan before production. A rollback that drops these tables destroys stored data; do not run one against a populated database without authorization and verified backup. There is no backfill because this is an initial schema; any existing data requires a separate reviewed migration.

The schema does not implement application-level consent, encryption, retention, deletion/export, notifications, or authorization for a privileged backend. Vector dimensions and vector indexing are deferred until an embedding model is selected. Do not store production user content until those controls are implemented and reviewed.
