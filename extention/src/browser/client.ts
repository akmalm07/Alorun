import { extensionApi } from "./extension-api";
import {
  errorText,
  hostPattern,
  pageAddress,
  type BrowserSnapshot,
  type PageRequest,
  type Reply,
  type WorkerRequest,
} from "./protocol";
import type { Layout } from "./plans";

let tabId: number | undefined;

export async function activePage() {
  const [tab] = await extensionApi.tabs.query({
    active: true,
    currentWindow: true,
  });
  const address = pageAddress(tab?.url ?? "");
  if (!tab?.id || !address)
    throw new Error("Open a regular website to use page tools.");
  tabId = tab.id;
  const origin = address.origin;
  let page: BrowserSnapshot;
  try {
    page = await inspect();
  } catch {
    try {
      await extensionApi.scripting.executeScript({
        target: { tabId },
        files: ["page-runtime.js"],
      });
      page = await inspect();
    } catch {
      throw new Error(
        "Alorun couldn't connect to this page. Reload it and reopen Alorun, or try another website.",
      );
    }
  }
  if (pageAddress(page.href)?.origin !== origin)
    throw new Error("The active website changed. Reopen the tool.");
  return page;
}

function unwrap<T>(value?: Reply<T>): T {
  if (!value) throw new Error("The page connection ended. Reopen the tool.");
  if (!value.ok) throw new Error(value.error);
  return value.value;
}

export async function pageMessage(message: PageRequest) {
  if (tabId === undefined)
    throw new Error("Open a regular website to use page tools.");
  try {
    return unwrap<BrowserSnapshot>(
      await extensionApi.tabs.sendMessage(tabId, message, { frameId: 0 }),
    );
  } catch (error) {
    const message = errorText(error);
    if (/receiving end|message port/i.test(message)) {
      throw new Error("The page connection ended. Reopen the tool.");
    }
    throw error;
  }
}

export const inspect = () => pageMessage({ type: "inspect" });

export async function remember(page: BrowserSnapshot, layout: Layout) {
  const pattern = hostPattern(page.href);
  if (!pattern) throw new Error("Open a regular website to save its layout.");
  if (!(await extensionApi.permissions.request({ origins: [pattern] }))) {
    throw new Error(
      "Site access is required to restore this layout. The preview is still open.",
    );
  }
  const current = await inspect();
  if (current.instance !== page.instance || current.href !== page.href)
    throw new Error(
      "The page changed. Reopen the tool and review your layout.",
    );
  const request: WorkerRequest = { type: "save", href: page.href, layout };
  unwrap(await extensionApi.runtime.sendMessage(request));
  return pageMessage({ type: "dismiss", scope: page });
}

export async function forget(page: BrowserSnapshot) {
  const current = await inspect();
  if (current.instance !== page.instance || current.href !== page.href)
    throw new Error(
      "The page changed. Reopen the tool before forgetting its layout.",
    );
  const request: WorkerRequest = { type: "forget", href: page.href };
  unwrap(await extensionApi.runtime.sendMessage(request));
  return pageMessage({ type: "dismiss", scope: page });
}
