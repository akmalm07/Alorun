BEGIN;

-- Initial schema. This migration is intended for a clean Supabase project.

CREATE SCHEMA IF NOT EXISTS extensions;

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

SET search_path = public, extensions;

CREATE TABLE "public"."users_profile" (
  "id" uuid NOT NULL PRIMARY KEY,
  "timezone" text DEFAULT 'UTC' NOT NULL,
  "locale" text DEFAULT 'en' NOT NULL,
  "communication_style" text,
  "quiet_hours_start" time(0),
  "quiet_hours_end" time(0),
  "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "public"."privacy_settings" (
  "user_id" uuid NOT NULL PRIMARY KEY,
  "save_chat_history" boolean DEFAULT false NOT NULL,
  "persistent_memory_enabled" boolean DEFAULT false NOT NULL,
  "sensitive_memory_requires_confirmation" boolean DEFAULT true NOT NULL,
  "analytics_opt_in" boolean DEFAULT false NOT NULL,
  "updated_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE "public"."goals" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "title" text NOT NULL,
  "motivation" text,
  "status" text DEFAULT 'active' NOT NULL,
  "target_at" timestamptz(6),
  "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX "goals_user_id_id_key" ON "public"."goals" ("user_id", "id");

CREATE INDEX "goals_user_id_status_idx" ON "public"."goals" ("user_id", "status");

CREATE TABLE "public"."projects" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "goal_id" uuid,
  "title" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX "projects_user_id_id_key" ON "public"."projects" ("user_id", "id");

CREATE INDEX "projects_user_id_goal_id_idx" ON "public"."projects" ("user_id", "goal_id");

CREATE TABLE "public"."tasks" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "project_id" uuid,
  "goal_id" uuid,
  "title" text NOT NULL,
  "description" text,
  "due_at" timestamptz(6),
  "estimate_minutes" integer,
  "priority" integer,
  "status" text DEFAULT 'pending' NOT NULL,
  "recurrence_rule" text,
  "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "updated_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX "tasks_user_id_id_key" ON "public"."tasks" ("user_id", "id");

CREATE INDEX "tasks_user_id_status_due_at_idx" ON "public"."tasks" ("user_id", "status", "due_at");

CREATE INDEX "tasks_user_id_project_id_idx" ON "public"."tasks" ("user_id", "project_id");

CREATE INDEX "tasks_user_id_goal_id_idx" ON "public"."tasks" ("user_id", "goal_id");

CREATE TABLE "public"."habits" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "title" text NOT NULL,
  "recurrence_rule" text NOT NULL,
  "status" text DEFAULT 'active' NOT NULL
);

CREATE UNIQUE INDEX "habits_user_id_id_key" ON "public"."habits" ("user_id", "id");

CREATE INDEX "habits_user_id_status_idx" ON "public"."habits" ("user_id", "status");

CREATE TABLE "public"."habit_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "habit_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "day_local" date NOT NULL,
  "result" text NOT NULL
);

CREATE UNIQUE INDEX "habit_events_user_id_habit_id_day_local_key" ON "public"."habit_events" ("user_id", "habit_id", "day_local");

CREATE TABLE "public"."chat_threads" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "title" text,
  "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE UNIQUE INDEX "chat_threads_user_id_id_key" ON "public"."chat_threads" ("user_id", "id");

CREATE INDEX "chat_threads_user_id_created_at_idx" ON "public"."chat_threads" ("user_id", "created_at");

CREATE TABLE "public"."chat_messages" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "thread_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "role" text NOT NULL,
  "content_protected" text NOT NULL,
  "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "retention_until" timestamptz(6)
);

CREATE UNIQUE INDEX "chat_messages_user_id_id_key" ON "public"."chat_messages" ("user_id", "id");

CREATE INDEX "chat_messages_user_id_thread_id_created_at_idx" ON "public"."chat_messages" ("user_id", "thread_id", "created_at");

CREATE TABLE "public"."memory_nodes" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "type" text NOT NULL,
  "label" text NOT NULL,
  "canonical_json" jsonb NOT NULL,
  "confidence" double precision NOT NULL,
  "confirmed" boolean DEFAULT false NOT NULL,
  "sensitivity" text NOT NULL,
  "source_ref" jsonb NOT NULL,
  "observed_at" timestamptz(6) NOT NULL,
  "valid_from" timestamptz(6),
  "valid_until" timestamptz(6),
  "deleted_at" timestamptz(6)
);

CREATE UNIQUE INDEX "memory_nodes_user_id_id_key" ON "public"."memory_nodes" ("user_id", "id");

CREATE INDEX "memory_nodes_user_id_deleted_at_idx" ON "public"."memory_nodes" ("user_id", "deleted_at");

CREATE TABLE "public"."memory_edges" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "source_node_id" uuid NOT NULL,
  "target_node_id" uuid NOT NULL,
  "relation_type" text NOT NULL,
  "confidence" double precision NOT NULL,
  "confirmed" boolean DEFAULT false NOT NULL,
  "source_ref" jsonb NOT NULL,
  "valid_from" timestamptz(6),
  "valid_until" timestamptz(6),
  "deleted_at" timestamptz(6)
);

CREATE INDEX "memory_edges_user_id_source_node_id_relation_type_idx" ON "public"."memory_edges" ("user_id", "source_node_id", "relation_type");

CREATE INDEX "memory_edges_user_id_target_node_id_idx" ON "public"."memory_edges" ("user_id", "target_node_id");

CREATE TABLE "public"."memory_suggestions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "source_message_id" uuid NOT NULL,
  "proposal_json" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE INDEX "memory_suggestions_user_id_status_idx" ON "public"."memory_suggestions" ("user_id", "status");

CREATE TABLE "public"."memory_embeddings" (
  "node_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "model_id" text NOT NULL,
  "vector" extensions.vector NOT NULL,
  "updated_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  PRIMARY KEY ("user_id", "node_id", "model_id")
);

CREATE TABLE "public"."focus_sessions" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "task_id" uuid NOT NULL,
  "started_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "ended_at" timestamptz(6),
  "outcome" text,
  "obstacle" text,
  "support_strategy" text,
  "helpfulness" integer
);

CREATE INDEX "focus_sessions_user_id_task_id_started_at_idx" ON "public"."focus_sessions" ("user_id", "task_id", "started_at");

CREATE TABLE "public"."plan_proposals" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "proposal_json" jsonb NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "accepted_at" timestamptz(6)
);

CREATE INDEX "plan_proposals_user_id_status_idx" ON "public"."plan_proposals" ("user_id", "status");

CREATE TABLE "public"."notification_preferences" (
  "user_id" uuid NOT NULL PRIMARY KEY,
  "morning_enabled" boolean DEFAULT false NOT NULL,
  "evening_enabled" boolean DEFAULT false NOT NULL,
  "quiet_hours" jsonb,
  "local_times" jsonb
);

CREATE TABLE "public"."notification_deliveries" (
  "idempotency_key" text NOT NULL PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "sent_at" timestamptz(6),
  "outcome" text NOT NULL
);

CREATE INDEX "notification_deliveries_user_id_kind_idx" ON "public"."notification_deliveries" ("user_id", "kind");

CREATE TABLE "public"."calendar_connections" (
  "user_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "encrypted_refresh_token_ref" text NOT NULL,
  "scopes" text[] NOT NULL,
  "last_sync_at" timestamptz(6),
  PRIMARY KEY ("user_id", "provider")
);

CREATE TABLE "public"."subscriptions" (
  "user_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "product_id" text NOT NULL,
  "status" text NOT NULL,
  "entitlement_until" timestamptz(6),
  "verified_at" timestamptz(6),
  PRIMARY KEY ("user_id", "provider", "product_id")
);

CREATE TABLE "public"."usage_ledger" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "period_key" text NOT NULL,
  "operation" text NOT NULL,
  "tokens_in" integer NOT NULL,
  "tokens_out" integer NOT NULL,
  "estimated_usd" decimal(14,8) NOT NULL,
  "request_id" text NOT NULL
);

CREATE UNIQUE INDEX "usage_ledger_user_id_request_id_operation_key" ON "public"."usage_ledger" ("user_id", "request_id", "operation");

CREATE INDEX "usage_ledger_user_id_period_key_idx" ON "public"."usage_ledger" ("user_id", "period_key");

CREATE TABLE "public"."audit_events" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
  "user_id" uuid NOT NULL,
  "action" text NOT NULL,
  "entity" text NOT NULL,
  "entity_id" text NOT NULL,
  "created_at" timestamptz(6) DEFAULT CURRENT_TIMESTAMP NOT NULL,
  "sanitized_metadata" jsonb
);

CREATE INDEX "audit_events_user_id_created_at_idx" ON "public"."audit_events" ("user_id", "created_at");

ALTER TABLE public.users_profile ADD CONSTRAINT users_profile_auth_fk FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE public."privacy_settings" ADD CONSTRAINT "privacy_settings_user_fk" FOREIGN KEY (user_id) REFERENCES public.users_profile(id) ON DELETE CASCADE;

ALTER TABLE public."goals" ADD CONSTRAINT "goals_user_fk" FOREIGN KEY (user_id) REFERENCES public.users_profile(id) ON DELETE CASCADE;

ALTER TABLE public."projects" ADD CONSTRAINT "projects_user_fk" FOREIGN KEY (user_id) REFERENCES public.users_profile(id) ON DELETE CASCADE;

ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_user_fk" FOREIGN KEY (user_id) REFERENCES public.users_profile(id) ON DELETE CASCADE;

ALTER TABLE public."habits" ADD CONSTRAINT "habits_user_fk" FOREIGN KEY (user_id) REFERENCES public.users_profile(id) ON DELETE CASCADE;

ALTER TABLE public."habit_events" ADD CONSTRAINT "habit_events_user_fk" FOREIGN KEY (user_id) REFERENCES public.users_profile(id) ON DELETE CASCADE;

ALTER TABLE public."chat_threads" ADD CONSTRAINT "chat_threads_user_fk" FOREIGN KEY (user_id) REFERENCES public.users_profile(id) ON DELETE CASCADE;

ALTER TABLE public."chat_messages" ADD CONSTRAINT "chat_messages_user_fk" FOREIGN KEY (user_id) REFERENCES public.users_profile(id) ON DELETE CASCADE;

ALTER TABLE public."memory_nodes" ADD CONSTRAINT "memory_nodes_user_fk" FOREIGN KEY (user_id) REFERENCES public.users_profile(id) ON DELETE CASCADE;

ALTER TABLE public."memory_edges" ADD CONSTRAINT "memory_edges_user_fk" FOREIGN KEY (user_id) REFERENCES public.users_profile(id) ON DELETE CASCADE;

ALTER TABLE public."memory_suggestions" ADD CONSTRAINT "memory_suggestions_user_fk" FOREIGN KEY (user_id) REFERENCES public.users_profile(id) ON DELETE CASCADE;

ALTER TABLE public."memory_embeddings" ADD CONSTRAINT "memory_embeddings_user_fk" FOREIGN KEY (user_id) REFERENCES public.users_profile(id) ON DELETE CASCADE;

ALTER TABLE public."focus_sessions" ADD CONSTRAINT "focus_sessions_user_fk" FOREIGN KEY (user_id) REFERENCES public.users_profile(id) ON DELETE CASCADE;

ALTER TABLE public."plan_proposals" ADD CONSTRAINT "plan_proposals_user_fk" FOREIGN KEY (user_id) REFERENCES public.users_profile(id) ON DELETE CASCADE;

ALTER TABLE public."notification_preferences" ADD CONSTRAINT "notification_preferences_user_fk" FOREIGN KEY (user_id) REFERENCES public.users_profile(id) ON DELETE CASCADE;

ALTER TABLE public."notification_deliveries" ADD CONSTRAINT "notification_deliveries_user_fk" FOREIGN KEY (user_id) REFERENCES public.users_profile(id) ON DELETE CASCADE;

ALTER TABLE public."calendar_connections" ADD CONSTRAINT "calendar_connections_user_fk" FOREIGN KEY (user_id) REFERENCES public.users_profile(id) ON DELETE CASCADE;

ALTER TABLE public."subscriptions" ADD CONSTRAINT "subscriptions_user_fk" FOREIGN KEY (user_id) REFERENCES public.users_profile(id) ON DELETE CASCADE;

ALTER TABLE public."usage_ledger" ADD CONSTRAINT "usage_ledger_user_fk" FOREIGN KEY (user_id) REFERENCES public.users_profile(id) ON DELETE CASCADE;

ALTER TABLE public."audit_events" ADD CONSTRAINT "audit_events_user_fk" FOREIGN KEY (user_id) REFERENCES public.users_profile(id) ON DELETE CASCADE;

ALTER TABLE public."projects" ADD CONSTRAINT "projects_goal_id_owner_fk" FOREIGN KEY (user_id, "goal_id") REFERENCES public."goals" (user_id, id) ON DELETE NO ACTION;

ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_goal_id_owner_fk" FOREIGN KEY (user_id, "goal_id") REFERENCES public."goals" (user_id, id) ON DELETE NO ACTION;

ALTER TABLE public."tasks" ADD CONSTRAINT "tasks_project_id_owner_fk" FOREIGN KEY (user_id, "project_id") REFERENCES public."projects" (user_id, id) ON DELETE NO ACTION;

ALTER TABLE public."habit_events" ADD CONSTRAINT "habit_events_habit_id_owner_fk" FOREIGN KEY (user_id, "habit_id") REFERENCES public."habits" (user_id, id) ON DELETE NO ACTION;

ALTER TABLE public."chat_messages" ADD CONSTRAINT "chat_messages_thread_id_owner_fk" FOREIGN KEY (user_id, "thread_id") REFERENCES public."chat_threads" (user_id, id) ON DELETE NO ACTION;

ALTER TABLE public."memory_edges" ADD CONSTRAINT "memory_edges_source_node_id_owner_fk" FOREIGN KEY (user_id, "source_node_id") REFERENCES public."memory_nodes" (user_id, id) ON DELETE NO ACTION;

ALTER TABLE public."memory_edges" ADD CONSTRAINT "memory_edges_target_node_id_owner_fk" FOREIGN KEY (user_id, "target_node_id") REFERENCES public."memory_nodes" (user_id, id) ON DELETE NO ACTION;

ALTER TABLE public."memory_suggestions" ADD CONSTRAINT "memory_suggestions_source_message_id_owner_fk" FOREIGN KEY (user_id, "source_message_id") REFERENCES public."chat_messages" (user_id, id) ON DELETE NO ACTION;

ALTER TABLE public."memory_embeddings" ADD CONSTRAINT "memory_embeddings_node_id_owner_fk" FOREIGN KEY (user_id, "node_id") REFERENCES public."memory_nodes" (user_id, id) ON DELETE NO ACTION;

ALTER TABLE public."focus_sessions" ADD CONSTRAINT "focus_sessions_task_id_owner_fk" FOREIGN KEY (user_id, "task_id") REFERENCES public."tasks" (user_id, id) ON DELETE NO ACTION;

ALTER TABLE public.memory_nodes ADD CONSTRAINT memory_nodes_confidence_check CHECK (confidence >= 0 AND confidence <= 1);

ALTER TABLE public.memory_edges ADD CONSTRAINT memory_edges_confidence_check CHECK (confidence >= 0 AND confidence <= 1);

ALTER TABLE public.tasks ADD CONSTRAINT tasks_estimate_check CHECK (estimate_minutes IS NULL OR estimate_minutes > 0);

ALTER TABLE public.usage_ledger ADD CONSTRAINT usage_nonnegative_check CHECK (tokens_in >= 0 AND tokens_out >= 0 AND estimated_usd >= 0);

CREATE INDEX memory_nodes_label_fts_idx ON public.memory_nodes USING gin (to_tsvector('simple', label));

-- RLS is deny-by-default: the trusted backend is responsible for authorization.

ALTER TABLE public."users_profile" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."privacy_settings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."goals" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."projects" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."tasks" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."habits" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."habit_events" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."chat_threads" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."chat_messages" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."memory_nodes" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."memory_edges" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."memory_suggestions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."memory_embeddings" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."focus_sessions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."plan_proposals" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."notification_preferences" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."notification_deliveries" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."calendar_connections" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."subscriptions" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."usage_ledger" ENABLE ROW LEVEL SECURITY;

ALTER TABLE public."audit_events" ENABLE ROW LEVEL SECURITY;

COMMIT;
