import http from 'node:http';
import { createClient } from '@supabase/supabase-js';
import { createProviderRegistry } from './chat.mjs';
import { loadConfig } from './config.mjs';
import { createSupabaseStore } from './supabase-store.mjs';
import { createEncryptedHandler } from './encrypted-api.mjs';

let config, providers;
try { config = loadConfig(); providers = createProviderRegistry(config); }
catch { console.error('Invalid backend configuration. Check the secrets file and provider model lists.'); process.exit(1); }
const auth = createClient(config.supabaseUrl, config.supabaseAnonKey, { auth: { persistSession: false, autoRefreshToken: false } });
const store = (owner, token) => createSupabaseStore({ url: config.supabaseUrl, anonKey: config.supabaseAnonKey, token, owner });
const handler = createEncryptedHandler({ store, providers, authenticate: async (token) => {
  const { data, error } = await auth.auth.getUser(token); return error ? null : data.user?.id ?? null;
} });
http.createServer(handler).listen(Number(process.env.PORT || 3001), process.env.CHAT_HOST || '0.0.0.0', () => console.log('Chat server listening'));
