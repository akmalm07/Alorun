import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { uuid } from "../../src/shared/contracts";
import type { MissionsService } from "./service";
const commandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dispatch") }).strict(),
  z.object({ kind: z.literal("wake"), runId: uuid }).strict(),
  z.object({ kind: z.literal("run"), runId: uuid }).strict(),
]);
export function createMissionsHandler(
  missions: Pick<MissionsService, "dispatch" | "execute">,
  secret: string,
  spawn: (ids: string[]) => void,
) {
  return async (request: Request): Promise<Response> => {
    const received = request.headers.get("x-mission-secret") ?? "";
    const expected = Buffer.from(secret),
      candidate = Buffer.from(received);
    if (
      expected.length < 32 ||
      candidate.length !== expected.length ||
      !timingSafeEqual(expected, candidate)
    )
      return Response.json({ message: "Unauthorized" }, { status: 401 });
    if (request.method !== "POST")
      return Response.json({ message: "Use POST" }, { status: 405 });
    try {
      if (Number(request.headers.get("content-length") ?? 0) > 1024)
        return Response.json({ message: "Request too large" }, { status: 413 });
      const body = await request.text();
      if (body.length > 1024)
        return Response.json({ message: "Request too large" }, { status: 413 });
      let decoded: unknown;
      try {
        decoded = JSON.parse(body);
      } catch {
        return Response.json({ message: "Invalid command" }, { status: 400 });
      }
      const input = commandSchema.safeParse(decoded);
      if (!input.success)
        return Response.json({ message: "Invalid command" }, { status: 400 });
      if (input.data.kind === "run")
        return Response.json(await missions.execute(input.data.runId));
      const ids =
        input.data.kind === "wake"
          ? [input.data.runId]
          : await missions.dispatch();
      spawn(ids);
      return Response.json({ queued: ids.length }, { status: 202 });
    } catch {
      return Response.json(
        {
          message:
            "Mission worker unavailable. Queued work can be dispatched again.",
        },
        { status: 503 },
      );
    }
  };
}
export async function invokeMissionWorker(
  url: string,
  secret: string,
  kind: "run" | "wake",
  runId: string,
) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-mission-secret": secret },
    body: JSON.stringify({ kind, runId }),
    signal: AbortSignal.timeout(kind === "wake" ? 5000 : 125_000),
  });
  if (!response.ok) throw new Error("Mission worker invocation failed");
}
