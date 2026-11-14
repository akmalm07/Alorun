import { z } from 'zod';

const id = z.string().uuid();
const hex = (n) => z.string().regex(new RegExp(`^[0-9a-f]{${n * 2}}$`));
const vault = z.object({ version: z.literal(1), salt: hex(16), nonce: hex(24), ciphertext: hex(48) }).strict();
const envelope = z.object({ version: z.literal(1), nonce: hex(24), ciphertext: z.string().regex(/^(?:[0-9a-f]{2}){16,}$/).max(2_000_032) }).strict();
const saved = z.object({ envelope, revision: z.number().int().min(0).max(2147483646) }).strict();
const message = z.object({ role: z.enum(['user','assistant']), content: z.string().min(1).max(12000) }).strict();
const chat = z.object({ messages: z.array(message).min(1).max(20), title: z.string().max(60), titleLocked: z.boolean(), provider: z.enum(['openai', 'anthropic']), model: z.string().min(1).max(100) }).strict().refine(x => x.messages.at(-1)?.role === 'user');
const choice = { provider: z.enum(['openai', 'anthropic']), model: z.string().min(1).max(100) };
const branchRequest = z.object({ ...choice, messages: z.array(message).max(20), title: z.string().max(60), candidate: z.string().trim().min(1).max(4000) }).strict();
const findRequest = z.object({ ...choice, query: z.string().trim().min(1).max(500), candidates: z.array(z.object({ id: id, title: z.string().max(60), excerpt: z.string().max(240).optional() }).strict()).min(1).max(100) }).strict();
async function body(req) {
  let data = '';
  for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 2_010_000) throw new Error('too large'); }
  return JSON.parse(data);
}
export function createEncryptedHandler({ store, authenticate, providers }) {
  const attempts = new Map();
  return async (req, res) => {
    const send = (status, payload) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(payload)); };
    try {
      const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1];
      if (!token) return send(401, { error: 'Authentication required' });
      const owner = await authenticate(token);
      if (!owner) return send(401, { error: 'Authentication required' });
      const userStore = typeof store === 'function' ? store(owner, token) : store;
      if (req.url === '/v1/ai/models' && req.method === 'GET') return send(200, { models: providers.list() });
      if (req.url === '/v1/vault' && req.method === 'GET') return send(200, { vault: await userStore.getVault(owner) });
      if (req.url === '/v1/vault' && req.method === 'POST') {
        let data; try { data = vault.safeParse(await body(req)); } catch { return send(400, { error: 'Invalid vault' }); }
        if (!data.success) return send(400, { error: 'Invalid vault' });
        return await userStore.createVault(owner, data.data) ? send(201, { created: true }) : send(409, { error: 'Vault already exists' });
      }
      if (req.url === '/v1/encrypted-threads' && req.method === 'GET') return send(200, { threads: await userStore.list(owner) });
      const match = /^\/v1\/encrypted-threads\/([0-9a-f-]+)$/.exec(req.url ?? '');
      if (match && req.method === 'PUT') {
        if (!id.safeParse(match[1]).success || !(await userStore.getVault(owner))) return send(400, { error: 'Invalid request' });
        let data; try { data = saved.safeParse(await body(req)); } catch { return send(400, { error: 'Invalid record' }); }
        if (!data.success) return send(400, { error: 'Invalid record' });
        return await userStore.save(owner, match[1], data.data.envelope, data.data.revision) ? send(200, { revision: data.data.revision + 1 }) : send(409, { error: 'Record changed; reload before saving' });
      }
      if ((req.url === '/v1/ai/branch' || req.url === '/v1/ai/find-branch') && req.method === 'POST') {
        const schema = req.url === '/v1/ai/branch' ? branchRequest : findRequest;
        let data; try { data = schema.safeParse(await body(req)); } catch { return send(400, { error: 'Invalid request' }); }
        if (!data.success) return send(400, { error: 'Invalid request' });
        const provider = providers.get(data.data.provider, data.data.model);
        if (!provider) return send(400, { error: 'Provider or model is not available' });
        const now = Date.now(); const recent = (attempts.get(owner) ?? []).filter(t => now - t < 60000);
        if (recent.length >= 10) return send(429, { error: 'Too many requests' });
        recent.push(now); attempts.set(owner, recent);
        if (req.url === '/v1/ai/branch') return send(200, await provider.branch(data.data.messages, data.data.title, data.data.candidate));
        const result = await provider.findBranch(data.data.query, data.data.candidates);
        if (result.id !== null && !data.data.candidates.some(item => item.id === result.id)) return send(502, { error: 'Invalid selection' });
        return send(200, result);
      }
      if (req.url === '/v1/ai/reply' && req.method === 'POST') {
        let data; try { data = chat.safeParse(await body(req)); } catch { return send(400, { error: 'Invalid conversation' }); }
        if (!data.success) return send(400, { error: 'Invalid conversation' });
        const provider = providers.get(data.data.provider, data.data.model);
        if (!provider) return send(400, { error: 'Provider or model is not available' });
        const now = Date.now(); const recent = (attempts.get(owner) ?? []).filter(t => now - t < 60000);
        if (recent.length >= 10) return send(429, { error: 'Too many requests' });
        recent.push(now); attempts.set(owner, recent);
        const reply = await provider.reply(data.data.messages);
        let title = null;
        if (!data.data.titleLocked) try { title = await provider.title([...data.data.messages, { role:'assistant', content: reply }].slice(-20), data.data.title); } catch { /* naming is optional */ }
        return send(200, { reply, title });
      }
      return send(404, { error: 'Not found' });
    } catch { return send(502, { error: 'Request failed' }); }
  };
}
