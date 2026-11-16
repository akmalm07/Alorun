import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { nextMissionRuns } from "../api/missions/cron";
import {
  missionFolder,
  missionInputName,
  missionSuggestions,
} from "../src/domain/missions";
import {
  createMissionSchema,
  missionOutputSchema,
} from "../src/shared/missions";
import { createMissionsHandler } from "../api/missions/handler";

test("mission schedule uses local timezone through daylight-saving changes", () => {
  const runs = nextMissionRuns(
    "0 9 * * *",
    "America/New_York",
    new Date("2026-10-31T00:00:00Z"),
  );
  assert.equal(runs[0].toISOString(), "2026-10-31T13:00:00.000Z");
  assert.equal(runs[1].toISOString(), "2026-11-01T14:00:00.000Z");
  assert.equal(runs[2].toISOString(), "2026-11-02T14:00:00.000Z");
});
test("cron rejects seconds, overly frequent schedules, and invalid timezones", () => {
  const now = new Date("2026-11-16T00:00:00Z");
  for (const [cron, timezone] of [
    ["* * * * *", "UTC"],
    ["0 * * * * *", "UTC"],
    ["0 9 * * *", "Mars/Base"],
    ["0 28 * * *", "UTC"],
  ])
    assert.throws(() => nextMissionRuns(cron, timezone, now));
  assert.equal(nextMissionRuns("*/15 * * * *", "UTC", now).length, 3);
});
test("suggested missions are grounded in the specific goal and ready for review", () => {
  const goal = { id: randomUUID(), title: "Learn Spanish for my trip" };
  const suggestions = missionSuggestions([goal]);
  assert.equal(suggestions[0].goalId, goal.id);
  assert.equal(suggestions[0].kind, "practice");
  assert.ok(suggestions[0].instructions.includes(goal.title));
  assert.equal(suggestions[1].kind, "review");
});
test("storage scope rejects traversal, prefixes, encoded separators and foreign paths", () => {
  const owner = randomUUID(),
    mission = randomUUID();
  assert.equal(
    missionFolder(owner, mission, "practice"),
    `${owner}/missions/${mission}/practice`,
  );
  for (const folder of ["../other", "/root", "a/b", "a%2Fb", "A", "x\\y"])
    assert.throws(() => missionFolder(owner, mission, folder));
  for (const name of [
    "../secret.txt",
    "a/b.md",
    "x%2f.md",
    "document.html",
    "/absolute.txt",
  ])
    assert.throws(() => missionInputName(name));
  assert.equal(missionInputName("lesson-1.md"), "lesson-1.md");
});
test("mission creation requires explicit recurring approval; output cannot add tools", () => {
  const input = {
    id: randomUUID(),
    goalId: randomUUID(),
    title: "Study pack",
    instructions: "Prepare a small practice pack.",
    kind: "practice",
    cron: "0 9 * * *",
    timezone: "UTC",
    folder: "practice",
    enabled: true,
  };
  assert.equal(createMissionSchema.safeParse(input).success, false);
  assert.equal(
    createMissionSchema.safeParse({ ...input, approved: true }).success,
    true,
  );
  assert.equal(
    createMissionSchema.safeParse({
      ...input,
      approved: true,
      user_id: randomUUID(),
    }).success,
    false,
  );
  assert.equal(
    missionOutputSchema.safeParse({
      title: "Pack",
      summary: "Practice",
      markdown: "A useful exercise.",
      tool: "email",
    }).success,
    false,
  );
});
test("serverless handler authenticates before scheduling and accepts only bounded commands", async () => {
  const spawned: string[][] = [];
  const id = randomUUID();
  let executions = 0;
  const handler = createMissionsHandler(
    {
      dispatch: async () => [id],
      execute: async () => {
        executions++;
        return { processed: true };
      },
    },
    "a".repeat(64),
    (ids) => spawned.push(ids),
  );
  const request = (body: unknown, secret = "a".repeat(64)) =>
    new Request("https://example.test/missions", {
      method: "POST",
      headers: { "x-mission-secret": secret },
      body: JSON.stringify(body),
    });
  assert.equal(
    (await handler(request({ kind: "dispatch" }, "wrong"))).status,
    401,
  );
  assert.equal(spawned.length, 0);
  assert.equal(
    (await handler(request({ kind: "dispatch", userId: randomUUID() }))).status,
    400,
  );
  assert.equal((await handler(request({ kind: "dispatch" }))).status, 202);
  assert.deepEqual(spawned, [[id]]);
  assert.equal(
    (await handler(request({ kind: "run", runId: id }))).status,
    200,
  );
  assert.equal(executions, 1);
  assert.equal(
    (await handler(request({ kind: "run", runId: id, code: "arbitrary()" })))
      .status,
    400,
  );
});
