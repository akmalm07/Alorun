import test from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseStore } from '../server/supabase-store.mjs';

test('Supabase storage forwards the user token and scopes queries and revisions', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), method: init.method, headers: new Headers(init.headers), body: init.body });
    const data = init.method === 'GET' ? [] : init.method === 'PATCH' ? [{ id: 'record' }] : null;
    return new Response(data === null ? null : JSON.stringify(data), { status: init.method === 'POST' ? 201 : 200, headers: { 'Content-Type': 'application/json' } });
  };
  const store = createSupabaseStore({ url: 'https://example.supabase.co', anonKey: 'publishable-key', token: 'user-jwt', owner: 'owner-id', fetchImpl });
  assert.equal(await store.getVault('ignored'), null);
  assert.equal(await store.createVault('ignored', { version: 1 }), true);
  assert.deepEqual(await store.list('ignored'), []);
  assert.equal(await store.save('ignored', 'record', { version: 1 }, 2), true);
  for (const call of calls) assert.equal(call.headers.get('authorization'), 'Bearer user-jwt');
  assert.ok(calls[0].url.includes('user_id=eq.owner-id'));
  assert.equal(JSON.parse(calls[1].body).user_id, 'owner-id');
  assert.ok(calls[2].url.includes('user_id=eq.owner-id'));
  assert.ok(calls[3].url.includes('user_id=eq.owner-id'));
  assert.ok(calls[3].url.includes('revision=eq.2'));
  assert.equal(JSON.parse(calls[3].body).revision, 3);
});
