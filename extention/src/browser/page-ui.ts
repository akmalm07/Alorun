import type { Layout } from "./plans";
import type { RunStatus, Visit } from "./protocol";
import { findShortcut } from "./targets";

function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  return node;
}

function mount(id: string, styles: string) {
  const host = element("div");
  host.id = id;
  Object.assign(host.style, {
    all: "initial",
    display: "block",
    position: id === "alorun-page-runner" ? "fixed" : "relative",
    ...(id === "alorun-page-runner"
      ? { inset: "0", zIndex: "2147483647", pointerEvents: "none" }
      : {}),
  });
  const root = host.attachShadow({ mode: "open" });
  const style = element("style", styles);
  root.append(style);
  return { host, root };
}

const layoutStyles = `
  * { box-sizing: border-box; }
  .panel { background:#202422; color:#f4f6f4; border:1px solid #3b433e; border-radius:14px;
    width:min(calc(100% - 24px), 1140px); margin:12px auto; padding:18px; text-align:left;
    font: 14px/1.5 system-ui,sans-serif; container-type:inline-size; color-scheme:dark; }
  .compact { padding:12px; }
  .head { display:flex; flex-wrap:wrap; justify-content:space-between; gap:4px 12px; align-items:baseline; margin-bottom:12px; }
  h2,h3,p { margin:0; }
  h2 { font-size:17px; letter-spacing:-.02em; }
  h3 { font-size:13px; font-weight:650; margin-bottom:7px; }
  .meta,.quiet { color:#b1b9b3; font-size:12px; }
  .sections { display:grid; grid-template-columns:minmax(0,3fr) minmax(0,2fr); gap:16px; }
  .sections:has(> :only-child) { grid-template-columns:minmax(0,1fr); }
  .controls { display:grid; grid-template-columns:repeat(var(--columns),minmax(0,1fr)); gap:6px; }
  .links { display:grid; gap:4px; }
  .control, a { font:inherit; color:inherit; display:block; text-align:left; min-height:36px; padding:7px 10px;
    overflow-wrap:anywhere; border:1px solid #3b433e; border-radius:8px; background:#2a302c; text-decoration:none; }
  button.control { cursor:pointer; }
  a { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  .count { color:#8cdbad; white-space:nowrap; font-size:11px; font-variant-numeric:tabular-nums; }
  .control:hover,a:hover { background:#2d4538; }
  .control:focus-visible,a:focus-visible { outline:2px solid #8cdbad; outline-offset:2px; }
  @container (max-width:610px) { .sections { grid-template-columns:minmax(0,1fr); gap:12px; } }
  @container (max-width:360px) { .controls { grid-template-columns:minmax(0,1fr); } }
`;

export function layoutPanel() {
  const { host, root } = mount("alorun-page-layout", layoutStyles);
  const panel = element("section");
  panel.setAttribute("aria-label", "Alorun page layout");
  root.append(panel);
  let position: Layout["position"] | undefined;
  let previousDisplay = "";
  host.style.gridColumn = "1 / -1";
  host.style.flexShrink = "0";

  return {
    remove() {
      host.remove();
    },
    mounted() {
      return host.isConnected;
    },
    update(layout: Layout, preview: boolean, visits: Visit[], origin: string) {
      if (!host.isConnected || position !== layout.position) {
        const bodyStyle = getComputedStyle(document.body);
        const row =
          bodyStyle.display.includes("flex") &&
          bodyStyle.flexDirection.startsWith("row");
        const parent = row
          ? (document.querySelector("main,[role=main]") ?? document.body)
          : document.body;
        if (layout.position === "top") parent.prepend(host);
        else parent.append(host);
        position = layout.position;
      }
      const display = JSON.stringify([layout, preview, visits]);
      if (previousDisplay === display) return;
      previousDisplay = display;
      panel.className =
        layout.density === "compact" ? "panel compact" : "panel";
      panel.style.setProperty("--columns", String(layout.columns));
      const head = element("div");
      head.className = "head";
      const meta = element(
        "span",
        preview ? "Preview" : "Remembered for this page",
      );
      meta.className = "meta";
      head.append(element("h2", "Alorun page shortcuts"), meta);
      const sections = element("div");
      sections.className = "sections";
      const shortcuts = element("section");
      shortcuts.append(element("h3", "Shortcuts"));
      const controls = element("div");
      controls.className = "controls";
      const status = element("p");
      status.className = "quiet";
      status.setAttribute("role", "status");
      for (const control of layout.shortcuts) {
        const button = element("button", control.label);
        button.type = "button";
        button.className = "control";
        button.addEventListener("click", () => {
          const target = findShortcut(control);
          if (target) {
            status.textContent = "";
            target.click();
          } else {
            status.textContent = `“${control.label}” is currently unavailable.`;
          }
        });
        controls.append(button);
      }
      shortcuts.append(controls, status);
      const history = element("section");
      history.append(element("h3", "Most visited"));
      if (visits.length) {
        const links = element("div");
        links.className = "links";
        for (const visit of visits) {
          const url = new URL(origin + visit.path);
          if (url.origin !== origin) continue;
          const link = element("a", visit.title);
          link.href = url.href;
          const count = element(
            "span",
            `${visit.count} ${visit.count === 1 ? "visit" : "visits"}`,
          );
          count.className = "count";
          link.append(count);
          links.append(link);
        }
        history.append(links);
      } else {
        const empty = element(
          "p",
          "Pages you visit after remembering a layout will appear here.",
        );
        empty.className = "quiet";
        history.append(empty);
      }
      if (layout.first === "visits") sections.append(history);
      if (layout.shortcuts.length) sections.append(shortcuts);
      if (layout.first === "shortcuts") sections.append(history);
      panel.replaceChildren(head, sections);
    },
  };
}

const runnerStyles = `
  * { box-sizing:border-box; }
  .status { pointer-events:auto; position:fixed; bottom:12px; right:12px; max-width:min(350px,calc(100vw - 24px));
    display:flex; align-items:center; gap:10px; background:#202422; color:#f4f6f4; border:1px solid #52655a; border-radius:12px;
    padding:10px 12px; font:14px/1.4 system-ui,sans-serif; box-shadow:0 8px 24px #0004; }
  .button { font:inherit; background:#8cdbad; color:#10261a; border:none; padding:6px 10px; border-radius:6px; cursor:pointer; }
  .button:focus-visible { outline:2px solid #f4f6f4; outline-offset:2px; }
  .pointer { position:fixed; top:0; left:0; width:20px; height:25px; background:#8cdbad;
    clip-path:polygon(0 0, 100% 61%, 54% 66%, 65% 97%, 46% 100%, 32% 70%, 0 90%);
    filter:drop-shadow(0 2px 2px #000); transition:transform .24s ease-out; }
  .pointer[hidden] { display:none; }
  @media (prefers-reduced-motion:reduce) { .pointer { transition:none; } }
`;

export function runnerPanel(stop: () => void) {
  const { host, root } = mount("alorun-page-runner", runnerStyles);
  const status = element("div");
  status.className = "status";
  const message = element("span");
  message.setAttribute("role", "status");
  const stopButton = element("button", "Stop");
  stopButton.type = "button";
  stopButton.className = "button";
  const cursor = element("div");
  cursor.className = "pointer";
  cursor.setAttribute("aria-hidden", "true");
  stopButton.addEventListener("click", stop);
  status.append(message, stopButton);
  root.append(status, cursor);

  return {
    update(run: RunStatus) {
      if (run.state === "idle") {
        host.remove();
        return;
      }
      if (!host.isConnected) document.body.append(host);
      const running = run.state === "running";
      message.textContent = run.message;
      cursor.hidden = !running;
      stopButton.textContent = running ? "Stop" : "Dismiss";
    },
    move(x: number, y: number) {
      cursor.style.transform = `translate(${x}px, ${y}px)`;
    },
  };
}
