import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isQuietTime, localTime, pushReminder, type DeliveryStore, type Reminder } from './push.ts';

test('quiet hours span midnight and exclude their end', () => {
  assert.equal(isQuietTime(23 * 60, '22:00', '07:00'), true);
  assert.equal(isQuietTime(7 * 60, '22:00', '07:00'), false);
  assert.equal(isQuietTime(0, '00:00', '00:00'), false);
  assert.throws(() => isQuietTime(0, '25:00', '07:00'));
});

test('local time follows the DST transition', () => {
  assert.deepEqual(localTime(new Date('2026-03-08T06:59:00Z'), 'America/New_York'), { day: '2026-03-08', minute: 119 });
  assert.deepEqual(localTime(new Date('2026-03-08T07:00:00Z'), 'America/New_York'), { day: '2026-03-08', minute: 180 });
});

test('send respects preferences and claims only once per local day', async () => {
  const claimed = new Set<string>();
  const store: DeliveryStore = { async claim(key) { if (claimed.has(key)) return false; claimed.add(key); return true; }, async finish() {} };
  let calls = 0;
  const send: typeof fetch = async () => { calls++; return new Response(JSON.stringify({ data: { status: 'ok' } })); };
  const reminder: Reminder = { userId: 'u1', token: 'ExpoPushToken[example]', kind: 'morning', timezone: 'UTC', enabled: true, quietStart: '22:00', quietEnd: '07:00' };
  assert.equal(await pushReminder({ ...reminder, enabled: false }, store, new Date('2026-01-01T08:00:00Z'), send), 'disabled');
  assert.equal(await pushReminder(reminder, store, new Date('2026-01-01T06:00:00Z'), send), 'quiet_hours');
  assert.equal(await pushReminder(reminder, store, new Date('2026-01-01T08:00:00Z'), send), 'accepted');
  assert.equal(await pushReminder(reminder, store, new Date('2026-01-01T09:00:00Z'), send), 'duplicate');
  assert.equal(calls, 1);
});

test('a transport failure leaves an unknown outcome rather than retrying', async () => {
  let outcome = '';
  const store: DeliveryStore = { async claim() { return true; }, async finish(_key, value) { outcome = value; } };
  const result = await pushReminder({ userId: 'u', token: 'ExpoPushToken[example]', kind: 'evening', timezone: 'UTC', enabled: true, quietStart: '00:00', quietEnd: '00:00' }, store, new Date(), async () => { throw new Error('timeout'); });
  assert.equal(result, 'unknown');
  assert.equal(outcome, 'unknown');
});
