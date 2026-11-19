import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const target = process.argv[2];
const isFirefox = target === "firefox-mv3";
if (target !== "chrome-mv3" && !isFirefox)
  throw new Error("Use the chrome-mv3 or firefox-mv3 build target.");

const root = fileURLToPath(new URL("..", import.meta.url));
const output = join(
  root,
  process.env.PLASMO_BUILD_PATH || "build",
  `${target}-prod`,
);

await build({
  absWorkingDir: root,
  entryPoints: ["src/browser/runtime.ts"],
  outfile: join(output, "page-runtime.js"),
  bundle: true,
  minify: true,
  target: isFirefox ? "firefox140" : "chrome120",
  legalComments: "eof",
});

if (isFirefox) {
  const manifestPath = join(output, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  delete manifest.minimum_chrome_version;
  manifest.browser_specific_settings = {
    gecko: { id: "alorun-extension@alorun", strict_min_version: "140.0" },
  };
  await writeFile(manifestPath, JSON.stringify(manifest));
}
