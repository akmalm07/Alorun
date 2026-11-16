CREATE TABLE "goal_checkin_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "goal_checkin_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "goal_checkins" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"question" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_prompted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "goal_checkins_status_check" CHECK ("goal_checkins"."status" IN ('pending', 'skipped', 'answered'))
);
--> statement-breakpoint
ALTER TABLE "goal_checkins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "mission_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"mission_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"trigger" text NOT NULL,
	"request_id" uuid NOT NULL,
	"claim_token" uuid,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"summary" text,
	"error" text,
	"artifact" text,
	CONSTRAINT "mission_runs_status_check" CHECK ("mission_runs"."status" IN ('queued','running','succeeded','failed','cancelled')),
	CONSTRAINT "mission_runs_trigger_check" CHECK ("mission_runs"."trigger" IN ('cron','manual'))
);
--> statement-breakpoint
ALTER TABLE "mission_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "missions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"title" text NOT NULL,
	"instructions" text NOT NULL,
	"kind" text NOT NULL,
	"cron" text NOT NULL,
	"timezone" text NOT NULL,
	"folder" text NOT NULL,
	"status" text DEFAULT 'paused' NOT NULL,
	"next_run_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "missions_status_check" CHECK ("missions"."status" IN ('active','paused')),
	CONSTRAINT "missions_kind_check" CHECK ("missions"."kind" IN ('practice','briefing','review')),
	CONSTRAINT "missions_folder_check" CHECK ("missions"."folder" ~ '^[a-z0-9][a-z0-9-]{0,47}$')
);
--> statement-breakpoint
ALTER TABLE "missions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "memory_embeddings" ALTER COLUMN "vector" SET DATA TYPE vector(1536);--> statement-breakpoint
ALTER TABLE "goal_checkin_preferences" ADD CONSTRAINT "goal_checkin_preferences_user_id_users_profile_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_checkins" ADD CONSTRAINT "goal_checkins_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_checkins" ADD CONSTRAINT "goal_checkins_goal_owner_fk" FOREIGN KEY ("user_id","goal_id") REFERENCES "public"."goals"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "missions_owner_id_key" ON "missions" USING btree ("user_id","id");
--> statement-breakpoint
ALTER TABLE "mission_runs" ADD CONSTRAINT "mission_runs_owner_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mission_runs" ADD CONSTRAINT "mission_runs_mission_owner_fk" FOREIGN KEY ("user_id","mission_id") REFERENCES "public"."missions"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "missions" ADD CONSTRAINT "missions_goal_owner_fk" FOREIGN KEY ("user_id","goal_id") REFERENCES "public"."goals"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "goal_checkins_user_goal_key" ON "goal_checkins" USING btree ("user_id","goal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mission_runs_owner_request_key" ON "mission_runs" USING btree ("user_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mission_runs_schedule_key" ON "mission_runs" USING btree ("mission_id","trigger","scheduled_for");--> statement-breakpoint
CREATE INDEX "mission_runs_status_idx" ON "mission_runs" USING btree ("status","scheduled_for");--> statement-breakpoint
CREATE INDEX "mission_runs_owner_mission_idx" ON "mission_runs" USING btree ("user_id","mission_id");--> statement-breakpoint
CREATE INDEX "missions_due_idx" ON "missions" USING btree ("status","next_run_at");