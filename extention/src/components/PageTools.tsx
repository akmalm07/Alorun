import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  CornerDownLeft,
  MousePointer2,
  PanelsTopLeft,
  X,
} from "lucide-react";
import {
  activePage,
  forget,
  inspect,
  pageMessage,
  remember,
} from "../browser/client";
import { draftActions, draftLayout, type PageAction } from "../browser/plans";
import {
  errorText,
  pageAddress,
  type BrowserSnapshot,
} from "../browser/protocol";

type Mode = "layout" | "action";
type Turn = { role: "user" | "assistant"; content: string };

export function PageTools({
  mode,
  onBack,
}: {
  mode: Mode;
  onBack: () => void;
}) {
  const [page, setPage] = useState<BrowserSnapshot>();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [actions, setActions] = useState<PageAction[]>();
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const transcript = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const layoutMode = mode === "layout";
  const example = layoutMode
    ? 'Put "Reports" first in a compact, two-column panel at the top.'
    : 'Click "New note" then type "Draft update" into "Note".';
  const running = page?.run.state === "running";
  const address = page && pageAddress(page.href);
  const title = layoutMode ? "Change this for me" : "Act on this page";

  useEffect(() => {
    let current = true;
    void activePage().then(
      (page) => {
        if (current) {
          setPage(page);
          setBusy(false);
        }
      },
      (error: unknown) => {
        if (current) {
          setError(errorText(error));
          setBusy(false);
        }
      },
    );
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    transcript.current?.scrollIntoView({ block: "end" });
  }, [turns.length, actions]);
  useEffect(() => {
    if (!running) return;
    let current = true;
    const timer = window.setInterval(() => {
      void inspect().then(
        (next) => {
          if (current) setPage(next);
        },
        (error: unknown) => {
          if (current) {
            setPage(undefined);
            setError(errorText(error));
          }
        },
      );
    }, 340);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [running]);

  const say = (content: string) =>
    setTurns((items) =>
      [...items, { role: "assistant" as const, content }].slice(-12),
    );
  const operate = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  function submit(event: FormEvent) {
    event.preventDefault();
    const prompt = draft.trim();
    if (!prompt || !page || busy || running) return;
    setActions(undefined);
    setDraft("");
    setTurns((items) =>
      [...items, { role: "user" as const, content: prompt }].slice(-12),
    );
    void operate(async () => {
      const current = await inspect();
      if (current.instance !== page.instance || current.href !== page.href) {
        setPage(current);
        throw new Error(
          "This page changed. Review the current page and send your request again.",
        );
      }
      if (layoutMode) {
        const { layout, message } = draftLayout(
          prompt,
          current.controls,
          current.preview ?? current.saved,
        );
        setPage(await pageMessage({ type: "preview", scope: current, layout }));
        say(message);
      } else {
        setActions(draftActions(prompt));
      }
    });
  }

  const samples = page?.controls.slice(0, 5);
  return (
    <section className="tool" aria-labelledby="tool-title">
      <div className="tool-heading">
        <button
          className="icon-button"
          onClick={onBack}
          aria-label="Back to workspace"
        >
          <ArrowLeft size={19} />
        </button>
        <div>
          <h1 id="tool-title">{title}</h1>
          {address && (
            <div className="page-address" title={page.href}>
              {new URL(address.origin).host}
              {address.path}
            </div>
          )}
        </div>
        <span className="tool-icon" aria-hidden="true">
          {layoutMode ? (
            <PanelsTopLeft size={20} />
          ) : (
            <MousePointer2 size={20} />
          )}
        </span>
      </div>

      <div className="tool-content">
        {busy && !page && (
          <p role="status" className="muted">
            Connecting to this page…
          </p>
        )}
        {page && turns.length === 0 && (
          <div className="intro">
            <p>
              {layoutMode
                ? "Describe the shortcuts and layout you want. The preview appears on the current page."
                : "Tell Alorun which labeled controls to click and what to type. You’ll review the steps before they run."}
            </p>
            <button
              className="example"
              onClick={() => {
                setDraft(example);
                input.current?.focus();
              }}
            >
              <span>{example}</span>
              <ArrowUpRight size={15} aria-hidden="true" />
            </button>
            {layoutMode && Boolean(samples?.length) && (
              <details>
                <summary>Available shortcuts</summary>
                <div className="shortcut-samples">
                  {samples?.map((control) => (
                    <button
                      key={`${control.kind}:${control.label}`}
                      onClick={() => {
                        setDraft((value) =>
                          value
                            ? `${value} "${control.label}"`
                            : `Add "${control.label}"`,
                        );
                        input.current?.focus();
                      }}
                    >
                      {control.label}
                    </button>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {turns.length > 0 && (
          <div className="transcript" aria-label="Page chat" aria-live="polite">
            {turns.map((turn, index) => (
              <p key={index} className={`message ${turn.role}`}>
                {turn.content}
              </p>
            ))}
          </div>
        )}

        {layoutMode && page?.preview && page.offerRemember && (
          <div className="decision">
            <h2>Do you want me to remember this layout?</h2>
            <p>
              Alorun will restore it for this page and count visits within this
              site.
            </p>
            <div className="buttons">
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  void operate(async () => {
                    if (!page.preview) return;
                    setPage(await remember(page, page.preview));
                    say(
                      "I’ll restore this layout whenever you return to this page.",
                    );
                  })
                }
              >
                Yes, remember it
              </button>
              <button
                className="secondary"
                disabled={busy}
                onClick={() =>
                  void operate(async () => {
                    setPage(await pageMessage({ type: "defer", scope: page }));
                    say(
                      "The preview will stay until you leave or reload this page.",
                    );
                  })
                }
              >
                Just for now
              </button>
            </div>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void operate(async () => {
                  setPage(await pageMessage({ type: "dismiss", scope: page }));
                  say(
                    page.saved
                      ? "Restored your remembered layout."
                      : "Closed the layout preview.",
                  );
                })
              }
            >
              Discard preview
            </button>
          </div>
        )}

        {layoutMode && page?.preview && !page.offerRemember && (
          <div className="saved-row">
            <span>Temporary preview</span>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void operate(async () => {
                  setPage(await pageMessage({ type: "dismiss", scope: page }));
                  say(
                    page.saved
                      ? "Restored your remembered layout."
                      : "Closed the layout preview.",
                  );
                })
              }
            >
              Discard preview
            </button>
          </div>
        )}
        {layoutMode && page?.saved && !page.preview && (
          <div className="saved-row">
            <span>Layout remembered</span>
            <button
              className="text-button"
              disabled={busy}
              onClick={() =>
                void operate(async () => {
                  setPage(await forget(page));
                  say("Removed the remembered layout for this page.");
                })
              }
            >
              Forget layout
            </button>
          </div>
        )}

        {actions && page && (
          <div className="decision">
            <div className="split">
              <h2>Review actions</h2>
              <button
                className="icon-button"
                aria-label="Discard actions"
                onClick={() => setActions(undefined)}
              >
                <X size={17} />
              </button>
            </div>
            <ol>
              {actions.map((action, index) => (
                <li key={index}>
                  {action.kind === "click" ? (
                    <>
                      Click <strong>{action.target}</strong>
                    </>
                  ) : (
                    <>
                      Type <strong>“{action.text}”</strong> in{" "}
                      <strong>{action.target}</strong>
                    </>
                  )}
                </li>
              ))}
            </ol>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void operate(async () => {
                  setPage(
                    await pageMessage({ type: "run", scope: page, actions }),
                  );
                  setActions(undefined);
                })
              }
            >
              <MousePointer2 size={16} aria-hidden="true" />
              Run on page
            </button>
          </div>
        )}
        {!layoutMode &&
          page?.run.state !== "idle" &&
          page?.run.message &&
          !actions && (
            <div className="run-state" role="status">
              <p>{page.run.message}</p>
              {running && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void operate(async () => {
                      setPage(await pageMessage({ type: "stop", scope: page }));
                    })
                  }
                >
                  Stop
                </button>
              )}
            </div>
          )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div ref={transcript} />
      </div>
      {page && (
        <form className="composer" onSubmit={submit}>
          <textarea
            ref={input}
            aria-label={
              layoutMode ? "Describe your layout" : "Describe browser actions"
            }
            placeholder={
              layoutMode
                ? "Describe your layout…"
                : "Describe what to click or type…"
            }
            rows={2}
            maxLength={1300}
            disabled={running}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            className="primary submit"
            aria-label={layoutMode ? "Preview layout" : "Review actions"}
            disabled={busy || running || !draft.trim()}
          >
            <CornerDownLeft size={19} aria-hidden="true" />
          </button>
        </form>
      )}
    </section>
  );
}
