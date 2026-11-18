# Shared navigation and charcoal/green theme — 2026-11-17

## Preflight and scope

Read AGENTS, FEATURE_STATUS and SPEC. CHAT-06/UI-01 existed, but the sidebar lived inside Companion, so Today/Your goals and Missions had no menu. Inspected route wrappers, auth, shared styles, Today, Companion and Missions. Exact slice: share navigation and thread targeting across those screens; charcoal-gray surfaces, green accents and clearer hierarchy. User subsequently explicitly requested committing/pushing to main. Existing backend/auth/consent/pin APIs remain authoritative.

## Changes

- Extracted `Sidebar.tsx`, used by Companion and new `MainNavigation.tsx`. The latter provides a fixed phone Menu header and persistent wide-screen sidebar for Today and Missions. Your goals remains within Today; the Menu stays accessible while scrolling it.
- Reused owner-scoped thread listing and pin APIs. Route parameters open a chosen saved chat, a new chat or Settings chat. Parameters are reset between intents to avoid reopening a stale Settings/new-chat action.
- Shared charcoal background, elevated gray surfaces and green primary/selected states. Today has a concise header, paired actions and clear goal surfaces. Settings catalogue accurately describes the new theme. No new schema or provider changes.

## Verification

- `pnpm typecheck` — PASS.
- `pnpm lint` — PASS.
- `pnpm test` — 38 passed, zero failed, two disposable PostgreSQL suites skipped.
- Pixel 8 Expo Go — charcoal Today, green actions/calendar, fixed Menu and drawer containing pinned/recent chats observed. Selecting the pinned reading conversation from Today opened the correct transcript. Missions navigation and its fixed Menu were also verified; removed its redundant second title.
- `pnpm exec expo export --platform android --output-dir "$env:TEMP/alorun-gray-green-export"` — PASS.
- Focused Prettier check and `git diff --check` — PASS.
- Staged-file and exported-bundle check — no configured backend secrets found; public app keys distinguished from private keys. Typecheck also passed using the committed baseline configuration, without relying on the unrelated local `tsconfig.json` edit.

## Security, deployment and limitations

Navigation requests use existing authenticated ownership checks and owner-specific query keys. Pin semantics, history opt-in and encryption unchanged. No model use added by navigation. Local credentials/generated data are excluded from Git; the unrelated existing `tsconfig.json` edit is left untouched. No production deployment. Full wide-screen, scaled-font and screen-reader acceptance remain pending.
