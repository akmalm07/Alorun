import { extensionApi } from "./extension-api";
import type { Layout, PageAction } from "./plans";
import { layoutPanel, runnerPanel } from "./page-ui";
import {
  decodeSite,
  pageAddress,
  pageRequest,
  readSite,
  respond,
  siteKey,
  type BrowserSnapshot,
  type PageRequest,
  type RunStatus,
  type SiteState,
} from "./protocol";
import { availableControls, findActionTarget, visible } from "./targets";

type RuntimeGlobal = typeof globalThis & { alorunPageRuntime?: boolean };
const scope = globalThis as RuntimeGlobal;
if (!scope.alorunPageRuntime) {
  scope.alorunPageRuntime = true;
  initialize();
}

function initialize() {
  const instance = Array.from(
    crypto.getRandomValues(new Uint8Array(16)),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
  const panel = layoutPanel();
  const runner = runnerPanel(() => stopOrDismiss());
  let lastHref = "";
  let visitedPath = "";
  let site: SiteState = { pages: {}, visits: [] };
  let preview: Layout | undefined;
  let offerRemember = false;
  let saved: Layout | undefined;
  let run: RunStatus = { state: "idle", message: "" };
  let controller: AbortController | undefined;
  let routeReady = Promise.resolve();

  function state(next: RunStatus) {
    run = next;
    runner.update(run);
  }

  function stopOrDismiss() {
    if (controller) controller.abort("Stopped by you.");
    else state({ state: "idle", message: "" });
  }

  function render() {
    const address = pageAddress(location.href);
    const layout = preview ?? saved;
    if (!address || !layout || !document.body) {
      panel.remove();
      return;
    }
    const visits = site.visits
      .filter((item) => item.path !== address.path)
      .slice(0, 5);
    panel.update(layout, Boolean(preview), visits, address.origin);
  }

  function recordVisit() {
    const address = pageAddress(location.href);
    if (
      !address ||
      address.path === visitedPath ||
      !Object.keys(site.pages).length
    )
      return;
    visitedPath = address.path;
    void extensionApi.runtime
      .sendMessage({
        type: "visit",
        href: location.href,
        title: document.title.trim().replace(/\s+/g, " ").slice(0, 100),
      })
      .catch(() => undefined);
  }

  function syncRoute() {
    const href = location.href;
    if (href === lastHref) {
      if ((preview || saved) && !panel.mounted()) render();
      return routeReady;
    }
    const previous = pageAddress(lastHref);
    const next = pageAddress(href);
    if (lastHref)
      controller?.abort("The page changed. Review a new action on this page.");
    lastHref = href;
    if (previous?.path !== next?.path) {
      preview = undefined;
      offerRemember = false;
      saved = undefined;
      visitedPath = "";
      render();
    }
    routeReady = (async () => {
      if (!next) return;
      const current = await readSite(next.origin);
      if (location.href !== href) return;
      site = current;
      saved = site.pages[next.path];
      render();
      recordVisit();
    })();
    return routeReady;
  }

  function snapshot(): BrowserSnapshot {
    return {
      instance,
      href: location.href,
      controls: availableControls(),
      preview,
      offerRemember,
      saved,
      run,
    };
  }

  async function handle(request: PageRequest) {
    await syncRoute();
    if (request.type === "inspect") return snapshot();
    if (
      request.scope.instance !== instance ||
      request.scope.href !== location.href
    )
      throw new Error(
        "The page changed. Reopen the tool and review your request.",
      );
    switch (request.type) {
      case "preview":
        preview = request.layout;
        offerRemember = true;
        render();
        return snapshot();
      case "defer":
        offerRemember = false;
        return snapshot();
      case "dismiss":
        preview = undefined;
        offerRemember = false;
        render();
        return snapshot();
      case "stop":
        stopOrDismiss();
        return snapshot();
      case "run": {
        if (controller)
          throw new Error("An action is already running on this page.");
        findActionTarget(request.actions[0].kind, request.actions[0].target);
        const job = new AbortController();
        controller = job;
        state({ state: "running", message: "Starting reviewed actions…" });
        void perform(request.actions, job.signal).finally(() => {
          controller = undefined;
        });
        return snapshot();
      }
    }
  }

  extensionApi.runtime.onMessage.addListener(
    (message: unknown, sender, send) => {
      if (sender.id !== extensionApi.runtime.id) return;
      const checked = pageRequest.safeParse(message);
      if (checked.success) return respond(handle(checked.data), send);
    },
  );
  extensionApi.storage.onChanged.addListener((changes, area) => {
    const address = pageAddress(location.href);
    if (!address || area !== "local") return;
    const change = changes[siteKey(address.origin)];
    if (!change) return;
    if (location.href !== lastHref) {
      void syncRoute().catch(() => undefined);
      return;
    }
    site = decodeSite(change.newValue);
    if (!Object.keys(site.pages).length) visitedPath = "";
    saved = site.pages[address.path];
    render();
    recordVisit();
  });
  window.addEventListener("popstate", () => {
    void syncRoute().catch(() => undefined);
  });
  window.addEventListener("hashchange", () => {
    void syncRoute().catch(() => undefined);
  });
  window.addEventListener("pagehide", () =>
    controller?.abort("The page was left."),
  );
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      lastHref = "";
      visitedPath = "";
      void syncRoute().catch(() => undefined);
    }
  });
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.isTrusted && event.key === "Escape" && controller) {
        event.preventDefault();
        stopOrDismiss();
      }
    },
    true,
  );

  // History API calls from the site's JavaScript world do not emit popstate.
  window.setInterval(() => {
    void syncRoute().catch(() => undefined);
  }, 250);
  void syncRoute().catch(() => undefined);

  async function perform(actions: PageAction[], signal: AbortSignal) {
    const href = location.href;
    let completed = 0;

    function assertCurrent() {
      signal.throwIfAborted();
      if (location.href !== href)
        throw new Error("The page changed. Review a new action on this page.");
    }

    async function pause(milliseconds: number) {
      await new Promise((resolve) => window.setTimeout(resolve, milliseconds));
      assertCurrent();
    }

    try {
      await pause(180);
      for (const [index, action] of actions.entries()) {
        assertCurrent();
        state({
          state: "running",
          message: `${index + 1} of ${actions.length} · ${action.kind === "click" ? "Clicking" : "Typing in"} ${action.target}`,
        });
        let target: HTMLElement | undefined;
        // A previous click may reveal this control asynchronously.
        for (let attempt = 0; attempt < 8; attempt++) {
          try {
            target = findActionTarget(action.kind, action.target);
            break;
          } catch (error) {
            if (
              attempt === 7 ||
              (error instanceof Error &&
                error.message.includes("more than one"))
            )
              throw error;
            await pause(100);
          }
        }
        if (!target) throw new Error("The page control is unavailable.");
        if (
          action.kind === "click" &&
          target instanceof HTMLAnchorElement &&
          new URL(target.href).href !== href &&
          index < actions.length - 1
        )
          throw new Error(
            "Put a link that opens another page last in the action list.",
          );
        target.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "instant",
        });
        const rect = target.getBoundingClientRect();
        const x = Math.max(
          0,
          Math.min(innerWidth - 1, rect.left + rect.width / 2),
        );
        const y = Math.max(
          0,
          Math.min(innerHeight - 1, rect.top + rect.height / 2),
        );
        runner.move(x, y);
        await pause(260);
        if (
          findActionTarget(action.kind, action.target) !== target ||
          !visible(target)
        )
          throw new Error("The page control moved. Review the action again.");
        const hit = document.elementFromPoint(x, y);
        if (!hit || !target.contains(hit))
          throw new Error(
            "Another element covers this control. Close it and try again.",
          );
        pointer(target, x, y);
        assertCurrent();

        if (action.kind === "type") {
          if (document.activeElement !== target)
            throw new Error("The text field did not accept focus.");
          // Start at a browser-managed caret. Chromium inserts each grapheme and emits an input event.
          if (
            target instanceof HTMLInputElement ||
            target instanceof HTMLTextAreaElement
          ) {
            target.setSelectionRange(target.value.length, target.value.length);
          } else {
            const selection = getSelection();
            selection?.selectAllChildren(target);
            selection?.collapseToEnd();
          }
          const characters = new Intl.Segmenter(undefined, {
            granularity: "grapheme",
          }).segment(action.text);
          for (const { segment } of characters) {
            assertCurrent();
            if (document.activeElement !== target || !visible(target))
              throw new Error("The text field lost focus.");
            typeCharacter(target, segment);
            await pause(48);
          }
        }
        completed++;
        if (index < actions.length - 1) await pause(130);
      }
      state({
        state: "done",
        message: `Completed ${completed} ${completed === 1 ? "action" : "actions"}.`,
      });
    } catch (error) {
      const detail =
        typeof error === "string"
          ? error
          : error instanceof Error
            ? error.message
            : "The page changed.";
      state({
        state: signal.aborted ? "stopped" : "failed",
        message: completed
          ? `${detail} ${completed} of ${actions.length} actions completed.`
          : detail,
      });
    }
  }
}

function pointer(target: HTMLElement, x: number, y: number) {
  const event = {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: x,
    clientY: y,
    button: 0,
  };
  const pointerEvent = {
    ...event,
    pointerType: "mouse",
    isPrimary: true,
    pointerId: 1,
  };
  if (
    !target.dispatchEvent(
      new PointerEvent("pointerdown", { ...pointerEvent, buttons: 1 }),
    )
  ) {
    throw new Error("The page blocked the pointer action.");
  }
  if (
    target.dispatchEvent(new MouseEvent("mousedown", { ...event, buttons: 1 }))
  ) {
    target.focus({ preventScroll: true });
  }
  target.dispatchEvent(new PointerEvent("pointerup", pointerEvent));
  target.dispatchEvent(new MouseEvent("mouseup", event));
  target.dispatchEvent(
    new PointerEvent("click", { ...pointerEvent, detail: 1 }),
  );
}

function typeCharacter(target: HTMLElement, character: string) {
  const key = character === "\n" ? "Enter" : character;
  const event = { key, bubbles: true, cancelable: true, composed: true };
  if (!target.dispatchEvent(new KeyboardEvent("keydown", event))) {
    throw new Error("The page prevented a keystroke.");
  }
  try {
    if (
      !target.dispatchEvent(
        new InputEvent("beforeinput", {
          inputType: "insertText",
          data: character,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      )
    )
      throw new Error("The field prevented text entry.");
    if (!document.execCommand("insertText", false, character)) {
      throw new Error("The field did not accept text entry.");
    }
  } finally {
    target.dispatchEvent(new KeyboardEvent("keyup", event));
  }
}
