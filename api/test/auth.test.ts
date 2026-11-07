import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { HttpException } from '@nestjs/common';
import { AuthService, bearer } from '../src/auth.service';

test('bearer requires exactly one token', () => {
  assert.equal(bearer('Bearer example'), 'example');
  for (const value of [undefined, '', 'Basic abc', 'Bearer ', 'Bearer a b']) {
    assert.throws(() => bearer(value), (error: unknown) => error instanceof HttpException && error.getStatus() === 401);
  }
});
test('validation rejects malformed credentials before contacting authentication provider', async () => {
  const service = new AuthService();
  for (const value of [{ email: 'bad', password: 'short' }, { email: 'a@example.com', password: 'long-enough', user_id: 'other' }, null]) {
    await assert.rejects(service.signIn(value), (error: unknown) => error instanceof HttpException && error.getStatus() === 400);
  }
});
test('authentication fails closed when not configured', async () => {
  const oldUrl = process.env.SUPABASE_URL;
  const oldKey = process.env.SUPABASE_ANON_KEY;
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_ANON_KEY;
  try {
    await assert.rejects(new AuthService().me('Bearer token'), (error: unknown) => error instanceof HttpException && error.getStatus() === 503);
  } finally {
    if (oldUrl !== undefined) process.env.SUPABASE_URL = oldUrl;
    if (oldKey !== undefined) process.env.SUPABASE_ANON_KEY = oldKey;
  }
});
