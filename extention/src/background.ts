import { extensionApi } from "./browser/extension-api";
import {
  hostPattern,
  pageAddress,
  readSite,
  respond,
  siteKey,
  workerRequest,
  type SiteState,
} from "./browser/protocol";

const pending = new Map<string, Promise<void>>();

function changeSite(
  origin: string,
  update: (site: SiteState) => SiteState | undefined,
) {
  const job = (pending.get(origin) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const next = update(await readSite(origin));
      if (!next) return;
      if (Object.keys(next.pages).length) {
        await extensionApi.storage.local.set({ [siteKey(origin)]: next });
      } else {
        await extensionApi.storage.local.remove(siteKey(origin));
      }
    });
  pending.set(origin, job);
  const clear = () => {
    if (pending.get(origin) === job) pending.delete(origin);
  };
  void job.then(clear, clear);
  return job;
}

extensionApi.runtime.onMessage.addListener((message: unknown, sender, send) => {
  if (sender.id !== extensionApi.runtime.id) return;
  const checked = workerRequest.safeParse(message);
  if (!checked.success) return;
  const request = checked.data;
  const address = pageAddress(request.href);
  if (!address || address.path.length > 1024) return;
  const { origin, path } = address;
  if (request.type === "visit") {
    if (!sender.tab || sender.frameId !== 0 || sender.origin !== origin) return;
    return respond(
      changeSite(origin, (site) => {
        if (!Object.keys(site.pages).length) return;
        const previous = site.visits.find((visit) => visit.path === path);
        const visit = {
          path,
          title: request.title.trim() || path,
          count: (previous?.count ?? 0) + 1,
          last: Date.now(),
        };
        return {
          pages: site.pages,
          visits: [visit, ...site.visits.filter((item) => item.path !== path)]
            .sort((a, b) => b.count - a.count || b.last - a.last)
            .slice(0, 50),
        };
      }),
      send,
    );
  }

  if (sender.tab && !sender.url?.startsWith(extensionApi.runtime.getURL("")))
    return;
  if (request.type === "forget") {
    return respond(
      changeSite(origin, (site) => {
        const pages = { ...site.pages };
        delete pages[path];
        return { ...site, pages };
      }),
      send,
    );
  }
  return respond(
    (async () => {
      const pattern = hostPattern(origin);
      if (
        !pattern ||
        !(await extensionApi.permissions.contains({ origins: [pattern] }))
      ) {
        throw new Error(
          "Allow access to this site to restore its layout after a reload.",
        );
      }
      await changeSite(origin, (site) => {
        if (!site.pages[path] && Object.keys(site.pages).length >= 50)
          throw new Error(
            "This site already has 50 saved layouts. Forget a layout before adding another.",
          );
        return { ...site, pages: { ...site.pages, [path]: request.layout } };
      });
    })(),
    send,
  );
});

async function restoreForTab(tabId: number, href: string) {
  const address = pageAddress(href);
  if (!address) return;
  const site = await readSite(address.origin);
  if (!Object.keys(site.pages).length) return;
  try {
    await extensionApi.scripting.executeScript({
      target: { tabId },
      files: ["page-runtime.js"],
    });
  } catch {
    // A closed tab, revoked permission or protected page can no longer be injected.
  }
}

extensionApi.tabs.onUpdated.addListener((id, change, tab) => {
  if (change.status === "complete" && tab.url) {
    void restoreForTab(id, tab.url).catch(() => undefined);
  }
});
extensionApi.tabs.onActivated.addListener(({ tabId }) => {
  void extensionApi.tabs
    .get(tabId)
    .then((tab) =>
      tab.status === "complete" && tab.url
        ? restoreForTab(tabId, tab.url)
        : undefined,
    )
    .catch(() => undefined);
});
