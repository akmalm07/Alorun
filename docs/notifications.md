# Notification starter

`src/notifications/device.ts` asks for notification permission only when the user chooses to enable reminders, creates the Android channel, and obtains an Expo push token using an EAS project ID. Register the token through an authenticated API tied to the verified user and remove it on sign-out or opt-out. This registration API and token storage are not yet implemented. Remote push requires a configured EAS project, Android FCM credentials and a development/release build on a physical device; Expo Go is not sufficient for Android remote push.

`worker/notifications/push.ts` provides the send-time policy and Expo Push HTTP call. It checks the latest per-kind enabled setting, local quiet hours, and an atomic daily delivery claim before sending generic text. Equal quiet-hour endpoints mean quiet hours are disabled; all times are `HH:mm`. A claim must remain durable and unique across workers for `(user ID, reminder kind, local date)`. An accepted Expo ticket is not proof of delivery, and transport failures are marked unknown because retrying might duplicate a notification.

This is a building block, not a running scheduler. Before enabling reminders, implement an authenticated token/preferences API, durable claim/outcome repository, Graphile Worker scheduling and cancellation, receipt processing and stale-token removal. Fetch consent, token, timezone and preferences fresh immediately before each send. Define DST skip/repeat scheduling behavior and ensure opting out cancels or suppresses pending jobs. No personal content should enter notification payloads or logs.

Run the policy tests with `node --test worker/notifications/push.test.ts` on Node 22.18+ or 24+.
