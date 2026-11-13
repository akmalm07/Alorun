import { createClient } from '@supabase/supabase-js';
import { createSupabaseStore } from './supabase-store.mjs';
import { migrateEncryptedSqlite } from './migrate-encrypted.mjs';

// Supply email/password as JSON via stdin; no secrets in arguments or logs.
try {
  const { SUPABASE_URL, SUPABASE_ANON_KEY } = process.env;
  if (!SUPABASE_URL?.startsWith('https://') || !SUPABASE_ANON_KEY || !process.argv[2]) throw new Error('Missing configuration');
  let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 8192) throw new Error('Input too large'); }
  const { email, password } = JSON.parse(input);
  if (![email, password].every(x => typeof x === 'string' && x.length)) throw new Error('Invalid input');
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error('Sign-in failed');
  const accountId = data.session.user.id;
  const target = createSupabaseStore({ url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, token: data.session.access_token, owner: accountId });
  const result = await migrateEncryptedSqlite({ path: process.argv[2], accountId, target });
  console.log(`Verified ${result.verified} encrypted conversations; imported ${result.imported}. Original database was not changed.`);
  await client.auth.signOut();
} catch { console.error('Migration failed. Check credentials, configuration, and vault/record conflicts. The source was not changed.'); process.exitCode = 1; }
