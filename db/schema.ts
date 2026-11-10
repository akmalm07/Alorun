import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, time, date, integer, boolean, jsonb, doublePrecision, numeric, customType, primaryKey, index, uniqueIndex, foreignKey, check } from "drizzle-orm/pg-core";

// The dimension is intentionally unspecified until an embedding model is selected.
const embeddingVector = customType<{ data: string }>({ dataType: () => "extensions.vector" });

export const users_profile = pgTable("users_profile", {
  id: uuid("id").notNull().primaryKey(),
  timezone: text("timezone").default('UTC').notNull(),
  locale: text("locale").default('en').notNull(),
  communication_style: text("communication_style"),
  quiet_hours_start: time("quiet_hours_start", { precision: 0 }),
  quiet_hours_end: time("quiet_hours_end", { precision: 0 }),
  created_at: timestamp("created_at", { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}).enableRLS();

export const privacy_settings = pgTable("privacy_settings", {
  user_id: uuid("user_id").notNull().primaryKey(),
  save_chat_history: boolean("save_chat_history").default(false).notNull(),
  persistent_memory_enabled: boolean("persistent_memory_enabled").default(false).notNull(),
  sensitive_memory_requires_confirmation: boolean("sensitive_memory_requires_confirmation").default(true).notNull(),
  analytics_opt_in: boolean("analytics_opt_in").default(false).notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => [
  foreignKey({ name: "privacy_settings_user_fk", columns: [t.user_id], foreignColumns: [users_profile.id] }).onDelete("cascade")
]).enableRLS();

export const goals = pgTable("goals", {
  id: uuid("id").defaultRandom().notNull().primaryKey(),
  user_id: uuid("user_id").notNull(),
  title: text("title").notNull(),
  motivation: text("motivation"),
  status: text("status").default('active').notNull(),
  target_at: timestamp("target_at", { withTimezone: true, precision: 6 }),
  created_at: timestamp("created_at", { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("goals_user_id_id_key").on(t.user_id, t.id),
  index("goals_user_id_status_idx").on(t.user_id, t.status),
  foreignKey({ name: "goals_user_fk", columns: [t.user_id], foreignColumns: [users_profile.id] }).onDelete("cascade")
]).enableRLS();

export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().notNull().primaryKey(),
  user_id: uuid("user_id").notNull(),
  goal_id: uuid("goal_id"),
  title: text("title").notNull(),
  status: text("status").default('active').notNull(),
  created_at: timestamp("created_at", { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("projects_user_id_id_key").on(t.user_id, t.id),
  index("projects_user_id_goal_id_idx").on(t.user_id, t.goal_id),
  foreignKey({ name: "projects_user_fk", columns: [t.user_id], foreignColumns: [users_profile.id] }).onDelete("cascade"),
  foreignKey({ name: "projects_goal_id_owner_fk", columns: [t.user_id, t.goal_id], foreignColumns: [goals.user_id, goals.id] }).onDelete("no action")
]).enableRLS();

export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().notNull().primaryKey(),
  user_id: uuid("user_id").notNull(),
  project_id: uuid("project_id"),
  goal_id: uuid("goal_id"),
  title: text("title").notNull(),
  description: text("description"),
  due_at: timestamp("due_at", { withTimezone: true, precision: 6 }),
  estimate_minutes: integer("estimate_minutes"),
  priority: integer("priority"),
  status: text("status").default('pending').notNull(),
  recurrence_rule: text("recurrence_rule"),
  created_at: timestamp("created_at", { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("tasks_user_id_id_key").on(t.user_id, t.id),
  index("tasks_user_id_status_due_at_idx").on(t.user_id, t.status, t.due_at),
  index("tasks_user_id_project_id_idx").on(t.user_id, t.project_id),
  index("tasks_user_id_goal_id_idx").on(t.user_id, t.goal_id),
  foreignKey({ name: "tasks_user_fk", columns: [t.user_id], foreignColumns: [users_profile.id] }).onDelete("cascade"),
  foreignKey({ name: "tasks_goal_id_owner_fk", columns: [t.user_id, t.goal_id], foreignColumns: [goals.user_id, goals.id] }).onDelete("no action"),
  foreignKey({ name: "tasks_project_id_owner_fk", columns: [t.user_id, t.project_id], foreignColumns: [projects.user_id, projects.id] }).onDelete("no action"),
  check("tasks_estimate_check", sql`estimate_minutes IS NULL OR estimate_minutes > 0`)
]).enableRLS();

export const habits = pgTable("habits", {
  id: uuid("id").defaultRandom().notNull().primaryKey(),
  user_id: uuid("user_id").notNull(),
  title: text("title").notNull(),
  recurrence_rule: text("recurrence_rule").notNull(),
  status: text("status").default('active').notNull(),
}, (t) => [
  uniqueIndex("habits_user_id_id_key").on(t.user_id, t.id),
  index("habits_user_id_status_idx").on(t.user_id, t.status),
  foreignKey({ name: "habits_user_fk", columns: [t.user_id], foreignColumns: [users_profile.id] }).onDelete("cascade")
]).enableRLS();

export const habit_events = pgTable("habit_events", {
  id: uuid("id").defaultRandom().notNull().primaryKey(),
  habit_id: uuid("habit_id").notNull(),
  user_id: uuid("user_id").notNull(),
  day_local: date("day_local").notNull(),
  result: text("result").notNull(),
}, (t) => [
  uniqueIndex("habit_events_user_id_habit_id_day_local_key").on(t.user_id, t.habit_id, t.day_local),
  foreignKey({ name: "habit_events_user_fk", columns: [t.user_id], foreignColumns: [users_profile.id] }).onDelete("cascade"),
  foreignKey({ name: "habit_events_habit_id_owner_fk", columns: [t.user_id, t.habit_id], foreignColumns: [habits.user_id, habits.id] }).onDelete("no action")
]).enableRLS();

export const chat_threads = pgTable("chat_threads", {
  id: uuid("id").defaultRandom().notNull().primaryKey(),
  user_id: uuid("user_id").notNull(),
  title: text("title"),
  created_at: timestamp("created_at", { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => [
  uniqueIndex("chat_threads_user_id_id_key").on(t.user_id, t.id),
  index("chat_threads_user_id_created_at_idx").on(t.user_id, t.created_at),
  foreignKey({ name: "chat_threads_user_fk", columns: [t.user_id], foreignColumns: [users_profile.id] }).onDelete("cascade")
]).enableRLS();

export const chat_messages = pgTable("chat_messages", {
  id: uuid("id").defaultRandom().notNull().primaryKey(),
  thread_id: uuid("thread_id").notNull(),
  user_id: uuid("user_id").notNull(),
  role: text("role").notNull(),
  content_protected: text("content_protected").notNull(),
  created_at: timestamp("created_at", { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  retention_until: timestamp("retention_until", { withTimezone: true, precision: 6 }),
}, (t) => [
  uniqueIndex("chat_messages_user_id_id_key").on(t.user_id, t.id),
  index("chat_messages_user_id_thread_id_created_at_idx").on(t.user_id, t.thread_id, t.created_at),
  foreignKey({ name: "chat_messages_user_fk", columns: [t.user_id], foreignColumns: [users_profile.id] }).onDelete("cascade"),
  foreignKey({ name: "chat_messages_thread_id_owner_fk", columns: [t.user_id, t.thread_id], foreignColumns: [chat_threads.user_id, chat_threads.id] }).onDelete("no action")
]).enableRLS();

export const memory_nodes = pgTable("memory_nodes", {
  id: uuid("id").defaultRandom().notNull().primaryKey(),
  user_id: uuid("user_id").notNull(),
  type: text("type").notNull(),
  label: text("label").notNull(),
  canonical_json: jsonb("canonical_json").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  confirmed: boolean("confirmed").default(false).notNull(),
  sensitivity: text("sensitivity").notNull(),
  source_ref: jsonb("source_ref").notNull(),
  observed_at: timestamp("observed_at", { withTimezone: true, precision: 6 }).notNull(),
  valid_from: timestamp("valid_from", { withTimezone: true, precision: 6 }),
  valid_until: timestamp("valid_until", { withTimezone: true, precision: 6 }),
  deleted_at: timestamp("deleted_at", { withTimezone: true, precision: 6 }),
}, (t) => [
  uniqueIndex("memory_nodes_user_id_id_key").on(t.user_id, t.id),
  index("memory_nodes_user_id_deleted_at_idx").on(t.user_id, t.deleted_at),
  foreignKey({ name: "memory_nodes_user_fk", columns: [t.user_id], foreignColumns: [users_profile.id] }).onDelete("cascade"),
  check("memory_nodes_confidence_check", sql`confidence >= 0 AND confidence <= 1`)
]).enableRLS();

export const memory_edges = pgTable("memory_edges", {
  id: uuid("id").defaultRandom().notNull().primaryKey(),
  user_id: uuid("user_id").notNull(),
  source_node_id: uuid("source_node_id").notNull(),
  target_node_id: uuid("target_node_id").notNull(),
  relation_type: text("relation_type").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  confirmed: boolean("confirmed").default(false).notNull(),
  source_ref: jsonb("source_ref").notNull(),
  valid_from: timestamp("valid_from", { withTimezone: true, precision: 6 }),
  valid_until: timestamp("valid_until", { withTimezone: true, precision: 6 }),
  deleted_at: timestamp("deleted_at", { withTimezone: true, precision: 6 }),
}, (t) => [
  index("memory_edges_user_id_source_node_id_relation_type_idx").on(t.user_id, t.source_node_id, t.relation_type),
  index("memory_edges_user_id_target_node_id_idx").on(t.user_id, t.target_node_id),
  foreignKey({ name: "memory_edges_user_fk", columns: [t.user_id], foreignColumns: [users_profile.id] }).onDelete("cascade"),
  foreignKey({ name: "memory_edges_source_node_id_owner_fk", columns: [t.user_id, t.source_node_id], foreignColumns: [memory_nodes.user_id, memory_nodes.id] }).onDelete("no action"),
  foreignKey({ name: "memory_edges_target_node_id_owner_fk", columns: [t.user_id, t.target_node_id], foreignColumns: [memory_nodes.user_id, memory_nodes.id] }).onDelete("no action"),
  check("memory_edges_confidence_check", sql`confidence >= 0 AND confidence <= 1`)
]).enableRLS();

export const memory_suggestions = pgTable("memory_suggestions", {
  id: uuid("id").defaultRandom().notNull().primaryKey(),
  user_id: uuid("user_id").notNull(),
  source_message_id: uuid("source_message_id").notNull(),
  proposal_json: jsonb("proposal_json").notNull(),
  status: text("status").default('pending').notNull(),
  created_at: timestamp("created_at", { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => [
  index("memory_suggestions_user_id_status_idx").on(t.user_id, t.status),
  foreignKey({ name: "memory_suggestions_user_fk", columns: [t.user_id], foreignColumns: [users_profile.id] }).onDelete("cascade"),
  foreignKey({ name: "memory_suggestions_source_message_id_owner_fk", columns: [t.user_id, t.source_message_id], foreignColumns: [chat_messages.user_id, chat_messages.id] }).onDelete("no action")
]).enableRLS();

export const memory_embeddings = pgTable("memory_embeddings", {
  node_id: uuid("node_id").notNull(),
  user_id: uuid("user_id").notNull(),
  model_id: text("model_id").notNull(),
  vector: embeddingVector("vector").notNull(),
  updated_at: timestamp("updated_at", { withTimezone: true, precision: 6 }).defaultNow().notNull(),
}, (t) => [
  primaryKey({ columns: [t.user_id, t.node_id, t.model_id] }),
  foreignKey({ name: "memory_embeddings_user_fk", columns: [t.user_id], foreignColumns: [users_profile.id] }).onDelete("cascade"),
  foreignKey({ name: "memory_embeddings_node_id_owner_fk", columns: [t.user_id, t.node_id], foreignColumns: [memory_nodes.user_id, memory_nodes.id] }).onDelete("no action")
]).enableRLS();

export const focus_sessions = pgTable("focus_sessions", {
  id: uuid("id").defaultRandom().notNull().primaryKey(),
  user_id: uuid("user_id").notNull(),
  task_id: uuid("task_id").notNull(),
  started_at: timestamp("started_at", { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  ended_at: timestamp("ended_at", { withTimezone: true, precision: 6 }),
  outcome: text("outcome"),
  obstacle: text("obstacle"),
  support_strategy: text("support_strategy"),
  helpfulness: integer("helpfulness"),
}, (t) => [
  index("focus_sessions_user_id_task_id_started_at_idx").on(t.user_id, t.task_id, t.started_at),
  foreignKey({ name: "focus_sessions_user_fk", columns: [t.user_id], foreignColumns: [users_profile.id] }).onDelete("cascade"),
  foreignKey({ name: "focus_sessions_task_id_owner_fk", columns: [t.user_id, t.task_id], foreignColumns: [tasks.user_id, tasks.id] }).onDelete("no action")
]).enableRLS();

export const plan_proposals = pgTable("plan_proposals", {
  id: uuid("id").defaultRandom().notNull().primaryKey(),
  user_id: uuid("user_id").notNull(),
  proposal_json: jsonb("proposal_json").notNull(),
  status: text("status").default('pending').notNull(),
  created_at: timestamp("created_at", { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  accepted_at: timestamp("accepted_at", { withTimezone: true, precision: 6 }),
}, (t) => [
  index("plan_proposals_user_id_status_idx").on(t.user_id, t.status),
  foreignKey({ name: "plan_proposals_user_fk", columns: [t.user_id], foreignColumns: [users_profile.id] }).onDelete("cascade")
]).enableRLS();

export const notification_preferences = pgTable("notification_preferences", {
  user_id: uuid("user_id").notNull().primaryKey(),
  morning_enabled: boolean("morning_enabled").default(false).notNull(),
  evening_enabled: boolean("evening_enabled").default(false).notNull(),
  quiet_hours: jsonb("quiet_hours"),
  local_times: jsonb("local_times"),
}, (t) => [
  foreignKey({ name: "notification_preferences_user_fk", columns: [t.user_id], foreignColumns: [users_profile.id] }).onDelete("cascade")
]).enableRLS();

export const notification_deliveries = pgTable("notification_deliveries", {
  idempotency_key: text("idempotency_key").notNull().primaryKey(),
  user_id: uuid("user_id").notNull(),
  kind: text("kind").notNull(),
  sent_at: timestamp("sent_at", { withTimezone: true, precision: 6 }),
  outcome: text("outcome").notNull(),
}, (t) => [
  index("notification_deliveries_user_id_kind_idx").on(t.user_id, t.kind),
  foreignKey({ name: "notification_deliveries_user_fk", columns: [t.user_id], foreignColumns: [users_profile.id] }).onDelete("cascade")
]).enableRLS();

export const calendar_connections = pgTable("calendar_connections", {
  user_id: uuid("user_id").notNull(),
  provider: text("provider").notNull(),
  encrypted_refresh_token_ref: text("encrypted_refresh_token_ref").notNull(),
  scopes: text("scopes").array().notNull(),
  last_sync_at: timestamp("last_sync_at", { withTimezone: true, precision: 6 }),
}, (t) => [
  primaryKey({ columns: [t.user_id, t.provider] }),
  foreignKey({ name: "calendar_connections_user_fk", columns: [t.user_id], foreignColumns: [users_profile.id] }).onDelete("cascade")
]).enableRLS();

export const subscriptions = pgTable("subscriptions", {
  user_id: uuid("user_id").notNull(),
  provider: text("provider").notNull(),
  product_id: text("product_id").notNull(),
  status: text("status").notNull(),
  entitlement_until: timestamp("entitlement_until", { withTimezone: true, precision: 6 }),
  verified_at: timestamp("verified_at", { withTimezone: true, precision: 6 }),
}, (t) => [
  primaryKey({ columns: [t.user_id, t.provider, t.product_id] }),
  foreignKey({ name: "subscriptions_user_fk", columns: [t.user_id], foreignColumns: [users_profile.id] }).onDelete("cascade")
]).enableRLS();

export const usage_ledger = pgTable("usage_ledger", {
  id: uuid("id").defaultRandom().notNull().primaryKey(),
  user_id: uuid("user_id").notNull(),
  period_key: text("period_key").notNull(),
  operation: text("operation").notNull(),
  tokens_in: integer("tokens_in").notNull(),
  tokens_out: integer("tokens_out").notNull(),
  estimated_usd: numeric("estimated_usd", { precision: 14, scale: 8 }).notNull(),
  request_id: text("request_id").notNull(),
}, (t) => [
  uniqueIndex("usage_ledger_user_id_request_id_operation_key").on(t.user_id, t.request_id, t.operation),
  index("usage_ledger_user_id_period_key_idx").on(t.user_id, t.period_key),
  foreignKey({ name: "usage_ledger_user_fk", columns: [t.user_id], foreignColumns: [users_profile.id] }).onDelete("cascade"),
  check("usage_nonnegative_check", sql`tokens_in >= 0 AND tokens_out >= 0 AND estimated_usd >= 0`)
]).enableRLS();

export const audit_events = pgTable("audit_events", {
  id: uuid("id").defaultRandom().notNull().primaryKey(),
  user_id: uuid("user_id").notNull(),
  action: text("action").notNull(),
  entity: text("entity").notNull(),
  entity_id: text("entity_id").notNull(),
  created_at: timestamp("created_at", { withTimezone: true, precision: 6 }).defaultNow().notNull(),
  sanitized_metadata: jsonb("sanitized_metadata"),
}, (t) => [
  index("audit_events_user_id_created_at_idx").on(t.user_id, t.created_at),
  foreignKey({ name: "audit_events_user_fk", columns: [t.user_id], foreignColumns: [users_profile.id] }).onDelete("cascade")
]).enableRLS();

