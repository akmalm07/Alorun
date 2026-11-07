/** The worker receives a fresh preference snapshot immediately before each send. */
export interface Reminder {
  userId: string;
  token: string;
  kind: 'morning' | 'evening';
  timezone: string;
  enabled: boolean;
  /** HH:mm local time; equal values disable the quiet period. */
  quietStart: string;
  quietEnd: string;
}

export interface DeliveryStore {
  /** Atomically claim a unique (user, kind, local date) key; false means already claimed. */
  claim(key: string): Promise<boolean>;
  /** Persist the outcome. An unknown outcome must not be blindly retried. */
  finish(key: string, outcome: 'accepted' | 'rejected' | 'unknown'): Promise<void>;
}

export type PushResult = 'disabled' | 'quiet_hours' | 'duplicate' | 'accepted' | 'rejected' | 'unknown';

function minutes(value: string): number {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) throw new Error('Invalid quiet-hour time');
  const [hours, mins] = value.split(':').map(Number);
  return hours * 60 + mins;
}

export function localTime(date: Date, timezone: string): { day: string; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === name)?.value ?? '';
  return { day: `${part('year')}-${part('month')}-${part('day')}`, minute: Number(part('hour')) * 60 + Number(part('minute')) };
}

export function isQuietTime(minute: number, start: string, end: string): boolean {
  const from = minutes(start);
  const to = minutes(end);
  if (from === to) return false;
  return from < to ? minute >= from && minute < to : minute >= from || minute < to;
}

/** Expo accepts a ticket, not a delivery guarantee; receipts need separate processing. */
export async function pushReminder(
  reminder: Reminder,
  store: DeliveryStore,
  now: Date = new Date(),
  send: typeof fetch = fetch,
): Promise<PushResult> {
  if (!reminder.enabled) return 'disabled';
  const local = localTime(now, reminder.timezone);
  if (isQuietTime(local.minute, reminder.quietStart, reminder.quietEnd)) return 'quiet_hours';
  if (!/^(ExpoPushToken|ExponentPushToken)\[[^\]]+\]$/.test(reminder.token)) throw new Error('Invalid Expo push token');
  // JSON encoding keeps arbitrary user IDs from creating ambiguous keys.
  const key = JSON.stringify([reminder.userId, reminder.kind, local.day]);
  if (!await store.claim(key)) return 'duplicate';
  let outcome: 'accepted' | 'rejected' | 'unknown' = 'unknown';
  try {
    const response = await send('https://exp.host/--/api/v2/push/send', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to: reminder.token, title: 'Alorun', body: 'You have a check-in ready.', channelId: 'reminders' }),
    });
    if (!response.ok) outcome = response.status >= 500 || response.status === 429 ? 'unknown' : 'rejected';
    else {
      const payload: unknown = await response.json();
      if (typeof payload === 'object' && payload !== null && 'data' in payload) {
        const data = payload.data;
        if (typeof data === 'object' && data !== null && 'status' in data) {
          outcome = data.status === 'ok' ? 'accepted' : data.status === 'error' ? 'rejected' : 'unknown';
        }
      }
    }
  } catch {
    // A timeout may have occurred after Expo accepted the request. Do not blindly retry.
  }
  await store.finish(key, outcome);
  return outcome;
}
