# Sign-in and emulator QA — 2026-11-17

## Scope and preflight

AUTH-01/AUTH-02 already provided email OTP and profile bootstrap; the missing slice was reliable real-device sign-in, clear account entry and consistent identity. PLAN-01/PLAN-04 already provided Today and goal creation; retain those paths. INFRA-01/OPS-01 cover development schema and release verification. SPEC sections 5, 10, 12 and 15 apply. Acceptance: usable signed-out entry, real synthetic sign-in, profile/Today loading, goal creation, navigation and restored session; no credentials committed.

## Delivered

- Corrected stale Metro environment by restarting with cleared cache and LAN connectivity. Authentication configuration no longer depends on the separate application API URL.
- Added password login alongside existing email-code login/account creation, email/code validation, disabled pending fields, generic safe error messages and a 60-second resend cooldown. Google remains disabled.
- Reused the supplied logo on sign-in/Today; warm background and shared secondary controls now remain consistent through native navigation. Simplified Today entry actions and moved the separate encrypted-chat path below the core journey.
- Created a synthetic QA identity with existing admin tooling. Credentials are local only in ignored `.local/test-account.json`; no administrator key is placed in the app.
- Development database lacked `goal_checkin_preferences` and related migration `0002` objects. After explicit user authorization, applied the existing migration transactionally after checking all four new tables were absent and no embeddings existed. Historical tables already existed but **no Drizzle migration journal exists**. Did not fabricate historical journal records. Reconcile baseline before using automated migrations on this environment or releasing elsewhere.

## Verification

- `pnpm typecheck`, `pnpm lint`, focused Prettier check and `git diff --check`: PASS.
- `pnpm test`: 35 passed, zero failed, two PostgreSQL suites skipped (no disposable test URL supplied).
- `pnpm exec expo export --platform android --output-dir "$env:TEMP/alorun-release-check"`: PASS, logo included.
- `.local/provision-qa.mjs`: synthetic account created; real password authentication passed; profile POST returned 201. Initial Today GET returned 500, traced to missing table.
- `.local/apply-pending.mjs`: repository migration `0002` applied in one transaction to authorized development project.
- `.local/smoke.mjs`: Today, chat history and Missions returned HTTP 200 after migration.
- Pixel 8 Expo Go: sign-in screen enabled, real QA login reached Today, synthetic reading goal saved and appeared in list; Companion opened and accepted input.
- Full app reload restored the authenticated session and persisted reading goal. Missions loaded goal-specific suggestions; its runner is explicitly unavailable because worker configuration/deployment is not enabled. Returned to Today.
- Companion live request failed safely. Direct provider check returned HTTP 401 `invalid_api_key`. A valid backend key is required; user asked to update `.env`, never to paste it into chat.

## Release gaps

Not production-ready: live AI blocked by invalid key; real email-code delivery and resend still require acceptance, Google OAuth is a skeleton, disposable-DB suites were skipped, release-build/device/accessibility/security review and account export/deletion remain incomplete. No production deployment occurred. No change to tenant authorization or memory consent. One synthetic AI attempt made; no successful provider spend verified.

## Provider retry — same day

User updated `.env`. A direct check using its key passed for the configured model; the prior check inherited an older process key. Restarted the local API with explicit file-value precedence. The updated file also reintroduced `/rest/v1/` on the public Supabase URL; corrected it and verified fresh QA password authentication and API health (HTTP 200). Pixel 8 Companion successfully answered the synthetic reading-goal prompt with “Today, read just two pages of a book you enjoy.” This resolves the key blocker above for the tested request. Other release gaps remain. The key was pasted into chat by the user; advised rotation without repeating or committing it. No production deployment.
