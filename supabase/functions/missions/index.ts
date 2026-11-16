// Build worker.js from shared, typechecked source with `pnpm missions:build` before deployment.
import { createServerlessMissions } from "./worker.js";
declare const EdgeRuntime: { waitUntil(task: Promise<unknown>): void };

const handler = createServerlessMissions(
  Deno.env.toObject(),
  (task: Promise<unknown>) => EdgeRuntime.waitUntil(task),
);
Deno.serve(handler);
