import { build } from "esbuild";
import { readFile } from "node:fs/promises";
const pkg = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
await build({
  entryPoints: ["serverless/missions.ts"],
  outfile: "supabase/functions/missions/worker.js",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "es2022",
  plugins: [
    {
      name: "pinned-deno-npm-imports",
      setup(context) {
        context.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith("node:"))
            return { path: args.path, external: true };
          const parts = args.path.split("/");
          const root = args.path.startsWith("@")
            ? parts.slice(0, 2).join("/")
            : parts[0];
          const version = pkg.dependencies[root];
          if (!version || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version))
            throw new Error(`Missing exact mission dependency: ${root}`);
          return {
            path: `npm:${root}@${version}${args.path.slice(root.length)}`,
            external: true,
          };
        });
      },
    },
  ],
});
console.log(
  "Built shared Missions worker for Supabase Edge Functions. No service deployed.",
);
