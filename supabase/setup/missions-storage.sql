-- Review and run in staging first. This uses the default MISSION_BUCKET name.
-- All mobile mission-file access goes through the authenticated, scoped application API.
BEGIN;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('alorun-missions','alorun-missions',false,65536,ARRAY['text/plain','application/json'])
ON CONFLICT (id) DO NOTHING;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id='alorun-missions' AND (public OR file_size_limit IS NULL OR file_size_limit>65536)) THEN
    RAISE EXCEPTION 'Existing Missions bucket is public or has an incompatible file limit; review it before proceeding';
  END IF;
END $$;
-- Restrictive policy protects this private bucket even if another permissive policy exists.
DROP POLICY IF EXISTS missions_private_guard ON storage.objects;
CREATE POLICY missions_private_guard ON storage.objects AS RESTRICTIVE
FOR ALL TO anon, authenticated
USING (bucket_id <> 'alorun-missions') WITH CHECK (bucket_id <> 'alorun-missions');
COMMIT;
