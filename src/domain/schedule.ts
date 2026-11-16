import type { ScheduledTask, TaskDraft, Window } from "../shared/contracts";

export class ScheduleError extends Error {}

/** Windows are explicit UTC instants selected on-device in the user's local timezone. */
export function scheduleTasks(
  drafts: TaskDraft[],
  windows: Window[],
  busy: Window[],
  now: Date,
): ScheduledTask[] {
  const ranges = windows
    .map((w) => ({ start: Date.parse(w.start), end: Date.parse(w.end) }))
    .sort((a, b) => a.start - b.start);
  if (
    !ranges.length ||
    ranges.some(
      (w, i) =>
        !Number.isFinite(w.start) ||
        !Number.isFinite(w.end) ||
        w.start < now.getTime() ||
        w.end <= w.start ||
        w.end - w.start > 8 * 3600_000 ||
        (i > 0 && w.start < ranges[i - 1].end),
    )
  ) {
    throw new ScheduleError(
      "Choose future, non-overlapping availability windows of at most eight hours.",
    );
  }
  const occupied = busy
    .map((w) => ({ start: Date.parse(w.start), end: Date.parse(w.end) }))
    .sort((a, b) => a.start - b.start);
  let cursor = ranges[0].start;
  return drafts.map((draft) => {
    const duration = draft.estimateMinutes * 60_000;
    if (
      !Number.isInteger(draft.estimateMinutes) ||
      duration < 5 * 60_000 ||
      duration > 240 * 60_000
    ) {
      throw new ScheduleError(
        "Task estimates must be between 5 and 240 minutes.",
      );
    }
    for (const range of ranges) {
      let start = Math.max(cursor, range.start);
      for (const block of occupied) {
        if (start + duration <= block.start) break;
        if (start < block.end && start + duration > block.start)
          start = block.end;
      }
      if (start + duration <= range.end) {
        cursor = start + duration;
        return {
          ...draft,
          start: new Date(start).toISOString(),
          end: new Date(cursor).toISOString(),
        };
      }
    }
    throw new ScheduleError(
      "The plan needs more time than your available slots. Reduce tasks or add availability.",
    );
  });
}

export function taskWindow(task: {
  dueAt: string | null;
  estimateMinutes: number | null;
}): Window | null {
  if (!task.dueAt || !task.estimateMinutes) return null;
  return {
    start: new Date(
      Date.parse(task.dueAt) - task.estimateMinutes * 60_000,
    ).toISOString(),
    end: task.dueAt,
  };
}
