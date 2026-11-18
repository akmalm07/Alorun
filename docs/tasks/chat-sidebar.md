# Black theme and conversation sidebar — 2026-11-17

## Preflight and acceptance

Read AGENTS, FEATURE_STATUS and SPEC; inspected CHAT-01/02 Companion history/API, CHAT-03/04 encrypted vault and `makeBranch`, AUTH-02 settings foundations, existing contracts/schema/tests. Existing gap: Companion had one transcript, no sidebar, no visible branching and a long scrolling composer/settings layout. Spec sections 5, 9, 12, 17 and new section 23 apply. Acceptance: black app, bottom composer and branch control, recent/pinned navigation, manual pin precedence, real relevant settings controls, consent-safe persistence and owner isolation. No transcript-store replacement or graph-memory work.

## Delivered

- Black shared theme, native content background/status text and legacy encrypted-chat colors.
- Companion transcript with user bubbles, plain assistant responses, bounded bottom composer, Listen/Think/Plan, and optional voice tools using the existing capture/conversation hooks.
- Responsive sidebar/drawer: new chat, Today, Missions, Settings chat, recents and pinned chats. Existing `makeBranch` supplies fixed direct-parent snapshots. Saved metadata uses existing backend encryption; temporary chats stay temporary.
- Goal-linked auto-pin rule with visible explanation and permanent manual override until the user changes it.
- Explicitly labeled local Settings chat routes prompts to real history/check-in/account/Missions controls; prose never authorizes mutations. Unknown requests show the available catalogue.

## Verification and review

- Typecheck/lint passed after fixes. `pnpm test`: 38 passed, zero failed, two disposable-PostgreSQL suites skipped. Added settings/pin contract tests and database integration cases (the latter remain skipped without a disposable URL).
- `.local/verify-chat-threads.mjs`: real QA auth, encrypted recent-chat metadata, persisted manual pin, fixed snapshot history and HTTP rejection of forged branch context passed against the authorized development API/database.
- `.local/verify-chat-isolation.mjs`: foreign identity could not list, read or pin the QA conversations; passed with real development PostgreSQL.
- Independent review identified a transition/save race, list-consent race and redundant snapshot payloads. Fixed synchronous transition locks, generation/thread binding, captured saved-ID sets, consent lock on list, and minimal list payloads. Reviewer confirmed all must-fixes resolved by source inspection; no reviewer tests claimed.
- Pixel 8 Expo Go: black Today/chat, bottom Branch action, drawer with pinned/recent entries and manual pin labels, guided-settings disclosure and voice-settings-only response observed. No voice permission was requested by opening the settings guide.
- Final composer Branch tap opened a separate empty conversation with the fixed-parent-context explanation. Branching preserves an unsent draft. Android export to `$env:TEMP/alorun-black-chat-export` passed after final UI changes; a byte scan found no configured backend secret values in JavaScript/Hermes bundles (public app keys excluded). Focused Prettier check and `git diff --check` passed.

## Privacy, deployment and limits

Configured a backend-only development encryption key in ignored `.env` because history saving was previously unavailable. Existing keys are preserved. QA account opted into history for persistence tests; no other user's consent changed. No new processor, graph memory extraction or autonomous settings changes. No new schema migration. Existing encrypted vault remains separate; it is not merged silently.

No production deployment. Latest 100 created conversations and latest 60 saved messages per conversation are exposed. Old first-save branch snapshots outside the parent's recent 60 fail closed. Wide-screen layout, full screen-reader/large-text acceptance, live voice and production release remain unverified. Settings matching is deterministic and limited to the actual catalogue, not an open-ended LLM settings agent. See ADR 0006 for metadata compatibility and rollback.
