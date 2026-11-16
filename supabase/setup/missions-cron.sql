-- Activates recurring execution. Apply only after reviewing/deploying the worker and secrets.
-- Enable pg_cron, pg_net, and Vault in the project's supported schemas first.
-- Store two secrets using the Vault UI or parameterized SQL (never commit values):
--   mission_worker_url    = deployed /functions/v1/missions HTTPS URL
--   mission_worker_secret = the same random secret configured on API and Edge Function
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name='mission_worker_url') OR
     NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name='mission_worker_secret') THEN
    RAISE EXCEPTION 'Configure both Missions Vault secrets before scheduling';
  END IF;
END $$;
SELECT cron.schedule(
  'alorun-missions-dispatch', '* * * * *',
  $mission_cron$
    SELECT net.http_post(
      url := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='mission_worker_url'),
      headers := jsonb_build_object('Content-Type','application/json','x-mission-secret',
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='mission_worker_secret')),
      body := '{"kind":"dispatch"}'::jsonb,
      timeout_milliseconds := 10000
    );
  $mission_cron$
);
-- Pause the global dispatcher without deleting mission definitions:
-- SELECT cron.unschedule('alorun-missions-dispatch');
