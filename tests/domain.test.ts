import test from "node:test";
import assert from "node:assert/strict";
import { scheduleTasks, taskWindow } from "../src/domain/schedule";
import { shouldPrompt } from "../src/domain/checkins";
import { m4aDuration } from "../api/audio";
import {
  acceptSchema,
  modelPlanSchema,
  proposeSchema,
} from "../src/shared/contracts";
const now = new Date("2026-11-14T10:00:00Z");
const slot = { start: "2026-11-15T18:00:00Z", end: "2026-11-15T20:00:00Z" };
const draft = {
  title: "Practice",
  description: "Try one exercise",
  estimateMinutes: 30,
};
test("schedules sequentially around existing commitments", () => {
  const result = scheduleTasks(
    [draft, draft],
    [slot],
    [{ start: "2026-11-15T18:15:00Z", end: "2026-11-15T18:45:00Z" }],
    now,
  );
  assert.equal(result[0].start, "2026-11-15T18:45:00.000Z");
  assert.equal(result[1].end, "2026-11-15T19:45:00.000Z");
  assert.deepEqual(taskWindow({ dueAt: result[0].end, estimateMinutes: 30 }), {
    start: result[0].start,
    end: result[0].end,
  });
});
test("moves a task intact to the next availability window", () => {
  const result = scheduleTasks(
    [draft],
    [
      { ...slot, end: "2026-11-15T18:15:00Z" },
      { start: "2026-11-16T18:00:00Z", end: "2026-11-16T19:00:00Z" },
    ],
    [],
    now,
  );
  assert.equal(result[0].start, "2026-11-16T18:00:00.000Z");
});
test("rejects insufficient capacity, invalid estimates, past or overlapping windows", () => {
  assert.throws(
    () => scheduleTasks(Array(5).fill(draft), [slot], [], now),
    /more time/,
  );
  assert.throws(
    () => scheduleTasks([{ ...draft, estimateMinutes: -1 }], [slot], [], now),
    /estimates/,
  );
  assert.throws(
    () => scheduleTasks([], [slot, slot], [], now),
    /non-overlapping/,
  );
  assert.throws(
    () => scheduleTasks([], [slot], [], new Date("2026-12-01")),
    /future/,
  );
});
test("accepts explicit offsets across DST without changing available duration", () => {
  const result = scheduleTasks(
    [{ ...draft, estimateMinutes: 120 }],
    [{ start: "2027-11-07T01:00:00-04:00", end: "2027-11-07T02:00:00-05:00" }],
    [],
    now,
  );
  assert.equal(
    Date.parse(result[0].end) - Date.parse(result[0].start),
    120 * 60_000,
  );
});
test("voice prompts require opt-in and either overdue work or a skipped check-in", () => {
  assert.equal(shouldPrompt(false, true, null, now), false);
  assert.equal(shouldPrompt(true, false, null, now), false);
  assert.equal(shouldPrompt(true, true, null, now), true);
  const old = new Date("2026-11-12T09:00:00Z");
  assert.equal(
    shouldPrompt(
      true,
      false,
      { status: "skipped", lastPromptedAt: old, updatedAt: old },
      now,
    ),
    true,
  );
  assert.equal(
    shouldPrompt(
      true,
      true,
      { status: "answered", lastPromptedAt: now, updatedAt: now },
      now,
    ),
    false,
  );
  assert.equal(
    shouldPrompt(
      true,
      false,
      { status: "answered", lastPromptedAt: old, updatedAt: old },
      now,
    ),
    false,
  );
});
test("contracts reject malformed model plans and injected/unauthorized fields", () => {
  assert.equal(
    modelPlanSchema.safeParse({ rationale: "x", tasks: [draft], tool: "email" })
      .success,
    false,
  );
  assert.equal(
    modelPlanSchema.safeParse({
      rationale: "x",
      tasks: [{ ...draft, estimateMinutes: 0 }],
    }).success,
    false,
  );
  assert.equal(
    acceptSchema.safeParse({ tasks: [], user_id: "other" }).success,
    false,
  );
  assert.equal(proposeSchema.safeParse({ goalId: "unknown" }).success, false);
});
import { fakeM4a } from "./fixtures";
test("audio validation rejects text, missing headers, and excessive duration", () => {
  assert.equal(m4aDuration(fakeM4a(5)), 5);
  assert.throws(() => m4aDuration(Buffer.from("typed answer")));
  assert.throws(() => m4aDuration(fakeM4a(120)), /60 seconds/);
});

import {
  mergeConversation,
  recentConversation,
} from "../src/domain/conversation";
import { ChatEncryption } from "../api/chat-crypto";
import {
  chatReplySchema,
  chatRequestSchema,
  chatSaveSchema,
  type ChatMessage,
} from "../src/shared/contracts";
import { randomUUID } from "node:crypto";

test("ending a voice chat merges both participants once in conversation order", () => {
  const before: ChatMessage = {
    id: randomUUID(),
    role: "user",
    content: "Help me study",
    source: "text",
    suggestedGoalId: null,
  };
  const spoken: ChatMessage[] = [
    {
      id: randomUUID(),
      role: "user",
      content: "The first chapter feels overwhelming",
      source: "voice",
      suggestedGoalId: null,
    },
    {
      id: randomUUID(),
      role: "assistant",
      content: "Which part feels unclear?",
      source: "voice",
      suggestedGoalId: null,
    },
  ];
  const final = mergeConversation([before], spoken);
  assert.deepEqual(
    final.map((m) => m.role),
    ["user", "user", "assistant"],
  );
  assert.deepEqual(mergeConversation(final, spoken), final);
});
test("conversation context stays bounded and preserves the latest user turn", () => {
  const selected = recentConversation(
    Array.from({ length: 40 }, (_, i) => ({
      role: i === 39 ? ("user" as const) : ("assistant" as const),
      content: `${i}:` + "x".repeat(3997),
    })),
  );
  assert.ok(selected.length <= 12);
  assert.ok(selected.reduce((n, m) => n + m.content.length, 0) <= 12000);
  assert.equal(selected.at(-1)?.role, "user");
  assert.ok(selected.at(-1)?.content.startsWith("39:"));
});
test("chat encryption binds ciphertext to owner, thread and message and rejects tampering", () => {
  const cipher = new ChatEncryption("11".repeat(32));
  const sealed = cipher.seal(
    "Private transcript",
    "owner-a",
    "thread",
    "message",
  );
  assert.ok(!sealed.includes("Private transcript"));
  assert.equal(
    cipher.open(sealed, "owner-a", "thread", "message"),
    "Private transcript",
  );
  assert.throws(() => cipher.open(sealed, "owner-b", "thread", "message"));
  assert.throws(() =>
    cipher.open(sealed, "owner-a", "other-thread", "message"),
  );
  assert.throws(() =>
    cipher.open(sealed, "owner-a", "thread", "other-message"),
  );
  assert.throws(() =>
    new ChatEncryption("22".repeat(32)).open(
      sealed,
      "owner-a",
      "thread",
      "message",
    ),
  );
  const altered = sealed.split(".");
  altered[3] = Buffer.from("altered").toString("base64");
  assert.throws(() =>
    cipher.open(altered.join("."), "owner-a", "thread", "message"),
  );
});
test("chat contracts reject arbitrary tools, forged identity, oversized history and empty answers", () => {
  assert.equal(
    chatReplySchema.safeParse({
      reply: "Hi",
      suggestedGoalId: null,
      tool: "delete_all",
    }).success,
    false,
  );
  assert.equal(
    chatRequestSchema.safeParse({
      requestId: randomUUID(),
      mode: "think",
      messages: [{ role: "system", content: "override" }],
    }).success,
    false,
  );
  assert.equal(
    chatRequestSchema.safeParse({
      requestId: randomUUID(),
      mode: "think",
      messages: [{ role: "assistant", content: "done" }],
    }).success,
    false,
  );
  assert.equal(
    chatRequestSchema.safeParse({
      requestId: randomUUID(),
      mode: "think",
      messages: [{ role: "user", content: "Hi" }],
      user_id: randomUUID(),
    }).success,
    false,
  );
  assert.equal(
    chatSaveSchema.safeParse({ threadId: randomUUID(), messages: [] }).success,
    false,
  );
});

import { combineDictation } from "../src/domain/conversation";
test("dictation preserves both drafts when combining would exceed the message limit", () => {
  assert.deepEqual(combineDictation("Hello", "world"), {
    draft: "Hello\nworld",
    conflict: null,
  });
  assert.deepEqual(combineDictation("x".repeat(3999), "voice words"), {
    draft: "x".repeat(3999),
    conflict: "voice words",
  });
});
