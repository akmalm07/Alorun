import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

function command(executable, args, options = {}) {
  const result = spawnSync(executable, args, { stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const [browserFlag, ...browserArgs] = process.argv.slice(2);
const firefox = browserFlag === "--firefox";
const target = firefox ? "firefox-mv3" : "chrome-mv3";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const origin =
  process.env.ALORUN_BROWSER_TEST_ORIGIN ?? "http://127.0.0.1:41287";
const env = {
  ...process.env,
  PLASMO_BUILD_PATH: "build/browser-test",
  PLASMO_PUBLIC_ALORUN_API_URL: origin,
  PLASMO_PUBLIC_SUPABASE_URL: origin,
  PLASMO_PUBLIC_SUPABASE_ANON_KEY: "browser-test-public-key",
};
command(npm, ["run", firefox ? "build:firefox" : "build"], { env });

// The native host permission dialog is outside Playwright page automation. Give
// the separate test bundle access to its loopback fixture only.
const manifestPath = new URL(
  `../build/browser-test/${target}-prod/manifest.json`,
  import.meta.url,
);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const { hostname, protocol } = new URL(origin);
if (protocol !== "http:" || hostname !== "127.0.0.1")
  throw new Error("The browser fixture must use an HTTP loopback origin.");
manifest.host_permissions = [`${protocol}//${hostname}/*`];
await writeFile(manifestPath, JSON.stringify(manifest));
command(npm, [
  "exec",
  "--",
  "playwright",
  "test",
  firefox ? "tests/firefox.spec.ts" : "tests/browser.spec.ts",
  ...(firefox ? browserArgs : process.argv.slice(2)),
]);
