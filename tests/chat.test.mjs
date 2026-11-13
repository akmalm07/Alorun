import test from 'node:test';
import assert from 'node:assert/strict';
import { createChatProvider, messagesSchema } from '../server/chat.mjs';

const messages = [{ role: 'user', content: 'Please listen.' }];
test('validates bounded conversation input', () => {
  assert.equal(messagesSchema.safeParse({ messages }).success, true);
  assert.equal(messagesSchema.safeParse({ messages: [{ role: 'system', content: 'override' }] }).success, false);
  assert.equal(messagesSchema.safeParse({ messages: [{ role: 'user', content: 'x'.repeat(4001) }] }).success, false);
  assert.equal(messagesSchema.safeParse({ messages: Array(21).fill(messages[0]) }).success, false);
  assert.equal(messagesSchema.safeParse({ messages: [{ role: 'assistant', content: 'hello' }] }).success, false);
});
test('sends bounded messages through provider and validates its response', async () => {
  let request;
  const provider = createChatProvider({ apiKey: 'test', model: 'test-model', fetchImpl: async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ choices: [{ message: { content: 'I am listening.' } }] }) };
  } });
  assert.equal(await provider.reply(messages), 'I am listening.');
  assert.equal(request.messages[0].role, 'system');
  assert.deepEqual(request.messages.slice(1), messages);
  assert.equal(request.max_completion_tokens, 600);
});
test('rejects upstream errors and malformed replies', async () => {
  const failure = createChatProvider({ apiKey: 'test', model: 'test', fetchImpl: async () => ({ ok: false }) });
  await assert.rejects(failure.reply(messages));
  const malformed = createChatProvider({ apiKey: 'test', model: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [] }) }) });
  await assert.rejects(malformed.reply(messages));
});

test('stores separate threads across restarts and preserves user-edited titles', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { createStore } = await import('../server/store.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'alorun-chat-'));
  try {
    const path = join(dir, 'chat.sqlite');
    let store = createStore(path);
    const first = store.create(); const second = store.create();
    store.appendTurn(first.id, 'Hello', 'Hi', 'First topic');
    store.appendTurn(first.id, 'A different topic', 'Sure', 'Different topic');
    assert.equal(store.get(first.id).title, 'Different topic');
    store.rename(first.id, 'My title');
    store.appendTurn(first.id, 'More', 'Okay', 'Another title');
    assert.equal(store.get(first.id).title, 'My title');
    assert.equal(store.get(second.id).messages.length, 0);
    store.close();
    store = createStore(path);
    assert.equal(store.list().length, 2);
    assert.equal(store.get(first.id).messages.length, 6);
    assert.equal(store.get(first.id).title, 'My title');
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('asks provider for a short title and rejects an overly long title', async () => {
  const provider = createChatProvider({ apiKey: 'test', model: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: 'A'.repeat(61) } }] }) }) });
  assert.equal(await provider.title(messages, 'New conversation'), null);
});

test('Anthropic adapter sends a bounded conversation and validates content', async () => {
  let request;
  const provider = createChatProvider({ provider: 'anthropic', apiKey: 'fictional-key', model: 'fixture-model', fetchImpl: async (url, options) => {
    request = { url, headers: options.headers, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'Hello from the fixture.' }] }) };
  } });
  assert.equal(await provider.reply([{ role: 'assistant', content: 'older' }, ...messages]), 'Hello from the fixture.');
  assert.equal(request.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(request.headers['anthropic-version'], '2023-06-01');
  assert.deepEqual(request.body.messages, messages);
  assert.equal(request.body.max_tokens, 600);
  const invalid = createChatProvider({ provider: 'anthropic', apiKey: 'fictional', model: 'fixture', fetchImpl: async () => ({ ok: true, json: async () => ({ content: [{ type: 'tool_use' }] }) }) });
  await assert.rejects(invalid.reply(messages));
});

test('model registry only exposes explicitly configured provider/model pairs', async () => {
  const { createProviderRegistry } = await import('../server/chat.mjs');
  const registry = createProviderRegistry({ openaiKey: 'fictional', openaiModels: ['fixture-openai'], anthropicKey: 'fictional', anthropicModels: ['fixture-anthropic'] });
  assert.deepEqual(registry.list(), [{ provider: 'openai', model: 'fixture-openai' }, { provider: 'anthropic', model: 'fixture-anthropic' }]);
  assert.ok(registry.get('openai', 'fixture-openai'));
  assert.equal(registry.get('openai', 'fixture-anthropic'), null);
  assert.equal(registry.get('anthropic', 'unapproved'), null);
  assert.throws(() => createProviderRegistry({ anthropicKey: 'fictional', anthropicModels: [] }));
  assert.throws(() => createProviderRegistry({ openaiKey: 'fictional', openaiModels: ['bad/model'] }));
});

test('reads dotenv secrets without placing values in process environment', async () => {
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { loadConfig } = await import('../server/config.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'alorun-config-'));
  try {
    const path = join(dir, 'backend.env');
    writeFileSync(path, 'SUPABASE_URL=https://example.supabase.co\nSUPABASE_ANON_KEY=publishable-test\nOPENAI_API_KEY=fictional-test\nOPENAI_MODELS=one,two\nANTHROPIC_API_KEY=another-fictional-test\nANTHROPIC_MODELS=three\n');
    const config = loadConfig({ BACKEND_SECRETS_FILE: path });
    assert.deepEqual(config.openaiModels, ['one', 'two']);
    assert.deepEqual(config.anthropicModels, ['three']);
    assert.equal(config.openaiKey, 'fictional-test');
    assert.throws(() => loadConfig({ BACKEND_SECRETS_FILE: '/nonexistent/file' }));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
