CREATE TABLE "encrypted_threads" (
	"user_id" uuid NOT NULL,
	"id" uuid NOT NULL,
	"envelope" jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "encrypted_threads_user_id_id_pk" PRIMARY KEY("user_id","id"),
	CONSTRAINT "encrypted_threads_revision_check" CHECK (revision > 0)
);
--> statement-breakpoint
ALTER TABLE "encrypted_threads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "encrypted_vaults" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"envelope" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "encrypted_vaults" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "encrypted_vaults" ADD CONSTRAINT "encrypted_vaults_auth_fk" FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "encrypted_threads" ADD CONSTRAINT "encrypted_threads_auth_fk" FOREIGN KEY ("user_id") REFERENCES auth.users(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "encrypted_vaults" ADD CONSTRAINT "encrypted_vaults_envelope_check" CHECK (coalesce(jsonb_typeof(envelope) = 'object' AND envelope - ARRAY['version','salt','nonce','ciphertext'] = '{}'::jsonb AND envelope->'version' = '1'::jsonb AND envelope->>'salt' ~ '^[0-9a-f]{32}$' AND envelope->>'nonce' ~ '^[0-9a-f]{48}$' AND envelope->>'ciphertext' ~ '^[0-9a-f]{96}$' AND octet_length(envelope::text) < 512, false));
--> statement-breakpoint
ALTER TABLE "encrypted_threads" ADD CONSTRAINT "encrypted_threads_envelope_check" CHECK (coalesce(jsonb_typeof(envelope) = 'object' AND envelope - ARRAY['version','nonce','ciphertext'] = '{}'::jsonb AND envelope->'version' = '1'::jsonb AND envelope->>'nonce' ~ '^[0-9a-f]{48}$' AND envelope->>'ciphertext' ~ '^([0-9a-f]{2}){16,}$' AND octet_length(envelope::text) <= 2010000, false));
--> statement-breakpoint
CREATE POLICY "encrypted_vaults_select_own" ON "encrypted_vaults" FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "encrypted_vaults_insert_own" ON "encrypted_vaults" FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "encrypted_threads_select_own" ON "encrypted_threads" FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "encrypted_threads_insert_own" ON "encrypted_threads" FOR INSERT TO authenticated WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
CREATE POLICY "encrypted_threads_update_own" ON "encrypted_threads" FOR UPDATE TO authenticated USING (user_id = (SELECT auth.uid())) WITH CHECK (user_id = (SELECT auth.uid()));
--> statement-breakpoint
REVOKE ALL ON "encrypted_vaults", "encrypted_threads" FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON "encrypted_vaults" TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON "encrypted_threads" TO authenticated;
--> statement-breakpoint
GRANT UPDATE (envelope, revision) ON "encrypted_threads" TO authenticated;
