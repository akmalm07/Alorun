export type CheckinState = {
  status: "pending" | "skipped" | "answered";
  lastPromptedAt: Date;
  updatedAt: Date;
};

/** Cooldown prevents repeated foreground transitions becoming repeated interruptions. */
export function shouldPrompt(
  enabled: boolean,
  hasOverdueTask: boolean,
  state: CheckinState | null,
  now: Date,
): boolean {
  if (!enabled) return false;
  if (
    state &&
    now.getTime() -
      Math.max(state.lastPromptedAt.getTime(), state.updatedAt.getTime()) <
      24 * 3600_000
  )
    return false;
  return hasOverdueTask || state?.status === "skipped";
}
