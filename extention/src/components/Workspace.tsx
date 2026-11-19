import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Circle,
  MessageSquare,
  Plus,
  Settings2,
  Sparkles,
} from "lucide-react";
import { z } from "zod";
import {
  appDestinations,
  type AppDestination,
} from "../../../src/shared/navigation";
import { recentConversation } from "../../../src/domain/conversation";
import {
  relevantSettings,
  settingsCatalog,
} from "../../../src/domain/settings-chat";
import {
  chatHistorySchema,
  chatReplySchema,
  chatSettingsSchema,
  goalInputSchema,
  goalSchema,
  todaySchema,
  type ChatMessage,
  type ChatMode,
} from "../../../src/shared/contracts";
import {
  missionDetailSchema,
  missionSchema,
  missionsPageSchema,
} from "../../../src/shared/missions";
import { errorText } from "../browser/protocol";
import {
  appRequest,
  auth,
  grantAccountAccess,
  type AppRequest,
} from "../workspace-api";

const icons = {
  today: CalendarDays,
  chat: MessageSquare,
  missions: Sparkles,
  settings: Settings2,
};

export function Workspace() {
  const [selected, setSelected] = useState<AppDestination>();
  const [owner, setOwner] = useState("");
  useEffect(() => {
    if (!auth) return;
    const { data } = auth.auth.onAuthStateChange((_event, session) =>
      setOwner(session?.user.id ?? ""),
    );
    return () => data.subscription.unsubscribe();
  }, []);
  if (!selected) {
    return (
      <section aria-labelledby="workspace-title">
        <h2 id="workspace-title">Your workspace</h2>
        <div className="workspace-list">
          {appDestinations.map(([id, label]) => {
            const Icon = icons[id];
            return (
              <button key={id} onClick={() => setSelected(id)}>
                <Icon size={17} aria-hidden="true" />
                <span>{label}</span>
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </section>
    );
  }
  const label = appDestinations.find(([id]) => id === selected)?.[1];
  return (
    <section className="workspace-view" aria-label={label}>
      <header className="split">
        <button className="back-link" onClick={() => setSelected(undefined)}>
          <ArrowLeft size={16} aria-hidden="true" />
          Workspace
        </button>
        <h2>{label}</h2>
      </header>
      {!owner ? (
        <AccountGate />
      ) : (
        <ConnectedPanel key={owner} owner={owner} selected={selected} />
      )}
    </section>
  );
}

function AccountGate() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!auth)
    return (
      <p className="muted">
        This build needs an Alorun API and Supabase configuration to open your
        account. Page tools are ready to use.
      </p>
    );

  async function signIn(event: FormEvent) {
    event.preventDefault();
    if (!auth || busy) return;
    setBusy(true);
    setError("");
    try {
      await grantAccountAccess();
      const { error } = await auth.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw error;
      setPassword("");
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={(event) => void signIn(event)}>
      <p className="muted">Sign in with your existing Alorun account.</p>
      <label>
        Email
        <input
          type="email"
          required
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
      </label>
      <label>
        Password
        <input
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
        />
      </label>
      <button className="primary" disabled={busy}>
        {busy ? "Connecting…" : "Sign in"}
      </button>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

function ConnectedPanel({
  owner,
  selected,
}: {
  owner: string;
  selected: AppDestination;
}) {
  const [api] = useState(() => appRequest(owner));
  const content = {
    today: <Today api={api} />,
    chat: <Companion api={api} />,
    missions: <Missions api={api} />,
    settings: <Settings api={api} />,
  };
  return content[selected];
}

function useOperation() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(operation: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function WorkStatus({ busy, error }: { busy: boolean; error: string }) {
  return (
    <>
      {busy && (
        <p className="muted" role="status">
          Working…
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

function Today({ api }: { api: AppRequest }) {
  const [result, setResult] = useState<z.infer<typeof todaySchema>>();
  const [title, setTitle] = useState("");
  const [adding, setAdding] = useState(false);
  const [goalId, setGoalId] = useState(() => crypto.randomUUID());
  const { busy, error, run } = useOperation();
  async function load() {
    setResult(todaySchema.parse(await api("/today")));
  }
  useEffect(() => {
    void run(load);
  }, [api]);

  function add(event: FormEvent) {
    event.preventDefault();
    if (busy || !result) return;
    void run(async () => {
      const draft = goalInputSchema.parse({ title, motivation: "" });
      const goal = goalSchema.parse(
        await api("/goals", "POST", { ...draft, id: goalId }),
      );
      setResult({
        ...result,
        goals: [...result.goals.filter((item) => item.id !== goal.id), goal],
      });
      setTitle("");
      setGoalId(crypto.randomUUID());
      setAdding(false);
    });
  }

  return (
    <div className="stack">
      {result && (
        <>
          <div className="split">
            <h3>Goals</h3>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setAdding(!adding)}
            >
              <Plus size={14} aria-hidden="true" />
              Add goal
            </button>
          </div>
          {adding && (
            <form className="stack" onSubmit={add}>
              <label>
                Goal title
                <input
                  required
                  value={title}
                  maxLength={180}
                  onChange={(event) => setTitle(event.target.value)}
                />
              </label>
              <button className="primary" disabled={busy || !title.trim()}>
                Save goal
              </button>
            </form>
          )}
          {result.goals.length ? (
            <ul className="data-list">
              {result.goals.map((goal) => (
                <li key={goal.id}>{goal.title}</li>
              ))}
            </ul>
          ) : (
            <p className="muted">No goals yet.</p>
          )}
          <h3>Tasks</h3>
          {result.tasks.length ? (
            <ul className="data-list">
              {result.tasks.map((task) => {
                const done = task.status === "completed";
                return (
                  <li key={task.id}>
                    <button
                      className="task-row"
                      aria-pressed={done}
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const status = done ? "pending" : "completed";
                          z.object({ ok: z.literal(true) }).parse(
                            await api(`/tasks/${task.id}`, "PATCH", { status }),
                          );
                          setResult({
                            ...result,
                            tasks: result.tasks.map((item) =>
                              item.id === task.id ? { ...item, status } : item,
                            ),
                          });
                        })
                      }
                    >
                      {done ? (
                        <Check size={16} aria-hidden="true" />
                      ) : (
                        <Circle size={16} aria-hidden="true" />
                      )}
                      <span>{task.title}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">No tasks on your schedule.</p>
          )}
        </>
      )}
      <WorkStatus busy={busy} error={error} />
      {error && !result && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void run(load)}
        >
          Retry
        </button>
      )}
    </div>
  );
}

const modes = [
  ["listen", "Listen"],
  ["think", "Think"],
  ["plan", "Plan"],
] as const;

function Companion({ api }: { api: AppRequest }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [mode, setMode] = useState<ChatMode>("think");
  const [threadId, setThreadId] = useState<string>(() => crypto.randomUUID());
  const [history, setHistory] = useState<z.infer<typeof chatHistorySchema>>();
  const { busy, error, run } = useOperation();
  async function load() {
    const current = chatHistorySchema.parse(await api("/chat/history"));
    setHistory(current);
    setMessages(current.messages);
    if (current.threadId) setThreadId(current.threadId);
  }
  useEffect(() => {
    void run(load);
  }, [api]);

  function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || busy) return;
    const user: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: draft.trim(),
      source: "text",
      suggestedGoalId: null,
    };
    void run(async () => {
      const reply = chatReplySchema.parse(
        await api("/chat/reply", "POST", {
          requestId: crypto.randomUUID(),
          mode,
          messages: recentConversation([...messages, user]),
        }),
      );
      const next = [
        ...messages,
        user,
        {
          id: crypto.randomUUID(),
          role: "assistant" as const,
          content: reply.reply,
          source: "text" as const,
          suggestedGoalId: reply.suggestedGoalId,
        },
      ];
      setMessages(next);
      setDraft("");
      if (
        history?.saveHistory &&
        history.savingAvailable &&
        history.historyVersion
      ) {
        const saved = z.object({ saved: z.boolean() }).parse(
          await api("/chat/history", "POST", {
            threadId,
            historyVersion: history.historyVersion,
            messages: next.slice(-60),
          }),
        );
        if (!saved.saved)
          throw new Error(
            "Chat history is off. This reply is available while this panel is open.",
          );
      }
    });
  }

  return (
    <div className="stack">
      <div className="split">
        <label className="inline-label">
          Mode
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as ChatMode)}
          >
            {modes.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => {
            setMessages([]);
            setDraft("");
            setThreadId(crypto.randomUUID());
          }}
        >
          New chat
        </button>
      </div>
      <div
        className="transcript"
        aria-label="Companion messages"
        aria-live="polite"
      >
        {!messages.length && (
          <p className="muted">What would you like help with today?</p>
        )}
        {messages.map((turn) => (
          <p key={turn.id} className={`message ${turn.role}`}>
            {turn.content}
          </p>
        ))}
      </div>
      <form className="stack" onSubmit={send}>
        <label>
          Message
          <textarea
            rows={2}
            maxLength={4000}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </label>
        <button className="primary" disabled={busy || !draft.trim()}>
          Send message
        </button>
      </form>
      <WorkStatus busy={busy} error={error} />
    </div>
  );
}

function Missions({ api }: { api: AppRequest }) {
  const [result, setResult] = useState<z.infer<typeof missionsPageSchema>>();
  const [detail, setDetail] = useState<z.infer<typeof missionDetailSchema>>();
  const { busy, error, run } = useOperation();
  async function load() {
    setResult(missionsPageSchema.parse(await api("/missions")));
  }
  useEffect(() => {
    void run(load);
  }, [api]);

  return (
    <div className="stack">
      {detail ? (
        <>
          <button className="back-link" onClick={() => setDetail(undefined)}>
            <ArrowLeft size={15} aria-hidden="true" />
            All missions
          </button>
          <h3>{detail.mission.title}</h3>
          <p className="muted">{detail.mission.instructions}</p>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                const mission = missionSchema.parse(
                  await api(`/missions/${detail.mission.id}`, "PATCH", {
                    enabled: detail.mission.status === "paused",
                  }),
                );
                setDetail({ ...detail, mission });
                if (result)
                  setResult({
                    ...result,
                    missions: result.missions.map((item) =>
                      item.id === mission.id ? mission : item,
                    ),
                  });
              })
            }
          >
            {detail.mission.status === "paused"
              ? "Resume mission"
              : "Pause mission"}
          </button>
          <h3>Run history</h3>
          {detail.runs.length ? (
            <ul className="data-list">
              {detail.runs.map((item) => (
                <li key={item.id}>
                  {item.status} · {new Date(item.scheduledFor).toLocaleString()}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No runs yet.</p>
          )}
        </>
      ) : (
        result &&
        (result.missions.length ? (
          <ul className="data-list">
            {result.missions.map((mission) => (
              <li key={mission.id}>
                <button
                  className="task-row"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      setDetail(
                        missionDetailSchema.parse(
                          await api(`/missions/${mission.id}`),
                        ),
                      );
                    })
                  }
                >
                  <span>{mission.title}</span>
                  <span className="muted">{mission.status}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">
            No missions yet. Set up a recurring mission in the Alorun app.
          </p>
        ))
      )}
      <WorkStatus busy={busy} error={error} />
      {error && !result && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() => void run(load)}
        >
          Retry
        </button>
      )}
    </div>
  );
}

function Settings({ api }: { api: AppRequest }) {
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState<(typeof settingsCatalog)[number][]>(
    [],
  );
  const [history, setHistory] = useState<z.infer<typeof chatHistorySchema>>();
  const [checkins, setCheckins] = useState<boolean>();
  const { busy, error, run } = useOperation();

  useEffect(() => {
    void run(async () => {
      const [chat, today] = await Promise.all([
        api("/chat/history"),
        api("/today"),
      ]);
      setHistory(chatHistorySchema.parse(chat));
      setCheckins(todaySchema.parse(today).checkinsEnabled);
    });
  }, [api]);

  const controls: Record<string, ReactNode> = {
    history: history?.savingAvailable && (
      <button
        className="secondary"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const change = chatSettingsSchema.parse(
              await api("/chat/settings", "PATCH", {
                saveHistory: !history.saveHistory,
              }),
            );
            setHistory({ ...history, ...change });
          })
        }
      >
        {history.saveHistory ? "Turn off chat history" : "Turn on chat history"}
      </button>
    ),
    checkins: checkins !== undefined && (
      <button
        className="secondary"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            await api("/settings/goal-checkins", "PATCH", {
              enabled: !checkins,
            });
            setCheckins(!checkins);
          })
        }
      >
        {checkins ? "Disable voice check-ins" : "Enable voice check-ins"}
      </button>
    ),
    account: (
      <button
        className="secondary"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const result = await auth?.auth.signOut({ scope: "local" });
            if (result?.error) throw result.error;
          })
        }
      >
        Sign out
      </button>
    ),
  };

  return (
    <div className="stack">
      <form
        className="stack"
        onSubmit={(event) => {
          event.preventDefault();
          const matched = relevantSettings(query);
          setSettings(matched.length ? matched : [...settingsCatalog]);
        }}
      >
        <label>
          Ask about a setting
          <input
            placeholder="Chat history, appearance, account…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button className="primary" disabled={!query.trim()}>
          Find settings
        </button>
      </form>
      {(settings.length
        ? settings
        : settingsCatalog.filter((item) => item.id === "account")
      ).map((item) => (
        <div className="setting stack" key={item.id}>
          <h3>{item.label}</h3>
          <p className="muted">{item.description}</p>
          {controls[item.id]}
        </div>
      ))}
      <WorkStatus busy={busy} error={error} />
    </div>
  );
}
