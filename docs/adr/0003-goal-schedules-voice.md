# 0003: Goal schedules and optional voice check-ins

The user requested AI-generated tasks, a calendar, and voice-only goal questions on app open. This brings voice forward from P2. Use the existing NestJS/PostgreSQL/OpenAI architecture; no new processor or calendar provider. The user confirmed an in-app agenda.

The model proposes task titles and estimates. Deterministic code allocates tasks sequentially inside explicit user-supplied availability windows, rejecting capacity overflow and conflicts. Explicit plan approval writes tasks atomically; task due_at is the scheduled finish, with start computed from estimate_minutes. Proposals keep their availability and accepted task IDs in existing proposal_json.

The user confirmed triggers are recorded skip events OR overdue goal tasks. Check-ins use explicit opt-in and those observable states, not a psychological inference. They can be dismissed and disabled. Voice is the sole answer input, with a visible recording control and contextual OS permission. Audio travels to the existing OpenAI provider for transcription; raw audio and transcripts stay transient, are never written to the memory graph or logs, and the UI explains this before recording. Only question/goal, state and timestamps persist. Recording is bounded and stops on background/unmount. External provider retention follows the account's OpenAI configuration; do not promise zero provider retention.

Alternatives: automatic calendar writes add OAuth and external side effects; forced microphone prompts make task access depend on hardware/permission. Both are unnecessary for the requested goal loop.

Migration adds tenant-owned check-in preferences/events with deny-by-default RLS and composite goal ownership. No historical data/backfill. Roll back app usage before dropping new tables via a separately reviewed migration. Existing goals/tasks remain intact. Deploy only after staging and an independent privacy/auth review. No production services accessed.
