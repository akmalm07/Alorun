import { createServer, type IncomingMessage } from "node:http";
import { once } from "node:events";

export const origin =
  process.env.ALORUN_BROWSER_TEST_ORIGIN ?? "http://127.0.0.1:41287";
const stamp = "2026-11-19T11:00:00.000Z";
const owner = "63cc06d6-5061-4e26-adf0-a5dc19dc5455";
const goal = {
  id: "9b356b33-6231-4cae-9d18-1781267dc631",
  title: "Finish a project",
  motivation: null,
};
const initialTask = {
  id: "64dca6af-509e-4dc6-af0b-0caba3262db5",
  goalId: goal.id,
  title: "Outline next steps",
  description: null,
  dueAt: null,
  estimateMinutes: 20,
  status: "pending",
};
const initialMission = {
  id: "feaeab1c-f5d7-4437-9021-bc9aa0772430",
  goalId: goal.id,
  title: "Weekly review",
  instructions: "Review progress and list the next actions.",
  kind: "review",
  cron: "0 9 * * 1",
  timezone: "America/New_York",
  folder: "weekly-review",
  status: "active",
  nextRunAt: null,
  createdAt: stamp,
};

function fixturePage(path: string) {
  const title =
    path === "/reports" ? "Reports" : path === "/notes" ? "Notes" : "Desk";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${title}</title><style>
  body{margin:0;font:16px system-ui,sans-serif;color:#192720;background:#f4f8f6}
  header,main{max-width:980px;margin:auto;padding:18px} nav{display:flex;flex-wrap:wrap;gap:14px}
  main{display:grid;gap:12px} #edit{display:grid;gap:6px;max-width:380px}
  #edit[hidden]{display:none} input,textarea,button{font:inherit} textarea{min-height:70px} button{justify-self:start}
  .shell{background:#fff;border-radius:12px;padding:14px} #editable{width:140px;border:1px solid #888}
  </style></head><body>
  <header><nav><a href="/">Desk</a><a href="/reports">Reports</a><a href="/notes">Notes</a><button type="button" id="spa">Open activity</button></nav></header>
  <main><h1>${title}</h1><button type="button" id="new">New note</button>
  <div id="edit" hidden><label for="note">Note</label><textarea id="note"></textarea><div role="textbox" contenteditable="true" id="editable" aria-label="Draft"></div></div>
  <label>Search <input type="search"></label>
  <label>Password <input type="password"></label>
  <button type="button">Delete account</button>
  <button type="button" class="duplicate">Duplicate</button><button type="button" class="duplicate">Duplicate</button>
  <button type="button" id="original">Original tool</button><output id="out"></output>
  </main><script>
  window.events = [];
  document.querySelector("#new").onclick = () => {
    document.querySelector("#edit").hidden = false;
    window.events.push({ type: "new" });
  };
  document.querySelector("#spa").onclick = () => {
    history.pushState({}, "", "/activity");
    document.title = "Activity";
  };
  document.querySelector("#original").onclick = () => document.querySelector("#out").textContent = "Original works";
  document.querySelectorAll(".duplicate").forEach((item) => item.onclick = () => window.events.push({type: "duplicate"}));
  for (const field of document.querySelectorAll("#note, #editable, input")) {
    for (const type of ["beforeinput", "keydown", "input", "keyup", "paste"]) {
      field.addEventListener(type, (event) => window.events.push({ type, key: event.key, data: event.data, value: field.value ?? field.textContent, trusted: event.isTrusted }));
    }
  }
  </script></body></html>`;
}

async function payload(req: IncomingMessage) {
  const parts = [];
  for await (const part of req) parts.push(part);
  return JSON.parse(Buffer.concat(parts).toString() || "{}");
}

export async function startFixture() {
  let task = initialTask;
  let mission = initialMission;
  let goals = [goal];
  let history = false;
  let checkins = false;
  const calls: Array<{ path: string; method: string; body: unknown }> = [];
  const server = createServer(async (req, res) => {
    const { pathname: path } = new URL(req.url ?? "/", origin);
    const method = req.method ?? "GET";
    const json = (value: unknown, status = 200) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    if (path === "/auth/v1/token") {
      const body = await payload(req);
      if (
        body.email !== "tester@example.test" ||
        body.password !== "test-only-password"
      )
        return json({ message: "Invalid login" }, 400);
      return json({
        access_token: "fixture-access-token",
        token_type: "bearer",
        expires_in: 3600,
        refresh_token: "fixture-refresh-token",
        user: {
          id: owner,
          aud: "authenticated",
          email: body.email,
          app_metadata: {},
          user_metadata: {},
          created_at: stamp,
        },
      });
    }
    if (path === "/auth/v1/logout") return json({});
    if (path.startsWith("/v1/")) {
      if (req.headers.authorization !== "Bearer fixture-access-token")
        return json({ message: "Authorization required" }, 401);
      const body = await payload(req);
      calls.push({ path, method, body });
      if (path === "/v1/today")
        return json({
          goals,
          tasks: [task],
          proposals: [],
          checkinsEnabled: checkins,
        });
      if (path === "/v1/goals" && method === "POST") {
        const created = {
          id: body.id,
          title: body.title,
          motivation: body.motivation,
        };
        goals = [...goals, created];
        return json(created, 201);
      }
      if (path === `/v1/tasks/${task.id}` && method === "PATCH") {
        task = { ...task, status: body.status };
        return json({ ok: true });
      }
      if (path === "/v1/missions")
        return json({
          missions: [mission],
          suggestions: [],
          runnerAvailable: true,
          bucket: "missions",
        });
      if (path === `/v1/missions/${mission.id}`) {
        if (method === "PATCH") {
          mission = { ...mission, status: body.enabled ? "active" : "paused" };
          return json(mission);
        }
        return json({
          mission,
          runs: [],
          files: [],
          storagePath: "fixture",
          storageAvailable: true,
        });
      }
      if (path === "/v1/chat/history" && method === "GET")
        return json({
          threadId: null,
          messages: [],
          saveHistory: history,
          savingAvailable: true,
          historyVersion: stamp,
        });
      if (path === "/v1/chat/history" && method === "POST")
        return json({ saved: history });
      if (path === "/v1/chat/reply")
        return json({
          reply: "Start by reviewing your project outline.",
          suggestedGoalId: null,
        });
      if (path === "/v1/chat/settings") {
        history = body.saveHistory;
        return json({ saveHistory: history, historyVersion: stamp });
      }
      if (path === "/v1/settings/goal-checkins") {
        checkins = body.enabled;
        return json({ enabled: checkins });
      }
      return json({ message: "Unknown route" }, 404);
    }
    if (path === "/favicon.ico") {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(fixturePage(path));
  });
  server.listen(Number(new URL(origin).port), "127.0.0.1");
  await once(server, "listening");
  return {
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
    calls,
  };
}
