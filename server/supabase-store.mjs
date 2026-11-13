import { createClient } from '@supabase/supabase-js';

// User JWT is propagated to PostgREST so RLS applies; no service-role credential is used.
export function createSupabaseStore({ url, anonKey, token, owner, fetchImpl }) {
  const db = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` }, ...(fetchImpl ? { fetch: fetchImpl } : {}) }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  function check(error) { if (error) throw new Error('Database operation failed'); }
  return {
    async getVault() {
      const { data, error } = await db.from('encrypted_vaults').select('envelope').eq('user_id', owner).maybeSingle(); check(error); return data?.envelope ?? null;
    },
    async createVault(_owner, envelope) {
      const { error } = await db.from('encrypted_vaults').insert({ user_id: owner, envelope });
      if (error?.code === '23505') return false; check(error); return true;
    },
    async list() {
      const { data, error } = await db.from('encrypted_threads').select('id,envelope,revision').eq('user_id', owner); check(error); return data;
    },
    async save(_owner, id, envelope, revision) {
      if (revision === 0) {
        const { error } = await db.from('encrypted_threads').insert({ user_id: owner, id, envelope, revision: 1 });
        if (error?.code === '23505') return false; check(error); return true;
      }
      const { data, error } = await db.from('encrypted_threads').update({ envelope, revision: revision + 1 }).eq('user_id', owner).eq('id', id).eq('revision', revision).select('id');
      check(error); return data.length === 1;
    },
  };
}
