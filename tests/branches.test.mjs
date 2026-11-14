import test from 'node:test';
import assert from 'node:assert/strict';
import { makeBranch, contextFor, flattenThreads } from '../chat/branches.mjs';
import { createChatProvider } from '../server/chat.mjs';

const message = content => ({ role: 'user', content });
const thread = (id, messages = [], parentId = null, parentSnapshot = []) => ({ id, title: id, titleLocked: false, revision: 1, messages, parentId, parentSnapshot });
test('nested branches use only a fixed snapshot of the immediate parent and their own messages', () => {
  const root = thread('root', [message('root at fork')]);
  const child = makeBranch(root, 'child', 'child topic');
  root.messages[0].content = 'edited later'; root.messages.push(message('later root'));
  child.messages.push(message('child own'));
  const grandchild = makeBranch(child, 'grandchild');
  const sibling = makeBranch(root, 'sibling'); sibling.messages.push(message('sibling private'));
  assert.deepEqual(contextFor(child, message('next')).map(m => m.content), ['root at fork', 'child own', 'next']);
  assert.deepEqual(contextFor(grandchild, message('next')).map(m => m.content), ['child own', 'next']);
  assert.ok(!contextFor(grandchild, message('next')).some(m => m.content.includes('root') || m.content.includes('sibling')));
  assert.equal(contextFor(thread('long', Array.from({ length: 30 }, (_, i) => message(String(i)))), message('next')).length, 20);
});
test('navigation flattens nested threads and keeps orphaned or cyclic records accessible', () => {
  const rows = flattenThreads([thread('root'), thread('child', [], 'root'), thread('grandchild', [], 'child'), thread('orphan', [], 'missing'), thread('cycle1', [], 'cycle2'), thread('cycle2', [], 'cycle1')]);
  assert.deepEqual(rows.slice(0, 3).map(row => [row.thread.id, row.depth, row.rootId]), [['root', 0, 'root'], ['child', 1, 'root'], ['grandchild', 2, 'root']]);
  assert.equal(new Set(rows.map(row => row.thread.id)).size, 6);
});
test('AI branch decision and search validate output and reject an unknown branch ID', async () => {
  const results = ['{"branch":true,"title":"Tech jobs"}', '{"id":"11111111-1111-4111-8111-111111111111"}', '{"id":"22222222-2222-4222-8222-222222222222"}', 'not json'];
  const provider = createChatProvider({ apiKey: 'test', model: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: results.shift() } }] }) }) });
  assert.deepEqual(await provider.branch([message('jobs')], 'Jobs', 'tech jobs'), { branch: true, title: 'Tech jobs' });
  const candidates = [{ id: '11111111-1111-4111-8111-111111111111', title: 'Tech jobs' }];
  assert.equal((await provider.findBranch('technology', candidates)).id, candidates[0].id);
  await assert.rejects(provider.findBranch('technology', candidates));
  await assert.rejects(provider.branch([], 'Jobs', 'technology'));
});

test('parent link and snapshot survive encrypted storage without appearing in the envelope', async () => {
  const { randomBytes } = await import('node:crypto');
  const { encryptRecord, decryptRecord } = await import('../security/vault.mjs');
  const key = new Uint8Array(randomBytes(32));
  const parent = thread('parent-id', [message('private parent topic')]);
  const child = makeBranch(parent, 'branch-id', 'private branch title');
  const envelope = encryptRecord(key, 'account', 'thread', child.id, JSON.stringify(child), n => new Uint8Array(randomBytes(n)));
  assert.ok(!JSON.stringify(envelope).includes('private parent topic'));
  assert.ok(!JSON.stringify(envelope).includes('parent-id'));
  const restored = JSON.parse(decryptRecord(key, 'account', 'thread', child.id, envelope));
  assert.deepEqual(restored, child);
  key.fill(0);
});
