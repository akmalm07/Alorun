import { readFileSync, statSync } from 'node:fs';
import { parse } from 'dotenv';

// The secret is read once at startup; restart/redeploy to use a new version.
export function loadConfig(env = process.env) {
  let secret = {};
  if (env.BACKEND_SECRETS_FILE) {
    if (statSync(env.BACKEND_SECRETS_FILE).size > 65536) throw new Error('Backend secrets file is too large');
    secret = parse(readFileSync(env.BACKEND_SECRETS_FILE));
  }
  const values = { ...secret, ...env };
  if (!values.SUPABASE_URL?.startsWith('https://') || !values.SUPABASE_ANON_KEY) throw new Error('Configure HTTPS Supabase URL and publishable key');
  const list = value => (value ?? '').split(',').map(item => item.trim()).filter(Boolean);
  return { supabaseUrl: values.SUPABASE_URL, supabaseAnonKey: values.SUPABASE_ANON_KEY, openaiKey: values.OPENAI_API_KEY, openaiModels: list(values.OPENAI_MODELS), anthropicKey: values.ANTHROPIC_API_KEY, anthropicModels: list(values.ANTHROPIC_MODELS) };
}
