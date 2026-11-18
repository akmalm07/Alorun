# Welcome and sign-in — 2026-11-17

- Features: AUTH-01, AUTH-02. Spec sections 5 and 10 call for welcome/sign-in and authenticated API access.
- Existing behavior: the welcome screen uses Supabase email OTP for both returning and new users; it did not explain that and surfaced provider errors directly. Google sign-in was absent. The local `EXPO_PUBLIC_SUPABASE_URL` contained `/rest/v1/`, causing the auth client to construct an invalid endpoint.
- Requested gap: make the email login path clear, diagnose the URL, and show a disabled Google sign-in placeholder. Acceptance: root URL accepted, path-bearing URL gives setup guidance, email code flow remains available, and Google control cannot initiate a request.
- Changes: corrected the ignored local `.env` URL, added client URL validation and setup guidance, clarified email sign-in, and added a disabled Google button. No OAuth or backend changes.
- Verification on base `77dc576` plus working-tree changes: `pnpm typecheck` and `pnpm lint` passed; `pnpm exec prettier --check src/mobile/auth.tsx src/mobile/client.ts` passed; `pnpm test` passed 35, skipped two PostgreSQL suites. The initial focused formatting check including README failed; README has existing formatting differences and was not reformatted wholesale. The corrected local URL was checked to have root path `/`.
- Remaining: restart Expo to load the local environment change. Live email delivery, Google OAuth, device accessibility and visual acceptance are unverified. No deployment performed.

## Logo welcome follow-up — 2026-11-17

- AUTH-01/AUTH-02: the prior welcome mixed sign-in with developer configuration details. The requested gap is a supplied-logo welcome with a drag transition and a separate sign-in view. Acceptance: left swipe or accessible tap opens email login and a disabled Google placeholder; no provider setup details on the welcome; existing account bootstrap stays intact.
- Added the supplied image as a bundled asset, an animated left-swipe and tap alternative, and a plain-language unavailable state when configuration is missing. Email OTP and the disabled Google placeholder reuse the existing flow. No authentication, privacy or cost changes.
- Verification: `pnpm typecheck`, `pnpm lint`, `pnpm exec prettier --check src/mobile/auth.tsx`, `git diff --check`, and `pnpm exec expo export --platform android --output-dir $env:TEMP/alorun-welcome-export` passed. The initial lint run failed on Metro's static asset require; a narrowly scoped exception fixed it. The export included the logo.
- Android device/emulator interaction, screen-reader behavior, visual appearance and live email remain unverified. Google OAuth is not implemented. No deployment performed.
