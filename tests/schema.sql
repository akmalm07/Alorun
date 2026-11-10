\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users(id) VALUES ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002');
INSERT INTO public.users_profile(id) SELECT id FROM auth.users;
INSERT INTO public.memory_nodes(id,user_id,type,label,canonical_json,confidence,sensitivity,source_ref,observed_at)
VALUES ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','fact','test','{}',1,'normal','{}',now()),
       ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','fact','test','{}',1,'normal','{}',now());
DO $$ BEGIN
  BEGIN
    INSERT INTO public.memory_edges(user_id,source_node_id,target_node_id,relation_type,confidence,source_ref)
    VALUES ('00000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','related',1,'{}');
    RAISE EXCEPTION 'cross-tenant edge was accepted';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
END $$;
CREATE ROLE schema_test_client NOLOGIN;
GRANT USAGE ON SCHEMA public TO schema_test_client;
GRANT SELECT ON public.memory_nodes TO schema_test_client;
SET LOCAL ROLE schema_test_client;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.memory_nodes) THEN RAISE EXCEPTION 'RLS exposed rows'; END IF;
END $$;
RESET ROLE;
ROLLBACK;
