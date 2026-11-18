import { threadMetaSchema } from "../src/shared/contracts";
import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { and, count, eq, sql } from "drizzle-orm";
import { Module } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { NestFactory } from "@nestjs/core";
import { createDatabase } from "../api/database";
import { GoalService } from "../api/service";
import { GoalController } from "../api/controller";
import { AuthGuard, AUTH_VERIFIER } from "../api/auth";
import type { AIProvider } from "../api/provider";
import * as tables from "../db/schema";
import { fakeM4a } from "./fixtures";
import { ChatService } from "../api/chat-service";
import { ChatController } from "../api/chat-controller";
import { ChatEncryption } from "../api/chat-crypto";
import type {
  ChatContext,
  ChatMode,
  ChatMessage,
  ChatSave,
} from "../src/shared/contracts";

const databaseUrl = process.env.TEST_DATABASE_URL;
test(
  "goal planning, isolation, approval races, voice checks and HTTP validation",
  { skip: !databaseUrl },
  async (t) => {
    assert.match(
      databaseUrl!,
      /alorun_test/,
      "Use a disposable database explicitly named alorun_test",
    );
    const { db, pool } = createDatabase(databaseUrl!);
    let now = new Date("2026-11-14T10:00:00Z");
    let fail = false;
    let questionCalls = 0;
    let planCalls = 0;
    let suggestion: string | null = null;
    let lastContext: ChatContext | undefined;
    let lastMode: ChatMode | undefined;
    let transcript = "I need a smaller step";
    const ai: AIProvider = {
      async chat(mode, _messages, context) {
        lastContext = context;
        lastMode = mode;
        return {
          data: {
            reply: "What would make the first step easier?",
            suggestedGoalId: suggestion,
          },
          input: 4,
          output: 4,
          cost: 0.001,
        };
      },
      async plan() {
        planCalls++;
        if (fail) throw new Error("provider failed");
        return {
          data: {
            rationale: "Start small",
            tasks: [
              {
                title: "Study a lesson",
                description: "Open lesson one",
                estimateMinutes: 30,
              },
            ],
          },
          input: 10,
          output: 10,
          cost: 0.001,
        };
      },
      async question(goal) {
        questionCalls++;
        return {
          data: `What would help with ${goal.title}?`,
          input: 4,
          output: 4,
          cost: 0.001,
        };
      },
      async transcribe() {
        return {
          data: transcript,
          input: 0,
          output: 0,
          cost: 0.001,
        };
      },
    };
    const service = new GoalService(db, ai, 50, () => now);
    const chat = new ChatService(
      db,
      ai,
      service,
      new ChatEncryption("11".repeat(32)),
    );
    async function saveFor(
      owner: string,
      input: Omit<ChatSave, "historyVersion">,
    ) {
      return chat.save(owner, {
        ...input,
        historyVersion: (await chat.history(owner)).historyVersion!,
      });
    }
    const userA = randomUUID();
    const userB = randomUUID();
    let app: NestExpressApplication | undefined;
    try {
      // Schema setup is only for a fresh throwaway database. A repeat run uses a new container.
      await pool.query(
        "CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key); CREATE SCHEMA extensions;",
      );
      await pool.query(
        await readFile("drizzle/0000_wet_moondragon.sql", "utf8"),
      );
      await pool.query(
        await readFile("drizzle/0002_conscious_hiroim.sql", "utf8"),
      );
      await pool.query("INSERT INTO auth.users(id) VALUES ($1), ($2)", [
        userA,
        userB,
      ]);
      await service.profile(userA, "America/New_York");
      await service.profile(userB, "UTC");
      const goal = await service.createGoal(userA, {
        id: randomUUID(),
        title: "Learn Spanish",
        motivation: "Travel",
      });
      const window = {
        start: "2026-11-15T18:00:00Z",
        end: "2026-11-15T20:00:00Z",
      };
      const input = {
        goalId: goal.id,
        requestId: randomUUID(),
        windows: [window],
      };
      const proposal = await service.propose(userA, input);
      const drafts = proposal.tasks.map(
        ({ title, description, estimateMinutes }) => ({
          title,
          description,
          estimateMinutes,
        }),
      );
      await t.test(
        "proposal creates no tasks; repeated proposal returns same plan",
        async () => {
          assert.equal((await service.today(userA)).tasks.length, 0);
          const repeated = await service.propose(userA, input);
          assert.equal(repeated.id, proposal.id);
          assert.equal(planCalls, 1);
        },
      );
      await t.test("tenant IDs never grant access", async () => {
        assert.equal((await service.today(userB)).proposals.length, 0);
        await assert.rejects(
          service.propose(userB, { ...input, requestId: randomUUID() }),
          /Goal not found/,
        );
        await assert.rejects(
          service.accept(userB, proposal.id, drafts),
          /Plan not found/,
        );
      });
      await t.test(
        "concurrent approval is idempotent and tasks appear on Today",
        async () => {
          const [a, b] = await Promise.all([
            service.accept(userA, proposal.id, drafts),
            service.accept(userA, proposal.id, drafts),
          ]);
          assert.deepEqual(a.taskIds, b.taskIds);
          const today = await service.today(userA);
          assert.equal(today.tasks.length, 1);
          assert.equal(today.proposals.length, 0);
          assert.equal(today.tasks[0].dueAt, "2026-11-15T18:30:00.000Z");
          await assert.rejects(
            service.taskStatus(userB, a.taskIds[0], "completed"),
            /Task not found/,
          );
        },
      );
      await t.test("distinct accepted plans cannot double book", async () => {
        const second = await service.propose(userA, {
          ...input,
          requestId: randomUUID(),
        });
        await service.accept(userA, second.id, drafts);
        const tasks = (await service.today(userA)).tasks;
        assert.equal(tasks.length, 2);
        assert.equal(tasks[1].dueAt, "2026-11-15T19:00:00.000Z");
      });
      await t.test(
        "provider failure leaves tasks unchanged and counts toward quota",
        async () => {
          fail = true;
          await assert.rejects(
            service.propose(userA, { ...input, requestId: randomUUID() }),
            /AI request failed/,
          );
          assert.equal((await service.today(userA)).tasks.length, 2);
          fail = false;
        },
      );
      await t.test(
        "no app-open question when disabled or when all work is future",
        async () => {
          assert.deepEqual(await service.openCheckin(userA, randomUUID()), {
            checkin: null,
          });
          await service.preferences(userA, true);
          assert.deepEqual(await service.openCheckin(userA, randomUUID()), {
            checkin: null,
          });
          assert.equal(questionCalls, 0);
        },
      );
      now = new Date("2026-11-16T10:00:00Z");
      const concurrent = await Promise.all(
        Array.from({ length: 3 }, () =>
          service.openCheckin(userA, randomUUID()),
        ),
      );
      const opened = concurrent.find((result) => result.checkin)!;
      const [questionUsage] = await db
        .select({ total: count() })
        .from(tables.usage_ledger)
        .where(
          and(
            eq(tables.usage_ledger.user_id, userA),
            eq(tables.usage_ledger.operation, "question"),
          ),
        );
      assert.equal(
        questionUsage.total,
        1,
        "No duplicate quota charge for simultaneous app opens",
      );
      assert.ok(opened.checkin);
      await t.test(
        "overdue tasks trigger one goal-specific question and cooldown",
        async () => {
          assert.match(opened.checkin!.question, /Spanish/);
          assert.deepEqual(await service.openCheckin(userA, randomUUID()), {
            checkin: null,
          });
          assert.equal(questionCalls, 1);
          await assert.rejects(
            service.skipCheckin(userB, opened.checkin!.id),
            /not found/,
          );
        },
      );
      await service.skipCheckin(userA, opened.checkin.id);
      const tasks = (await service.today(userA)).tasks;
      for (const task of tasks)
        await service.taskStatus(userA, task.id, "completed");
      now = new Date("2026-11-17T11:00:00Z");
      const followup = await service.openCheckin(userA, randomUUID());
      await t.test(
        "skipped check-in triggers even without overdue work; voice never completes tasks or writes memories",
        async () => {
          assert.ok(followup.checkin);
          await assert.rejects(
            service.answerVoice(userB, followup.checkin!.id, randomUUID(), {
              buffer: Buffer.from("fixture"),
              mimetype: "audio/mp4",
            }),
            /not found/,
          );
          await service.answerVoice(userA, followup.checkin!.id, randomUUID(), {
            buffer: Buffer.from("fixture"),
            mimetype: "audio/mp4",
          });
          const [memories] = await db
            .select({ total: count() })
            .from(tables.memory_nodes);
          assert.equal(memories.total, 0);
          const [row] = await db
            .select()
            .from(tables.goal_checkins)
            .where(eq(tables.goal_checkins.id, followup.checkin!.id));
          assert.equal(row.status, "answered");
          assert.ok(!JSON.stringify(row).includes("smaller step"));
          assert.equal((await service.today(userA)).tasks.length, 2);
        },
      );
      await t.test(
        "disabling check-ins prevents questions despite overdue work",
        async () => {
          now = new Date("2026-11-19T11:00:00Z");
          await service.taskStatus(userA, tasks[0].id, "pending");
          await service.preferences(userA, false);
          assert.deepEqual(await service.openCheckin(userA, randomUUID()), {
            checkin: null,
          });
        },
      );
      await t.test(
        "quota reservations serialize concurrent requests",
        async () => {
          const limited = new GoalService(db, ai, 1, () => now);
          const ownGoal = await service.createGoal(userB, {
            id: randomUUID(),
            title: "Read",
            motivation: "",
          });
          const results = await Promise.allSettled(
            Array.from({ length: 2 }, () =>
              limited.propose(userB, {
                goalId: ownGoal.id,
                requestId: randomUUID(),
                windows: [
                  {
                    start: "2026-11-20T18:00:00Z",
                    end: "2026-11-20T20:00:00Z",
                  },
                ],
              }),
            ),
          );
          assert.equal(
            results.filter((result) => result.status === "fulfilled").length,
            1,
          );
          assert.equal(
            results.filter((result) => result.status === "rejected").length,
            1,
          );
          const own = (await service.today(userB)).goals[0];
          await assert.rejects(
            limited.propose(userB, {
              goalId: own.id,
              requestId: randomUUID(),
              windows: [
                { start: "2026-11-20T18:00:00Z", end: "2026-11-20T20:00:00Z" },
              ],
            }),
            /Daily AI request limit/,
          );
        },
      );
      await t.test(
        "database rejects cross-tenant check-in relationships and defaults to RLS denial",
        async () => {
          await assert.rejects(
            db.insert(tables.goal_checkins).values({
              user_id: userB,
              goal_id: goal.id,
              question: "wrong tenant",
            }),
          );
          const flags = await pool.query(
            "SELECT relname, relrowsecurity FROM pg_class WHERE relname IN ('goal_checkins', 'goal_checkin_preferences')",
          );
          assert.ok(
            flags.rows.every(
              (r: { relrowsecurity: boolean }) => r.relrowsecurity,
            ),
          );
          await db.execute(
            sql`DO $$ BEGIN CREATE ROLE alorun_test_reader NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; GRANT USAGE ON SCHEMA public TO alorun_test_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO alorun_test_reader;`,
          );
          const client = await pool.connect();
          try {
            await client.query("SET ROLE alorun_test_reader");
            assert.equal(
              (await client.query("SELECT * FROM goal_checkins")).rows.length,
              0,
            );
          } finally {
            await client.query("RESET ROLE");
            client.release();
          }
        },
      );
      await t.test(
        "chat grounds replies in owned tasks and never executes suggested actions",
        async () => {
          suggestion = goal.id;
          const before = (await service.today(userA)).tasks;
          const result = await chat.reply(userA, {
            requestId: randomUUID(),
            mode: "plan",
            messages: [
              { role: "user", content: "Help me prepare for my trip" },
            ],
          });
          assert.equal(result.suggestedGoalId, goal.id);
          assert.equal(lastMode, "plan");
          assert.ok(lastContext?.goals.every((g) => g.id === goal.id));
          assert.ok(
            lastContext?.tasks.every((task) =>
              before.some((t) => t.id === task.id),
            ),
          );
          assert.deepEqual((await service.today(userA)).tasks, before);
          assert.equal(
            (
              await chat.reply(userB, {
                requestId: randomUUID(),
                mode: "plan",
                messages: [{ role: "user", content: "Help me" }],
              })
            ).suggestedGoalId,
            null,
          );
          assert.ok(lastContext?.goals.every((g) => g.id !== goal.id));
          assert.equal(
            (
              await chat.reply(userA, {
                requestId: randomUUID(),
                mode: "listen",
                messages: [
                  { role: "user", content: "Just listen, I feel overwhelmed" },
                ],
              })
            ).suggestedGoalId,
            null,
          );
        },
      );
      await t.test(
        "dictation returns text without persisting audio, transcript or memories",
        async () => {
          const value = await chat.transcribe(userA, randomUUID(), {
            buffer: Buffer.from("fixture"),
            mimetype: "audio/mp4",
          });
          assert.equal(value.text, transcript);
          assert.equal(
            (await db.select().from(tables.chat_messages)).length,
            0,
          );
          assert.equal((await db.select().from(tables.memory_nodes)).length, 0);
          transcript = " ";
          await assert.rejects(
            chat.transcribe(userA, randomUUID(), {
              buffer: Buffer.from("fixture"),
              mimetype: "audio/mp4",
            }),
            /No speech/,
          );
          transcript = "I need a smaller step";
        },
      );
      const savedThread = randomUUID();
      const voiceMessages: ChatMessage[] = [
        {
          id: randomUUID(),
          role: "user",
          content: "I need help with my lesson",
          source: "voice",
          suggestedGoalId: null,
        },
        {
          id: randomUUID(),
          role: "assistant",
          content: "Which part would you like to work through?",
          source: "voice",
          suggestedGoalId: goal.id,
        },
      ];
      await t.test(
        "history is off by default; saving requires explicit consent and encryption",
        async () => {
          assert.equal((await chat.history(userA)).saveHistory, false);
          assert.deepEqual(
            await saveFor(userA, {
              threadId: savedThread,
              messages: voiceMessages,
            }),
            { saved: false },
          );
          assert.equal(
            (await db.select().from(tables.chat_messages)).length,
            0,
          );
          const unconfigured = new ChatService(db, ai, service, null);
          await assert.rejects(
            unconfigured.settings(userA, true),
            /not configured/,
          );
          await chat.settings(userA, true);
        },
      );
      await t.test(
        "finalized voice transcript saves both sides encrypted, in order and idempotently",
        async () => {
          await Promise.all([
            saveFor(userA, {
              threadId: savedThread,
              messages: voiceMessages,
            }),
            saveFor(userA, {
              threadId: savedThread,
              messages: voiceMessages,
            }),
          ]);
          const rows = await db
            .select()
            .from(tables.chat_messages)
            .where(eq(tables.chat_messages.user_id, userA));
          assert.equal(rows.length, 2);
          assert.ok(
            rows.every((row) => !row.content_protected.includes("lesson")),
          );
          assert.deepEqual((await chat.history(userA)).messages, voiceMessages);
          await assert.rejects(
            saveFor(userA, {
              threadId: savedThread,
              messages: [{ ...voiceMessages[0], content: "overwrite" }],
            }),
            /cannot be overwritten/,
          );
        },
      );
      await t.test(
        "other users cannot read, append to or overwrite transcript IDs",
        async () => {
          await chat.settings(userB, true);
          assert.equal((await chat.history(userB)).messages.length, 0);
          await assert.rejects(
            saveFor(userB, {
              threadId: savedThread,
              messages: voiceMessages,
            }),
            /not found/,
          );
          await assert.rejects(
            saveFor(userB, {
              threadId: randomUUID(),
              messages: voiceMessages,
            }),
            /already in use/,
          );
          assert.deepEqual((await chat.history(userA)).messages, voiceMessages);
        },
      );
      await t.test(
        "history read fails closed with wrong encryption key",
        async () => {
          const wrong = new ChatService(
            db,
            ai,
            service,
            new ChatEncryption("22".repeat(32)),
          );
          await assert.rejects(wrong.history(userA), /temporarily unavailable/);
        },
      );
      await t.test(
        "opting out suppresses saved reads and every new write while memory remains off",
        async () => {
          await chat.settings(userA, false);
          assert.equal((await chat.history(userA)).messages.length, 0);
          assert.deepEqual(
            await saveFor(userA, {
              threadId: savedThread,
              messages: [{ ...voiceMessages[0], id: randomUUID() }],
            }),
            { saved: false },
          );
          assert.equal(
            (
              await db
                .select()
                .from(tables.chat_messages)
                .where(eq(tables.chat_messages.user_id, userA))
            ).length,
            2,
          );
          const [privacy] = await db
            .select()
            .from(tables.privacy_settings)
            .where(eq(tables.privacy_settings.user_id, userA));
          assert.equal(privacy.persistent_memory_enabled, false);
          await chat.settings(userA, true);
        },
      );
      await t.test(
        "clearing deletes only this user chat and leaves goals/tasks intact",
        async () => {
          await chat.clear(userB);
          assert.equal((await chat.history(userA)).messages.length, 2);
          await chat.clear(userA);
          assert.equal((await chat.history(userA)).messages.length, 0);
          assert.equal((await service.today(userA)).tasks.length, 2);
        },
      );
      @Module({
        controllers: [GoalController, ChatController],
        providers: [
          { provide: GoalService, useValue: service },
          { provide: ChatService, useValue: chat },
          AuthGuard,
          {
            provide: AUTH_VERIFIER,
            useValue: {
              async verify(token: string) {
                return token === "fixture" ? userA : null;
              },
            },
          },
        ],
      })
      class TestModule {}
      app = await NestFactory.create<NestExpressApplication>(TestModule, {
        bodyParser: false,
        logger: ["error"],
        abortOnError: false,
      });
      app.useBodyParser("json", { limit: "2mb" });
      await app.listen(0, "127.0.0.1");
      const base = await app.getUrl();
      await t.test(
        "HTTP rejects missing auth, forged ownership, and typed voice answers",
        async () => {
          assert.equal((await fetch(`${base}/v1/today`)).status, 401);
          const headers = {
            Authorization: "Bearer fixture",
            "Content-Type": "application/json",
          };
          assert.equal(
            (
              await fetch(`${base}/v1/plans/propose`, {
                method: "POST",
                headers,
                body: JSON.stringify({ ...input, user_id: userB }),
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await fetch(`${base}/v1/checkins/${opened.checkin!.id}/voice`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                  requestId: randomUUID(),
                  answer: "typed",
                }),
              })
            ).status,
            400,
          );
          assert.equal((await fetch(`${base}/v1/chat/history`)).status, 401);
          assert.equal(
            (
              await fetch(`${base}/v1/chat/reply`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                  requestId: randomUUID(),
                  mode: "think",
                  messages: [{ role: "user", content: "Hi" }],
                  user_id: userB,
                }),
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await fetch(`${base}/v1/chat/transcribe`, {
                method: "POST",
                headers,
                body: JSON.stringify({
                  requestId: randomUUID(),
                  text: "typed",
                }),
              })
            ).status,
            400,
          );
          const chatResponse = await fetch(`${base}/v1/chat/reply`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              requestId: randomUUID(),
              mode: "think",
              messages: [{ role: "user", content: "Help me think" }],
            }),
          });
          assert.equal(chatResponse.status, 201);
          assert.equal(
            ((await chatResponse.json()) as { suggestedGoalId: string | null })
              .suggestedGoalId,
            null,
          );
          const response = await fetch(`${base}/v1/today`, { headers });
          assert.equal(response.status, 200);
          assert.equal(
            ((await response.json()) as { tasks: unknown[] }).tasks.length,
            2,
          );
        },
      );
      await t.test(
        "valid native audio upload returns editable text without saving a chat",
        async () => {
          const form = new FormData();
          form.append("requestId", randomUUID());
          form.append(
            "audio",
            new Blob([new Uint8Array(fakeM4a(2))], { type: "audio/mp4" }),
            "voice.m4a",
          );
          const before = (await db.select().from(tables.chat_messages)).length;
          const response = await fetch(`${base}/v1/chat/transcribe`, {
            method: "POST",
            headers: { Authorization: "Bearer fixture" },
            body: form,
          });
          assert.equal(response.status, 201);
          assert.deepEqual(await response.json(), { text: transcript });
          assert.equal(
            (await db.select().from(tables.chat_messages)).length,
            before,
          );
        },
      );
      await t.test(
        "HTTP accepts the bounded maximum transcript and saves every entry",
        async () => {
          const large = Array.from({ length: 60 }, (_, i) => ({
            id: randomUUID(),
            role: i % 2 === 0 ? "user" : "assistant",
            content: "x".repeat(4000),
            source: "voice",
            suggestedGoalId: null,
          }));
          const threadId = randomUUID();
          const response = await fetch(`${base}/v1/chat/history`, {
            method: "POST",
            headers: {
              Authorization: "Bearer fixture",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              threadId,
              messages: large,
              historyVersion: (await chat.history(userA)).historyVersion,
            }),
          });
          assert.equal(response.status, 201);
          assert.equal((await chat.history(userA)).messages.length, 60);
          const another = large
            .slice(0, 12)
            .map((message) => ({ ...message, id: randomUUID() }));
          await saveFor(userA, {
            threadId,
            messages: another as ChatMessage[],
          });
          assert.equal(
            (
              await db
                .select()
                .from(tables.chat_messages)
                .where(eq(tables.chat_messages.user_id, userA))
            ).length,
            72,
          );
        },
      );
      await t.test(
        "thread metadata is encrypted, tenant-isolated, and manual pins survive new turns",
        async () => {
          const id = randomUUID();
          const first: ChatMessage = {
            id: randomUUID(),
            role: "user",
            content: "Private topic title",
            source: "text",
            suggestedGoalId: null,
          };
          const version = (await chat.history(userA)).historyVersion!;
          await chat.save(userA, {
            threadId: id,
            historyVersion: version,
            messages: [first],
            metadata: threadMetaSchema.parse({ title: "Private topic title" }),
          });
          const [row] = await db
            .select()
            .from(tables.chat_threads)
            .where(eq(tables.chat_threads.id, id));
          assert.ok(row.title?.startsWith("protected:"));
          assert.ok(!row.title?.includes("Private topic title"));
          await assert.rejects(chat.pin(userB, id, "pinned"), /not found/);
          assert.equal(
            (await chat.threads(userB)).threads.some((t) => t.id === id),
            false,
          );
          assert.equal((await chat.history(userB, id)).messages.length, 0);
          await chat.pin(userA, id, "unpinned");
          const reply: ChatMessage = {
            id: randomUUID(),
            role: "assistant",
            content: "Review your goal",
            source: "text",
            suggestedGoalId: goal.id,
          };
          await chat.save(userA, {
            threadId: id,
            historyVersion: version,
            messages: [reply],
          });
          const meta = (await chat.threads(userA)).threads.find(
            (t) => t.id === id,
          )!;
          assert.equal(meta.manualPin, "unpinned");
          assert.equal(meta.autoPin, true);
          const branchId = randomUUID();
          const snapshot = [{ role: first.role, content: first.content }];
          await chat.save(userA, {
            threadId: branchId,
            historyVersion: version,
            messages: [
              { ...first, id: randomUUID(), content: "Branch direction" },
            ],
            metadata: threadMetaSchema.parse({
              title: "Branch",
              parentId: id,
              parentSnapshot: snapshot,
            }),
          });
          assert.deepEqual(
            (
              (await chat.history(userA, branchId)) as {
                metadata?: { parentSnapshot: unknown };
              }
            ).metadata?.parentSnapshot,
            snapshot,
          );
          await chat.settings(userB, true);
          await assert.rejects(
            chat.save(userB, {
              threadId: randomUUID(),
              historyVersion: (await chat.history(userB)).historyVersion!,
              messages: [{ ...first, id: randomUUID() }],
              metadata: threadMetaSchema.parse({
                title: "Forged branch",
                parentId: id,
                parentSnapshot: snapshot,
              }),
            }),
          );
          await assert.rejects(
            chat.save(userA, {
              threadId: randomUUID(),
              historyVersion: version,
              messages: [{ ...first, id: randomUUID() }],
              metadata: threadMetaSchema.parse({
                title: "Forged context",
                parentId: id,
                parentSnapshot: [
                  { role: "assistant", content: "not in parent" },
                ],
              }),
            }),
            /snapshot/,
          );
        },
      );
      await t.test(
        "clearing fences old queued writes so deleted transcripts cannot reappear",
        async () => {
          const version = (await chat.history(userA)).historyVersion!;
          await chat.clear(userA);
          await assert.rejects(
            chat.save(userA, {
              threadId: randomUUID(),
              historyVersion: version,
              messages: voiceMessages,
            }),
            /history changed/,
          );
          assert.equal((await chat.history(userA)).messages.length, 0);
          assert.equal(
            (
              await db
                .select()
                .from(tables.chat_messages)
                .where(eq(tables.chat_messages.user_id, userA))
            ).length,
            0,
          );
        },
      );
    } finally {
      if (app) await app.close();
      await pool.end();
    }
  },
);
