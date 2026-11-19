import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { By, Key, until, type Locator } from "selenium-webdriver";
import {
  Context,
  Driver,
  Options,
  ServiceBuilder,
} from "selenium-webdriver/firefox";
import { origin, startFixture } from "./fixture";

const bundle = resolve("build/browser-test/firefox-mv3-prod");
const panel = "#alorun-page-layout";
const runner = "#alorun-page-runner";

// Runtime APIs in Selenium 4.53 are newer than its separate TypeScript declarations.
type FirefoxDriver = Driver & {
  installWebExtension(
    path: string,
    options: { permanent: boolean },
  ): Promise<{ id: string }>;
};

let driver: FirefoxDriver;
let fixture: Awaited<ReturnType<typeof startFixture>>;
let profile: string;
let uuid: string;
let siteTab: string;
let popupTab: string;

async function startFirefox() {
  const manifest = JSON.parse(
    await readFile(join(bundle, "manifest.json"), "utf8"),
  );
  const addonId: string = manifest.browser_specific_settings.gecko.id;
  const options = new Options()
    .addArguments(
      "-headless",
      "--remote-allow-system-access",
      "-profile",
      profile,
    )
    .setPreference(
      "extensions.webextensions.uuids",
      JSON.stringify({ [addonId]: uuid }),
    )
    .setPreference("extensions.webextensions.keepStorageOnUninstall", true)
    .setPreference("extensions.webextensions.keepUuidOnUninstall", true);
  if (process.env.FIREFOX_BINARY) options.setBinary(process.env.FIREFOX_BINARY);
  options.enableBidi();
  const service = new ServiceBuilder(
    process.env.GECKODRIVER_PATH ?? "geckodriver",
  );
  driver = Driver.createSession(options, service.build()) as FirefoxDriver;
  const installed = await driver.installWebExtension(bundle, {
    permanent: false,
  });
  expect(installed.id).toBe(addonId);
  await driver.get(origin);
  siteTab = await driver.getWindowHandle();
  await driver.switchTo().newWindow("tab");
  popupTab = await driver.getWindowHandle();
  await openPopup();
}

async function openPopup() {
  await driver.switchTo().window(popupTab);
  // Firefox blocks ordinary WebDriver navigation to privileged extension pages.
  // Open the installed add-on document with the isolated profile's browser UI.
  await driver.setContext(Context.CHROME);
  try {
    await driver.executeScript(
      `gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {
        triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
      });`,
      `moz-extension://${uuid}/popup.html`,
    );
  } finally {
    await driver.setContext(Context.CONTENT);
  }
  await expectBody("Page tools");
}

async function expectBody(text: string) {
  await expect
    .poll(() =>
      driver.executeScript<string>("return document.body?.innerText ?? ''"),
    )
    .toContain(text);
}

function button(text: string) {
  return By.xpath(`//button[normalize-space(.)=${JSON.stringify(text)}]`);
}

async function click(locator: Locator | string) {
  const element = await driver.wait(
    until.elementLocated(
      typeof locator === "string" ? button(locator) : locator,
    ),
    6000,
  );
  await driver.wait(until.elementIsEnabled(element), 6000);
  await element.click();
}

async function typeInto(selector: string, text: string) {
  const element = await driver.wait(
    until.elementLocated(By.css(selector)),
    6000,
  );
  await element.clear();
  await element.sendKeys(text);
}

async function chooseTool(mode: "layout" | "action") {
  await driver.switchTo().window(popupTab);
  // Like a toolbar popup, the popup document should query the selected site tab.
  const result = await driver.executeAsyncScript<string | null>(
    `
      const [fixtureOrigin, selector, done] = arguments;
      browser.tabs.query({currentWindow: true})
        .then(tabs => tabs.find(tab => tab.url && new URL(tab.url).origin === fixtureOrigin))
        .then(tab => browser.tabs.update(tab.id, {active: true}))
        .then(() => { document.querySelector(selector).click(); done(null); })
        .catch(error => done(error.message));
    `,
    origin,
    `.${mode}-card`,
  );
  expect(result).toBeNull();
  await driver.switchTo().window(popupTab);
  await driver.wait(until.elementLocated(By.css(".tool textarea")), 6000);
}

async function prompt(text: string, layout = false) {
  await typeInto(".tool textarea", text);
  await click(
    By.css(
      `button[aria-label="${layout ? "Preview layout" : "Review actions"}"]`,
    ),
  );
  await expectBody(
    layout ? "Do you want me to remember this layout?" : "Review actions",
  );
}

async function shadowValues(host: string, selector: string) {
  return driver.executeScript<string[]>(
    `return Array.from(document.querySelector(arguments[0])?.shadowRoot?.querySelectorAll(arguments[1]) ?? [],
      element => element.textContent.trim());`,
    host,
    selector,
  );
}

async function expectPanel(visible: boolean) {
  await expect
    .poll(() =>
      driver.findElements(By.css(panel)).then((items) => items.length),
    )
    .toBe(visible ? 1 : 0);
}

async function capture(path: string) {
  await writeFile(path, await driver.takeScreenshot(), "base64");
}

test.describe.configure({ timeout: 60_000 });
test.beforeAll(async () => {
  fixture = await startFixture();
});
test.afterAll(async () => {
  await fixture?.close();
});
test.beforeEach(async () => {
  profile = await mkdtemp(join(tmpdir(), "alorun-firefox-"));
  uuid = randomUUID();
  await startFirefox();
});
test.afterEach(async () => {
  try {
    await driver?.quit();
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
});

test("previews and refines a responsive layout, preserves site controls, and discards a temporary preview", async ({}, testInfo) => {
  await capture(testInfo.outputPath("firefox-popup.png"));
  await chooseTool("layout");
  await prompt(
    'Put "Reports" and "New note" in a compact, three-column panel at the top.',
    true,
  );
  await driver.switchTo().window(siteTab);
  await expect.poll(() => shadowValues(panel, "h3")).toContain("Most visited");
  await expect
    .poll(() => shadowValues(panel, "button"))
    .toEqual(["Reports", "New note"]);
  const shortcuts = await driver.findElement(By.css(panel)).getShadowRoot();
  const shortcut = await shortcuts.findElement(
    By.css(".controls button:nth-child(2)"),
  );
  await shortcut.click();
  expect(await driver.findElement(By.id("note")).isDisplayed()).toBe(true);
  await click(By.id("original"));
  await expectBody("Original works");

  await driver.switchTo().window(popupTab);
  await prompt(
    'Remove "Reports" and move the panel to the bottom. Most visited first.',
    true,
  );
  await driver.switchTo().window(siteTab);
  await expect.poll(() => shadowValues(panel, "button")).toEqual(["New note"]);
  expect(
    await driver.findElement(By.css("body > :last-child")).getAttribute("id"),
  ).toBe("alorun-page-layout");
  const bidi = await driver.getBidi();
  await bidi.send({
    method: "browsingContext.setViewport",
    params: { context: siteTab, viewport: { width: 320, height: 720 } },
  });
  await expect
    .poll(() =>
      driver.executeScript(
        `const panel = document.querySelector(arguments[0]);
     const root = document.documentElement;
     return [innerWidth, root.scrollWidth === root.clientWidth,
      getComputedStyle(panel.shadowRoot.querySelector(".sections")).gridTemplateColumns.split(" ").length];`,
        panel,
      ),
    )
    .toEqual([320, true, 1]);
  await capture(testInfo.outputPath("firefox-layout-narrow.png"));

  await driver.switchTo().window(popupTab);
  await click("Just for now");
  await driver.switchTo().window(siteTab);
  await expectPanel(true);
  await openPopup();
  await chooseTool("layout");
  await expectBody("Temporary preview");
  await driver.switchTo().window(siteTab);
  await driver.navigate().refresh();
  await expectPanel(false);
});

test("remembers by page, ranks same-site visits, restores after browser restart, and forgets", async () => {
  await chooseTool("layout");
  await prompt('Put "Reports" and "Notes" at the top in two columns.', true);
  await click("Yes, remember it");
  await expectBody("Layout remembered");
  for (const [path, count] of [
    ["/reports", 1],
    ["/notes", 1],
    ["/reports", 2],
  ] as const) {
    await driver.switchTo().window(siteTab);
    await driver.get(origin + path);
    await expectPanel(false);
    await driver.switchTo().window(popupTab);
    await expect
      .poll(() =>
        driver.executeAsyncScript(
          `const [key, path, done] = arguments;
       browser.storage.local.get(key).then(data =>
        done(data[key]?.visits.find(item => item.path === path)?.count ?? 0));`,
          `browser-site:${origin}`,
          path,
        ),
      )
      .toBe(count);
  }

  await driver.switchTo().window(siteTab);
  await driver.get(origin);
  await expect
    .poll(() => shadowValues(panel, ".meta"))
    .toEqual(["Remembered for this page"]);
  await expect
    .poll(() => shadowValues(panel, "a"))
    .toEqual(["Reports2 visits", "Notes1 visit"]);
  await click(By.id("spa"));
  await expectPanel(false);
  await driver.navigate().back();
  await expectPanel(true);

  await driver.quit();
  await startFirefox();
  await driver.switchTo().window(siteTab);
  await expect.poll(() => shadowValues(panel, "h3")).toContain("Shortcuts");
  await chooseTool("layout");
  await click("Forget layout");
  await driver.switchTo().window(siteTab);
  await expectPanel(false);
  await driver.navigate().refresh();
  await expectPanel(false);
});

test("runs reviewed clicks and types each grapheme without pasting in ordinary and rich fields", async () => {
  await chooseTool("action");
  await prompt(
    'Click "New note" then type "café 👋" into "Note" then type "Hi" into "Draft".',
  );
  await driver.switchTo().window(siteTab);
  expect(await driver.findElement(By.id("note")).isDisplayed()).toBe(false);
  await driver.switchTo().window(popupTab);
  await click("Run on page");
  await driver.switchTo().window(siteTab);
  await expect
    .poll(() =>
      driver.executeScript(
        `return document.querySelector(arguments[0])?.shadowRoot?.querySelector(".pointer")?.hidden;`,
        runner,
      ),
    )
    .toBe(false);
  await expect
    .poll(() => shadowValues(runner, '[role="status"]'))
    .toEqual(["Completed 3 actions."]);
  expect(await driver.findElement(By.id("note")).getProperty("value")).toBe(
    "café 👋",
  );
  expect(await driver.findElement(By.id("editable")).getText()).toBe("Hi");

  const events = await driver.executeScript<
    { type: string; value: string; key?: string }[]
  >("return window.events");
  expect(events.filter(({ type }) => type === "paste")).toEqual([]);
  expect(
    events.filter(({ type }) => type === "input").map(({ value }) => value),
  ).toEqual(["c", "ca", "caf", "café", "café ", "café 👋", "H", "Hi"]);
  expect(
    events.filter(({ type }) => type === "keydown").map(({ key }) => key),
  ).toEqual(["c", "a", "f", "é", " ", "👋", "H", "i"]);
});

test("stops in-flight typing and rejects ambiguous, sensitive and stale-page plans", async () => {
  await chooseTool("action");
  for (const [instruction, error] of [
    ['Click "Duplicate"', "more than one"],
    ['Type "value" into "Password"', "No available text field"],
    ['Click "Delete account"', "No available button"],
  ]) {
    await prompt(instruction);
    await click("Run on page");
    await expectBody(error);
  }
  const text = "The first draft should never be completed after stopping";
  await prompt(`Type "${text}" into "Search"`);
  await click("Run on page");
  await driver.switchTo().window(siteTab);
  const search = await driver.findElement(By.css('input[type="search"]'));
  await expect.poll(() => search.getProperty("value")).toMatch(/^T/);
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  await expect
    .poll(() => shadowValues(runner, '[role="status"]'))
    .toEqual(["Stopped by you."]);
  expect(await search.getProperty("value")).not.toBe(text);

  await driver.switchTo().window(popupTab);
  await prompt('Click "Original tool"');
  await driver.switchTo().window(siteTab);
  await click(By.id("spa"));
  await driver.switchTo().window(popupTab);
  await click("Run on page");
  await expectBody("The page changed");
  await driver.switchTo().window(siteTab);
  expect(await driver.findElement(By.id("out")).getText()).toBe("");
});

test("opens existing Alorun workflows against the shared API contract", async () => {
  await click("Today & goals");
  await typeInto('input[type="email"]', "tester@example.test");
  await typeInto('input[type="password"]', "test-only-password");
  await click("Sign in");
  await expectBody("Finish a project");
  await click("Add goal");
  await typeInto(".workspace-view input", "Ship browser tools");
  await click("Save goal");
  await expectBody("Ship browser tools");
  await click("Outline next steps");
  await expect
    .poll(() =>
      driver
        .findElement(button("Outline next steps"))
        .getAttribute("aria-pressed"),
    )
    .toBe("true");
  await click("Workspace");

  await click("Conversations");
  await typeInto(".workspace-view textarea", "What should I do first?");
  await click("Send message");
  await expectBody("Start by reviewing your project outline.");
  const savedChat = () =>
    fixture.calls.some(
      ({ path, method }) => path === "/v1/chat/history" && method === "POST",
    );
  expect(savedChat()).toBe(false);
  await click("Workspace");

  await click("Missions");
  await click(
    By.xpath('//button[contains(normalize-space(.), "Weekly review")]'),
  );
  await expectBody("Run history");
  await click("Pause mission");
  await expectBody("Resume mission");
  await click("Workspace");

  await click("Settings chat");
  await typeInto(".workspace-view input", "Save chat history");
  await click("Find settings");
  await click("Turn on chat history");
  await expectBody("Turn off chat history");
  await click("Workspace");
  await click("Conversations");
  await typeInto(".workspace-view textarea", "What should I do next?");
  await click("Send message");
  await expect.poll(savedChat).toBe(true);
});
