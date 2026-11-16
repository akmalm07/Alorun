import { CronExpressionParser } from "cron-parser";
import { MissionError } from "./errors";
export function nextMissionRuns(
  cron: string,
  timezone: string,
  after: Date,
  count = 3,
): Date[] {
  try {
    if (cron.trim().split(/\s+/).length !== 5 || !/^[0-9*,/\-\s]+$/.test(cron))
      throw new Error();
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format(after);
    const expression = CronExpressionParser.parse(cron, {
      tz: timezone,
      currentDate: after,
    });
    const sample = Array.from({ length: Math.max(count, 32) }, () =>
      expression.next().toDate(),
    );
    if (
      sample.some(
        (date, index) =>
          index > 0 &&
          date.getTime() - sample[index - 1].getTime() < 15 * 60_000,
      )
    )
      throw new Error();
    return sample.slice(0, count);
  } catch {
    throw new MissionError(
      400,
      "Choose a valid five-field cron schedule, at least 15 minutes apart, and an IANA timezone.",
    );
  }
}
