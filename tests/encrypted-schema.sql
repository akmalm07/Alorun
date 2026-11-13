\set ON_ERROR_STOP on
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
GRANT USAGE ON SCHEMA auth TO authenticated;
GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
INSERT INTO auth.users VALUES ('11111111-1111-4111-8111-111111111111'), ('22222222-2222-4222-8222-222222222222');
\ir ../drizzle/0001_shiny_aaron_stack.sql
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', false);
INSERT INTO encrypted_vaults VALUES ('11111111-1111-4111-8111-111111111111', jsonb_build_object('version', 1, 'salt', repeat('a',32), 'nonce', repeat('b',48), 'ciphertext', repeat('c',96)));
INSERT INTO encrypted_threads VALUES ('11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', jsonb_build_object('version',1,'nonce',repeat('a',48),'ciphertext',repeat('b',32)),1);
DO $$ BEGIN
  IF (SELECT count(*) FROM encrypted_threads) <> 1 THEN RAISE EXCEPTION 'own record missing'; END IF;
  BEGIN
    INSERT INTO encrypted_vaults VALUES ('22222222-2222-4222-8222-222222222222', jsonb_build_object('version',1,'salt',repeat('a',32),'nonce',repeat('b',48),'ciphertext',repeat('c',96)));
    RAISE EXCEPTION 'cross-account insert accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    INSERT INTO encrypted_threads VALUES ('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', jsonb_build_object('version',1,'nonce',repeat('a',48),'ciphertext',repeat('b',32),'plaintext','secret'),1);
    RAISE EXCEPTION 'plaintext accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', false);
DO $$ BEGIN
  IF (SELECT count(*) FROM encrypted_threads) <> 0 OR (SELECT count(*) FROM encrypted_vaults) <> 0 THEN RAISE EXCEPTION 'cross-account read'; END IF;
  UPDATE encrypted_threads SET revision=2 WHERE user_id='11111111-1111-4111-8111-111111111111';
  IF FOUND THEN RAISE EXCEPTION 'cross-account update'; END IF;
END $$;
RESET ROLE;
DELETE FROM auth.users WHERE id='11111111-1111-4111-8111-111111111111';
DO $$ BEGIN IF EXISTS (SELECT 1 FROM encrypted_threads) OR EXISTS (SELECT 1 FROM encrypted_vaults) THEN RAISE EXCEPTION 'user deletion failed'; END IF; END $$;
