import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { origin, startFixture } from "./fixture";

const extension = resolve("build/browser-test/chrome-mv3-prod");
let profile: string;
let context: BrowserContext;
let fixture: Awaited<ReturnType<typeof startFixture>>;
let site: Page;
let popup: Page;
let extensionId: string;

async function startBrowser() {
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    headless: true,
    ignoreDefaultArgs: ["--disable-extensions"],
    args: ["--enable-unsafe-extension-debugging"],
    viewport: { width: 1160, height: 840 },
  });
  const browser = context.browser();
  if (!browser) throw new Error("Chromium did not expose a browser session.");
  const cdp = await browser.newBrowserCDPSession();
  const installed = await cdp.send("Extensions.loadUnpacked", {
    path: extension,
  });
  extensionId = installed.id;
  await cdp.detach();
  site = context.pages()[0] ?? (await context.newPage());
  await site.goto(origin);
  popup = await context.newPage();
  await openPopup();
}

async function openPopup() {
  // The toolbar document is loaded in an extension tab so Playwright can address its controls.
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  await site.bringToFront();
  await expect(
    popup.getByRole("heading", { name: "Page tools" }),
  ).toBeVisible();
}

async function startPageTool(name: RegExp) {
  await site.bringToFront();
  // Playwright clicks activate this test tab. A toolbar popup leaves the host tab selected.
  await popup
    .getByRole("button", { name })
    .evaluate((button) => (button as HTMLButtonElement).click());
}

async function layoutTool() {
  await startPageTool(/Change this for me/);
  await expect(
    popup.getByRole("textbox", { name: "Describe your layout" }),
  ).toBeVisible();
}

async function actionTool() {
  await startPageTool(/Act on this page/);
  await expect(
    popup.getByRole("textbox", { name: "Describe browser actions" }),
  ).toBeVisible();
}

async function preview(prompt: string) {
  await popup
    .getByRole("textbox", { name: "Describe your layout" })
    .fill(prompt);
  await popup.getByRole("button", { name: "Preview layout" }).click();
  await expect(
    popup.getByRole("heading", {
      name: "Do you want me to remember this layout?",
    }),
  ).toBeVisible();
}

async function review(prompt: string) {
  await popup
    .getByRole("textbox", { name: "Describe browser actions" })
    .fill(prompt);
  await popup.getByRole("button", { name: "Review actions" }).click();
  await expect(
    popup.getByRole("heading", { name: "Review actions" }),
  ).toBeVisible();
}

test.beforeAll(async () => {
  fixture = await startFixture();
});
test.afterAll(async () => {
  await fixture?.close();
});
test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "alorun-browser-"));
  await startBrowser();
});
test.afterEach(async () => {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
});

test("previews and refines a responsive layout, preserves site controls, and discards a temporary preview", async ({}, testInfo) => {
  await popup.screenshot({
    path: testInfo.outputPath("popup-home.png"),
    clip: { x: 0, y: 0, width: 390, height: 490 },
  });
  await layoutTool();
  await preview(
    'Put "Reports" and "New note" in a compact, three-column panel at the top.',
  );
  const panel = site.getByRole("region", { name: "Alorun page layout" });
  await expect(
    panel.getByRole("heading", { name: "Most visited" }),
  ).toBeVisible();
  await expect(panel.getByRole("button")).toHaveText(["Reports", "New note"]);
  await panel.getByRole("button", { name: "New note" }).click();
  await expect(site.getByLabel("Note", { exact: true })).toBeVisible();
  await site.getByRole("button", { name: "Original tool" }).click();
  await expect(site.locator("#out")).toHaveText("Original works");

  await preview(
    'Remove "Reports" and move the panel to the bottom. Most visited first.',
  );
  await expect(panel.getByRole("button")).toHaveText(["New note"]);
  await expect(site.locator("body > :last-child")).toHaveAttribute(
    "id",
    "alorun-page-layout",
  );

  await site.setViewportSize({ width: 320, height: 720 });
  await expect
    .poll(() =>
      panel
        .locator(".sections")
        .evaluate(
          (node) =>
            getComputedStyle(node).gridTemplateColumns.split(" ").length,
        ),
    )
    .toBe(1);
  await expect
    .poll(() => site.evaluate(() => document.documentElement.scrollWidth))
    .toBe(320);
  await site.screenshot({
    path: testInfo.outputPath("layout-narrow.png"),
    fullPage: true,
  });
  await popup.getByRole("button", { name: "Just for now" }).click();
  await expect(panel).toBeVisible();
  await openPopup();
  await layoutTool();
  await expect(popup.getByText("Temporary preview")).toBeVisible();
  await site.reload();
  await expect(panel).toHaveCount(0);
});

test("remembers by page, ranks same-site visits, restores after browser restart, and forgets", async () => {
  await layoutTool();
  await preview('Put "Reports" and "Notes" at the top in two columns.');
  await popup.getByRole("button", { name: "Yes, remember it" }).click();
  await expect(
    popup.getByText("Layout remembered", { exact: true }),
  ).toBeVisible();
  const panel = site.getByRole("region", { name: "Alorun page layout" });
  for (const [path, count] of [
    ["/reports", 1],
    ["/notes", 1],
    ["/reports", 2],
  ] as const) {
    await site.goto(origin + path);
    await expect(panel).toHaveCount(0);
    await expect
      .poll(async () => {
        const worker = context.serviceWorkers()[0];
        return await worker?.evaluate(
          async ({ origin, path }) => {
            const key = `browser-site:${origin}`;
            const data =
              await chrome.storage.local.get<
                Record<string, { visits: { path: string; count: number }[] }>
              >(key);
            return (
              data[key]?.visits.find((item) => item.path === path)?.count ?? 0
            );
          },
          { origin, path },
        );
      })
      .toBe(count);
  }

  await site.goto(origin);
  await expect(panel.getByText("Remembered for this page")).toBeVisible();
  await expect(panel.getByRole("link").first()).toHaveText("Reports2 visits");
  await expect(panel.getByRole("link").last()).toHaveAttribute(
    "href",
    origin + "/notes",
  );
  await site.getByRole("button", { name: "Open activity" }).click();
  await expect(panel).toHaveCount(0);
  await site.goBack();
  await expect(panel).toBeVisible();

  await context.close();
  await startBrowser();
  const restored = site.getByRole("region", { name: "Alorun page layout" });
  await expect(
    restored.getByRole("heading", { name: "Shortcuts", exact: true }),
  ).toBeVisible();
  await layoutTool();
  await popup.getByRole("button", { name: "Forget layout" }).click();
  await expect(restored).toHaveCount(0);
  await site.reload();
  await expect(restored).toHaveCount(0);
});

test("runs reviewed clicks and types each grapheme without pasting in ordinary and rich fields", async () => {
  await actionTool();
  await review(
    'Click "New note" then type "café 👋" into "Note" then type "Hi" into "Draft".',
  );
  await expect(site.getByLabel("Note", { exact: true })).toBeHidden();
  await popup.getByRole("button", { name: "Run on page" }).click();
  await expect(site.locator("#alorun-page-runner .pointer")).toBeVisible();
  await expect(site.getByLabel("Note", { exact: true })).toHaveValue("café 👋");
  await expect(site.getByRole("textbox", { name: "Draft" })).toHaveText("Hi");
  await expect(
    site.locator("#alorun-page-runner").getByRole("status"),
  ).toHaveText("Completed 3 actions.");
  const events = await site.evaluate(
    () =>
      (
        window as unknown as {
          events: {
            type: string;
            value: string;
            data?: string;
            key?: string;
          }[];
        }
      ).events,
  );
  expect(events.filter(({ type }) => type === "paste")).toEqual([]);
  expect(
    events.filter(({ type }) => type === "input").map(({ value }) => value),
  ).toEqual(["c", "ca", "caf", "café", "café ", "café 👋", "H", "Hi"]);
  expect(
    events.filter(({ type }) => type === "keydown").map(({ key }) => key),
  ).toEqual(["c", "a", "f", "é", " ", "👋", "H", "i"]);
});

test("stops in-flight typing and rejects ambiguous, sensitive and stale-page plans", async () => {
  await actionTool();
  await review('Click "Duplicate"');
  await popup.getByRole("button", { name: "Run on page" }).click();
  await expect(popup.getByRole("alert")).toContainText("more than one");
  await review('Type "value" into "Password"');
  await popup.getByRole("button", { name: "Run on page" }).click();
  await expect(popup.getByRole("alert")).toContainText(
    "No available text field",
  );
  await review('Click "Delete account"');
  await popup.getByRole("button", { name: "Run on page" }).click();
  await expect(popup.getByRole("alert")).toContainText("No available button");
  await review(
    'Type "The first draft should never be completed after stopping" into "Search"',
  );
  await popup.getByRole("button", { name: "Run on page" }).click();
  const search = site.getByRole("searchbox", { name: "Search" });
  await expect(search).toHaveValue(/^T/);
  await site.keyboard.press("Escape");
  await expect(
    site.locator("#alorun-page-runner").getByRole("status"),
  ).toContainText("Stopped by you.");
  await expect(search).not.toHaveValue(
    "The first draft should never be completed after stopping",
  );

  await review('Click "Original tool"');
  await site.getByRole("button", { name: "Open activity" }).click();
  await popup.getByRole("button", { name: "Run on page" }).click();
  await expect(popup.getByRole("alert")).toContainText("The page changed");
  await expect(site.locator("#out")).toBeEmpty();
});

test("opens existing Alorun workflows against the shared API contract", async () => {
  await popup.getByRole("button", { name: "Today & goals" }).click();
  await popup.getByLabel("Email").fill("tester@example.test");
  await popup.getByLabel("Password").fill("test-only-password");
  await popup.getByRole("button", { name: "Sign in" }).click();
  await expect(popup.getByText("Finish a project")).toBeVisible();
  await popup.getByRole("button", { name: "Add goal" }).click();
  await popup.getByLabel("Goal title").fill("Ship browser tools");
  await popup.getByRole("button", { name: "Save goal" }).click();
  await expect(popup.getByText("Ship browser tools")).toBeVisible();
  await popup.getByRole("button", { name: "Outline next steps" }).click();
  await expect(
    popup.getByRole("button", { name: "Outline next steps" }),
  ).toHaveAttribute("aria-pressed", "true");
  await popup.getByRole("button", { name: "Workspace", exact: true }).click();

  await popup.getByRole("button", { name: "Conversations" }).click();
  await popup
    .getByLabel("Message", { exact: true })
    .fill("What should I do first?");
  await popup.getByRole("button", { name: "Send message" }).click();
  await expect(
    popup.getByText("Start by reviewing your project outline."),
  ).toBeVisible();
  expect(
    fixture.calls.some(
      ({ path, method }) => path === "/v1/chat/history" && method === "POST",
    ),
  ).toBe(false);
  await popup.getByRole("button", { name: "Workspace", exact: true }).click();

  await popup.getByRole("button", { name: "Missions" }).click();
  await popup.getByRole("button", { name: /Weekly review/ }).click();
  await expect(
    popup.getByRole("heading", { name: "Run history" }),
  ).toBeVisible();
  await popup.getByRole("button", { name: "Pause mission" }).click();
  await expect(
    popup.getByRole("button", { name: "Resume mission" }),
  ).toBeVisible();
  await popup.getByRole("button", { name: "Workspace", exact: true }).click();

  await popup.getByRole("button", { name: "Settings chat" }).click();
  await popup.getByLabel("Ask about a setting").fill("Save chat history");
  await popup.getByRole("button", { name: "Find settings" }).click();
  await popup.getByRole("button", { name: "Turn on chat history" }).click();
  await expect(
    popup.getByRole("button", { name: "Turn off chat history" }),
  ).toBeVisible();
  await popup.getByRole("button", { name: "Workspace", exact: true }).click();
  await popup.getByRole("button", { name: "Conversations" }).click();
  await popup
    .getByLabel("Message", { exact: true })
    .fill("What should I do next?");
  await popup.getByRole("button", { name: "Send message" }).click();
  await expect
    .poll(() =>
      fixture.calls.some(
        ({ path, method }) => path === "/v1/chat/history" && method === "POST",
      ),
    )
    .toBe(true);
});
