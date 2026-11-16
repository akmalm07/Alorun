import "reflect-metadata";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { eq, count } from "drizzle-orm";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import * as t from "../db/schema";
import { RedactedErrors } from "../api/errors";
import { createDatabase } from "../api/database";
import { MissionsService } from "../api/missions/service";
import { MissionsController, MISSION_WAKE } from "../api/missions/controller";
import { AuthGuard, AUTH_VERIFIER } from "../api/auth";
import type { BucketDriver } from "../api/missions/storage";
import type { MissionContext, MissionModel } from "../api/missions/model";
import { createMissionSchema } from "../src/shared/missions";

class MemoryBucket implements BucketDriver {
  data = new Map<string, string>();
  keys: string[] = [];
  public = false;
  failWrites = false;
  readHook = async () => {};
  async assertPrivate() {
    if (this.public) throw new Error("public bucket");
  }
  async list(prefix: string) {
    return [...this.data]
      .filter(([key]) => key.startsWith(`${prefix}/`))
      .map(([key, content]) => ({
        name: key.slice(prefix.length + 1),
        size: content.length,
      }));
  }
  async read(key: string) {
    this.keys.push(key);
    await this.readHook();
    const value = this.data.get(key);
    if (value === undefined) throw new Error("not found");
    return value;
  }
  async write(key: string, content: string, upsert: boolean) {
    this.keys.push(key);
    if (this.failWrites) throw new Error("storage down");
    if (!upsert && this.data.has(key)) throw new Error("duplicate object");
    this.data.set(key, content);
  }
}
const source = process.env.TEST_DATABASE_URL;
test(
  "Missions real PostgreSQL execution and permission boundaries",
  { skip: !source },
  async (suite) => {
    const url = new URL(source!);
    assert.match(url.pathname, /^\/alorun_test[a-z0-9_]*$/);
    const databaseName = `alorun_test_missions_${randomUUID().slice(0, 8)}`;
    const control = new Pool({ connectionString: source! });
    await control.query(`CREATE DATABASE "${databaseName}"`);
    url.pathname = `/${databaseName}`;
    const { db, pool } = createDatabase(url.toString());
    let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined;
    let now = new Date("2026-11-16T13:00:00Z");
    let calls = 0;
    let failure = false;
    let hook = async () => {};
    let context: MissionContext | undefined;
    const bucket = new MemoryBucket();
    const model: MissionModel = {
      async generate(value) {
        calls++;
        context = value;
        await hook();
        if (failure) throw new Error("provider failed with private data");
        return {
          data: {
            title: "Spanish practice",
            summary: "A short practice pack is ready.",
            markdown: "Practice one greeting and answer three prompts.",
          },
          input: 10,
          output: 20,
          cost: 0.001,
        };
      },
    };
    const missions = new MissionsService(
      db,
      model,
      bucket,
      { bucket: "alorun-missions", runnerAvailable: true, dailyLimit: 50 },
      () => now,
    );
    const a = randomUUID(),
      b = randomUUID(),
      goalId = randomUUID(),
      otherGoalId = randomUUID();
    const definition = (id = randomUUID(), goal = goalId) =>
      createMissionSchema.parse({
        id,
        goalId: goal,
        title: "Daily Spanish practice",
        instructions: "Prepare a practice pack from my goal and lesson files.",
        kind: "practice",
        cron: "0 9 * * *",
        timezone: "America/New_York",
        folder: "spanish-practice",
        enabled: true,
        approved: true,
      });
    try {
      await pool.query(
        "CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid primary key); CREATE SCHEMA extensions;",
      );
      for (const path of [
        "drizzle/0000_wet_moondragon.sql",
        "drizzle/0002_conscious_hiroim.sql",
      ])
        await pool.query(await readFile(path, "utf8"));
      await pool.query("INSERT INTO auth.users(id) VALUES ($1),($2)", [a, b]);
      await db.insert(t.users_profile).values([
        { id: a, timezone: "America/New_York" },
        { id: b, timezone: "UTC" },
      ]);
      await db.insert(t.goals).values([
        { id: goalId, user_id: a, title: "Learn Spanish for my trip" },
        { id: otherGoalId, user_id: b, title: "Learn French" },
      ]);
      await db.insert(t.tasks).values({
        user_id: a,
        goal_id: goalId,
        title: "Finish lesson one",
        status: "completed",
      });
      const input = definition();
      const mission = await missions.create(a, input);
      await suite.test(
        "creation is approved, idempotent, goal-owned, and suggested from real goals",
        async () => {
          assert.equal((await missions.create(a, input)).id, mission.id);
          assert.equal(mission.nextRunAt, "2026-11-16T14:00:00.000Z");
          const list = await missions.list(a);
          assert.ok(
            list.suggestions.some(
              (item) =>
                item.goalId === goalId && item.instructions.includes("Spanish"),
            ),
          );
          await assert.rejects(
            missions.create(b, definition()),
            /Active goal not found/,
          );
          const offline = new MissionsService(
            db,
            model,
            null,
            {
              bucket: "alorun-missions",
              runnerAvailable: false,
              dailyLimit: 50,
            },
            () => now,
          );
          await assert.rejects(
            offline.create(a, definition()),
            /runner is unavailable/,
          );
          assert.equal(
            (await offline.create(a, { ...definition(), enabled: false }))
              .status,
            "paused",
          );
        },
      );
      await suite.test(
        "all user-facing operations reject another tenant mission",
        async () => {
          await assert.rejects(missions.detail(b, mission.id), /not found/);
          await assert.rejects(
            missions.setEnabled(b, mission.id, false),
            /not found/,
          );
          await assert.rejects(
            missions.enqueueManual(b, mission.id, randomUUID()),
            /not found/,
          );
          await assert.rejects(
            missions.putInput(b, mission.id, "lesson.md", "private"),
            /not found/,
          );
          await assert.rejects(
            missions.readInput(b, mission.id, "lesson.md"),
            /not found/,
          );
        },
      );
      await missions.putInput(a, mission.id, "lesson.md", "Hola means hello.");
      await suite.test(
        "cron dispatch coalesces missed ticks and is idempotent under concurrency",
        async () => {
          now = new Date("2026-11-18T15:00:00Z");
          const [left, right] = await Promise.all([
            missions.dispatch(),
            missions.dispatch(),
          ]);
          assert.equal(new Set([...left, ...right]).size, 1);
          const rows = await db
            .select()
            .from(t.mission_runs)
            .where(eq(t.mission_runs.mission_id, mission.id));
          assert.equal(rows.length, 1);
          assert.equal(
            (await missions.detail(a, mission.id)).mission.nextRunAt,
            "2026-11-19T14:00:00.000Z",
          );
        },
      );
      const [run] = await db
        .select()
        .from(t.mission_runs)
        .where(eq(t.mission_runs.mission_id, mission.id));
      await suite.test(
        "duplicate serverless workers make one model call and one scoped artifact",
        async () => {
          await Promise.all([
            missions.execute(run.id),
            missions.execute(run.id),
          ]);
          assert.equal(calls, 1);
          const detail = await missions.detail(a, mission.id);
          assert.equal(detail.runs[0].status, "succeeded");
          assert.ok(detail.runs[0].artifact);
          const artifact = await missions.artifact(a, mission.id, run.id);
          assert.ok(artifact.content.includes("Practice one greeting"));
          assert.ok(context?.inputs[0].content.includes("Hola"));
          assert.equal(context?.tasks[0].status, "completed");
          assert.ok(
            bucket.keys.every((key) =>
              key.startsWith(`${a}/missions/${mission.id}/spanish-practice/`),
            ),
          );
          await assert.rejects(
            missions.artifact(b, mission.id, run.id),
            /not found/,
          );
          assert.equal((await db.select().from(t.memory_nodes)).length, 0);
        },
      );
      await suite.test(
        "manual run requests deduplicate, and failures have no fabricated output or retry loop",
        async () => {
          const requestId = randomUUID();
          const manual = await missions.enqueueManual(a, mission.id, requestId);
          assert.equal(
            (await missions.enqueueManual(a, mission.id, requestId)).runId,
            manual.runId,
          );
          failure = true;
          await missions.execute(manual.runId);
          failure = false;
          const before = calls;
          await missions.execute(manual.runId);
          assert.equal(calls, before);
          const detail = await missions.detail(a, mission.id);
          const failed = detail.runs.find((item) => item.id === manual.runId)!;
          assert.equal(failed.status, "failed");
          assert.equal(failed.artifact, null);
          assert.ok(!failed.error?.includes("private data"));
        },
      );
      await suite.test(
        "pause fences an in-flight run before it can write output",
        async () => {
          now = new Date(now.getTime() + 1000);
          const pending = await missions.enqueueManual(
            a,
            mission.id,
            randomUUID(),
          );
          let entered!: () => void, release!: () => void;
          const started = new Promise<void>((resolve) => {
            entered = resolve;
          });
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          hook = async () => {
            entered();
            await gate;
          };
          const running = missions.execute(pending.runId);
          await started;
          await missions.setEnabled(a, mission.id, false);
          release();
          await running;
          hook = async () => {};
          const detail = await missions.detail(a, mission.id);
          assert.equal(
            detail.runs.find((item) => item.id === pending.runId)?.status,
            "cancelled",
          );
          assert.ok(
            ![...bucket.data.keys()].some((key) =>
              key.endsWith(`${pending.runId}.md`),
            ),
          );
          await assert.rejects(
            missions.enqueueManual(a, mission.id, randomUUID()),
            /Activate/,
          );
          assert.equal(
            (await missions.setEnabled(a, mission.id, true)).status,
            "active",
          );
        },
      );
      await suite.test(
        "pause during file preparation prevents a new model attempt or quota charge",
        async () => {
          now = new Date(now.getTime() + 1000);
          const pending = await missions.enqueueManual(
            a,
            mission.id,
            randomUUID(),
          );
          let entered!: () => void, release!: () => void;
          const started = new Promise<void>((resolve) => {
            entered = resolve;
          });
          const gate = new Promise<void>((resolve) => {
            release = resolve;
          });
          bucket.readHook = async () => {
            entered();
            await gate;
          };
          const before = calls;
          const running = missions.execute(pending.runId);
          await started;
          await missions.setEnabled(a, mission.id, false);
          release();
          await running;
          bucket.readHook = async () => {};
          assert.equal(calls, before);
          const charges = await db
            .select()
            .from(t.usage_ledger)
            .where(eq(t.usage_ledger.request_id, pending.runId));
          assert.equal(charges.length, 0);
          await missions.setEnabled(a, mission.id, true);
        },
      );
      await suite.test(
        "public/unavailable storage fails a run without model calls",
        async () => {
          now = new Date(now.getTime() + 1000);
          const pending = await missions.enqueueManual(
            a,
            mission.id,
            randomUUID(),
          );
          const before = calls;
          bucket.public = true;
          await missions.execute(pending.runId);
          bucket.public = false;
          assert.equal(calls, before);
          assert.equal(
            (await missions.detail(a, mission.id)).runs.find(
              (r) => r.id === pending.runId,
            )?.status,
            "failed",
          );
        },
      );
      await suite.test(
        "quota uses the shared user ledger and does not retry beyond the allowance",
        async () => {
          const limited = new MissionsService(
            db,
            model,
            bucket,
            { bucket: "alorun-missions", runnerAvailable: true, dailyLimit: 1 },
            () => now,
          );
          const own = await limited.create(
            b,
            definition(randomUUID(), otherGoalId),
          );
          const first = await limited.enqueueManual(b, own.id, randomUUID());
          await limited.execute(first.runId);
          now = new Date(now.getTime() + 1000);
          const second = await limited.enqueueManual(b, own.id, randomUUID());
          const before = calls;
          await limited.execute(second.runId);
          assert.equal(calls, before);
          const detail = await limited.detail(b, own.id);
          assert.match(
            detail.runs.find((r) => r.id === second.runId)!.error!,
            /allowance/,
          );
          const [usage] = await db
            .select({ total: count() })
            .from(t.usage_ledger)
            .where(eq(t.usage_ledger.user_id, b));
          assert.equal(usage.total, 1);
          await assert.rejects(
            missions.readInput(a, own.id, "lesson.md"),
            /not found/,
          );
        },
      );
      await suite.test(
        "database rejects cross-owner run links and mission RLS denies direct clients",
        async () => {
          await assert.rejects(
            db.insert(t.mission_runs).values({
              user_id: b,
              mission_id: mission.id,
              scheduled_for: now,
              request_id: randomUUID(),
              trigger: "manual",
            }),
          );
          await pool.query(
            "DO $$ BEGIN CREATE ROLE missions_test_client NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$; GRANT USAGE ON SCHEMA public TO missions_test_client; GRANT SELECT ON public.missions, public.mission_runs TO missions_test_client;",
          );
          const client = await pool.connect();
          try {
            await client.query("SET ROLE missions_test_client");
            assert.equal(
              (await client.query("SELECT * FROM public.missions")).rows.length,
              0,
            );
            assert.equal(
              (await client.query("SELECT * FROM public.mission_runs")).rows
                .length,
              0,
            );
          } finally {
            await client.query("RESET ROLE");
            client.release();
          }
        },
      );
      @Module({
        controllers: [MissionsController],
        providers: [
          { provide: MissionsService, useValue: missions },
          { provide: MISSION_WAKE, useValue: async () => {} },
          AuthGuard,
          {
            provide: AUTH_VERIFIER,
            useValue: {
              async verify(token: string) {
                return token === "fixture-a"
                  ? a
                  : token === "fixture-b"
                    ? b
                    : null;
              },
            },
          },
        ],
      })
      class TestModule {}
      app = await NestFactory.create(TestModule, {
        logger: false,
        abortOnError: false,
      });
      app.useGlobalFilters(new RedactedErrors());
      await app.listen(0, "127.0.0.1");
      const base = await app.getUrl();
      await suite.test(
        "HTTP mission routes validate approval/cron/identity and reject traversal",
        async () => {
          const headers = {
            authorization: "Bearer fixture-a",
            "content-type": "application/json",
          };
          assert.equal((await fetch(`${base}/v1/missions`)).status, 401);
          assert.equal(
            (
              await fetch(`${base}/v1/missions/${mission.id}`, {
                headers: { authorization: "Bearer fixture-b" },
              })
            ).status,
            404,
          );
          assert.equal(
            (
              await fetch(`${base}/v1/missions`, {
                method: "POST",
                headers,
                body: JSON.stringify({ ...definition(), approved: false }),
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await fetch(`${base}/v1/missions`, {
                method: "POST",
                headers,
                body: JSON.stringify({ ...definition(), user_id: b }),
              })
            ).status,
            400,
          );
          assert.equal(
            (
              await fetch(
                `${base}/v1/missions/${mission.id}/files?name=..%2Fsecret.md`,
                { headers },
              )
            ).status,
            400,
          );
          const preview = await fetch(`${base}/v1/missions/preview`, {
            method: "POST",
            headers,
            body: JSON.stringify({
              cron: "0 9 * * *",
              timezone: "America/New_York",
            }),
          });
          assert.equal(preview.status, 201);
          assert.equal(
            ((await preview.json()) as { nextRuns: string[] }).nextRuns.length,
            3,
          );
        },
      );
      await suite.test(
        "private bucket restrictive policy defeats unrelated permissive client policies",
        async () => {
          await pool.query(`DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
        CREATE TABLE storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
        GRANT USAGE ON SCHEMA storage TO anon,authenticated;GRANT ALL ON storage.objects TO anon,authenticated;
        CREATE POLICY unrelated_permissive ON storage.objects FOR ALL TO anon,authenticated USING(true) WITH CHECK(true);`);
          await pool.query(
            await readFile("supabase/setup/missions-storage.sql", "utf8"),
          );
          await pool.query(
            "INSERT INTO storage.objects(bucket_id,name) VALUES ('alorun-missions','private.md'),('avatars','public.png')",
          );
          const client = await pool.connect();
          try {
            await client.query("SET ROLE authenticated");
            const rows = await client.query("SELECT * FROM storage.objects");
            assert.equal(rows.rows.length, 1);
            assert.equal(rows.rows[0].bucket_id, "avatars");
            await assert.rejects(
              client.query(
                "INSERT INTO storage.objects(bucket_id,name) VALUES ('alorun-missions','attack.md')",
              ),
            );
          } finally {
            await client.query("RESET ROLE");
            client.release();
          }
        },
      );
    } finally {
      if (app) await app.close();
      await pool.end();
      await control.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
      await control.end();
    }
  },
);
