// Local Deno integration: real disposable Postgres, fixture OpenAI/Storage HTTP only.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "npm:pg@8.23.1";
import { createServerlessMissions } from "../supabase/functions/missions/worker.js";
const source = Deno.env.get("TEST_DATABASE_URL");
if (!source)
  throw new Error(
    "Set TEST_DATABASE_URL to a disposable alorun_test database.",
  );
const sourceUrl = new URL(source);
assert.match(sourceUrl.pathname, /^\/alorun_test[a-z0-9_]*$/);
const databaseName = `alorun_test_edge_${randomUUID().slice(0, 8)}`;
const control = new pg.Pool({ connectionString: source });
await control.query(`CREATE DATABASE "${databaseName}"`);
const target = new URL(source);
target.pathname = `/${databaseName}`;
const db = new pg.Pool({ connectionString: target.toString() });
let modelCalls = 0,
  writes = 0;
const background = [];
const oldFetch = globalThis.fetch;
let closeWorker = async () => {};
const user = randomUUID(),
  goal = randomUUID(),
  mission = randomUUID();
const secret = "a".repeat(64);
try {
  await db.query(
    "CREATE SCHEMA auth;CREATE TABLE auth.users(id uuid primary key);CREATE SCHEMA extensions;",
  );
  for (const name of ["0000_wet_moondragon", "0002_conscious_hiroim"])
    await db.query(await Deno.readTextFile(`drizzle/${name}.sql`));
  await db.query("INSERT INTO auth.users(id) VALUES($1);", [user]);
  await db.query("INSERT INTO users_profile(id) VALUES($1)", [user]);
  await db.query("INSERT INTO goals(id,user_id,title) VALUES($1,$2,$3)", [
    goal,
    user,
    "Learn Spanish",
  ]);
  await db.query(
    "INSERT INTO missions(id,user_id,goal_id,title,instructions,kind,cron,timezone,folder,status,next_run_at) VALUES($1,$2,$3,'Spanish practice','Prepare a useful practice pack.','practice','0 9 * * *','America/New_York','practice','active',now()-interval '1 minute')",
    [mission, user, goal],
  );
  globalThis.fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url === "https://worker.invalid/functions/v1/missions")
      return Response.json({ accepted: true });
    if (url === "https://storage.invalid/storage/v1/bucket/alorun-missions")
      return Response.json({
        id: "alorun-missions",
        name: "alorun-missions",
        public: false,
        file_size_limit: 65536,
      });
    if (
      url === "https://storage.invalid/storage/v1/object/list/alorun-missions"
    )
      return Response.json([]);
    if (
      url.startsWith(
        "https://storage.invalid/storage/v1/object/alorun-missions/",
      )
    ) {
      assert.ok(url.includes(`${user}/missions/${mission}/practice/outputs/`));
      writes++;
      return Response.json({ Key: url, Id: randomUUID() });
    }
    if (url === "https://api.openai.com/v1/responses") {
      modelCalls++;
      const request = JSON.parse(String(init?.body));
      assert.equal(request.store, false);
      assert.ok(!("tools" in request));
      return Response.json({
        id: "resp_fixture",
        object: "response",
        created_at: Date.now() / 1000,
        status: "completed",
        error: null,
        incomplete_details: null,
        output: [
          {
            type: "message",
            id: "msg_fixture",
            status: "completed",
            role: "assistant",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  title: "Practice Spanish",
                  summary: "Your practice pack is ready.",
                  markdown:
                    "Practice saying hello and answer these three prompts.",
                }),
                annotations: [],
              },
            ],
          },
        ],
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      });
    }
    throw new Error(`Unexpected outbound fixture URL: ${new URL(url).origin}`);
  };
  const handler = createServerlessMissions(
    {
      DATABASE_URL: target.toString(),
      SUPABASE_URL: "https://storage.invalid",
      MISSION_STORAGE_SERVICE_KEY: "fixture-service-key",
      MISSION_WORKER_SECRET: secret,
      MISSION_WORKER_URL: "https://worker.invalid/functions/v1/missions",
      OPENAI_API_KEY: "fixture-ai-key",
      OPENAI_MODEL: "fixture-model",
      AI_INPUT_USD_PER_MILLION: "1",
      AI_OUTPUT_USD_PER_MILLION: "1",
      AI_DAILY_REQUEST_LIMIT: "3",
    },
    (task) => background.push(task),
  );
  closeWorker = handler.close;
  const request = (command) =>
    new Request("https://worker.invalid/functions/v1/missions", {
      method: "POST",
      headers: { "x-mission-secret": secret },
      body: JSON.stringify(command),
    });
  assert.equal((await handler(request({ kind: "dispatch" }))).status, 202);
  await Promise.all(background);
  const rows = await db.query("SELECT id,status FROM mission_runs");
  assert.equal(rows.rows.length, 1);
  const runId = rows.rows[0].id;
  assert.equal((await handler(request({ kind: "run", runId }))).status, 200);
  const finished = await db.query(
    "SELECT status,artifact,error FROM mission_runs WHERE id=$1",
    [runId],
  );
  assert.equal(finished.rows[0].status, "succeeded", finished.rows[0].error);
  assert.equal(finished.rows[0].artifact, `outputs/${runId}.md`);
  await handler(request({ kind: "run", runId }));
  assert.equal(modelCalls, 1);
  assert.equal(writes, 1);
  console.log(
    "Deno Missions PASS: dispatch -> queued run -> one fixture AI call -> scoped output -> succeeded; duplicate run ignored.",
  );
} finally {
  globalThis.fetch = oldFetch;
  await closeWorker();
  await db.end();
  await control.query(`DROP DATABASE "${databaseName}" WITH (FORCE)`);
  await control.end();
}
