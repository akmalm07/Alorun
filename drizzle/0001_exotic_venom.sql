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
ALTER TABLE "goal_checkin_preferences" ADD CONSTRAINT "goal_checkin_preferences_user_id_users_profile_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_checkins" ADD CONSTRAINT "goal_checkins_user_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users_profile"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_checkins" ADD CONSTRAINT "goal_checkins_goal_owner_fk" FOREIGN KEY ("user_id","goal_id") REFERENCES "public"."goals"("user_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "goal_checkins_user_goal_key" ON "goal_checkins" USING btree ("user_id","goal_id");