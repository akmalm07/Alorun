import { createClient } from '@supabase/supabase-js';
import { unlockVault } from '../security/vault.mjs';
import { migrateLegacy } from './migrate-legacy.mjs';

// Read sensitive input only from stdin; never accept secrets in command arguments or print them.
try {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, CHAT_API_URL } = process.env;
  if (!SUPABASE_URL?.startsWith('https://') || !CHAT_API_URL?.startsWith('https://') || !SUPABASE_ANON_KEY || !process.argv[2]) throw new Error('Set HTTPS SUPABASE_URL and CHAT_API_URL, SUPABASE_ANON_KEY, and provide the legacy SQLite path.');
  let input = ''; for await (const chunk of process.stdin) { input += chunk; if (input.length > 8192) throw new Error('Input too large'); }
  const { email, password, passphrase } = JSON.parse(input);
  if (![email, password, passphrase].every(x => typeof x === 'string' && x.length)) throw new Error('Invalid credentials input');
  const auth = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error('Sign-in failed');
  const accountId = data.session.user.id; const token = data.session.access_token;
  async function request(path, method = 'GET', body) {
    const response = await fetch(`${CHAT_API_URL.replace(/\/$/, '')}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    return response.json();
  }
  const { vault } = await request('/v1/vault');
  if (!vault) throw new Error('Create an encrypted vault in the app before importing.');
  const key = await unlockVault(accountId, passphrase, vault);
  try {
    const result = await migrateLegacy({ path: process.argv[2], accountId, key, list: async () => (await request('/v1/encrypted-threads')).threads, save: async (id, envelope) => request(`/v1/encrypted-threads/${id}`, 'PUT', { revision: 0, envelope }) });
    console.log(`Verified ${result.verified} encrypted conversations; imported ${result.imported}. Original database was not changed.`);
  } finally { key.fill(0); await auth.auth.signOut(); }
} catch { console.error('Migration failed. Check credentials, configuration, and connectivity. The original database was not changed.'); process.exitCode = 1; }
