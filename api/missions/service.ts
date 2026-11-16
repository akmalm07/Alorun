import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, lt, lte, sql } from "drizzle-orm";
import * as t from "../../db/schema";
import {
  createMissionSchema,
  missionOutputSchema,
  type Mission,
} from "../../src/shared/missions";
import { missionSuggestions } from "../../src/domain/missions";
import type { Database } from "../database";
import { MissionError } from "./errors";
import { nextMissionRuns } from "./cron";
import { MissionFiles, type BucketDriver } from "./storage";
import type { MissionModel } from "./model";
import type { z } from "zod";

type MissionRow = typeof t.missions.$inferSelect;
export type MissionOptions = {
  bucket: string;
  runnerAvailable: boolean;
  dailyLimit: number;
};
const missionView = (row: MissionRow): Mission => ({
  id: row.id,
  goalId: row.goal_id,
  title: row.title,
  instructions: row.instructions,
  kind: row.kind as Mission["kind"],
  cron: row.cron,
  timezone: row.timezone,
  folder: row.folder,
  status: row.status as Mission["status"],
  nextRunAt: row.next_run_at?.toISOString() ?? null,
  createdAt: row.created_at.toISOString(),
});
export class MissionsService {
  constructor(
    private db: Database,
    private model: MissionModel,
    private storage: BucketDriver | null,
    readonly options: MissionOptions,
    private now = () => new Date(),
  ) {}
  private async owned(userId: string, id: string) {
    const [mission] = await this.db
      .select()
      .from(t.missions)
      .where(and(eq(t.missions.user_id, userId), eq(t.missions.id, id)));
    if (!mission) throw new MissionError(404, "Mission not found");
    return mission;
  }
  private files(mission: MissionRow) {
    if (!this.storage)
      throw new MissionError(503, "Mission storage is not available yet.");
    return new MissionFiles(
      this.storage,
      mission.user_id,
      mission.id,
      mission.folder,
    );
  }
  async list(userId: string) {
    const [missions, goals] = await Promise.all([
      this.db
        .select()
        .from(t.missions)
        .where(eq(t.missions.user_id, userId))
        .orderBy(desc(t.missions.created_at))
        .limit(20),
      this.db
        .select({ id: t.goals.id, title: t.goals.title })
        .from(t.goals)
        .where(and(eq(t.goals.user_id, userId), eq(t.goals.status, "active")))
        .orderBy(desc(t.goals.created_at))
        .limit(6),
    ]);
    return {
      missions: missions.map(missionView),
      suggestions: missionSuggestions(goals),
      runnerAvailable: this.options.runnerAvailable,
      bucket: this.options.bucket,
    };
  }
  async detail(userId: string, id: string) {
    const mission = await this.owned(userId, id);
    const runs = await this.db
      .select()
      .from(t.mission_runs)
      .where(
        and(
          eq(t.mission_runs.user_id, userId),
          eq(t.mission_runs.mission_id, id),
        ),
      )
      .orderBy(desc(t.mission_runs.scheduled_for))
      .limit(20);
    let files: { name: string; size: number }[] = [];
    let storageAvailable = Boolean(this.storage);
    try {
      if (this.storage) files = await this.files(mission).listInputs();
    } catch {
      storageAvailable = false;
    }
    return {
      mission: missionView(mission),
      runs: runs.map((run) => ({
        id: run.id,
        missionId: run.mission_id,
        status: run.status,
        scheduledFor: run.scheduled_for.toISOString(),
        startedAt: run.started_at?.toISOString() ?? null,
        finishedAt: run.finished_at?.toISOString() ?? null,
        summary: run.summary,
        error: run.error,
        artifact: run.artifact,
      })),
      files,
      storagePath: `${this.options.bucket}/${userId}/missions/${id}/${mission.folder}/`,
      storageAvailable,
    };
  }
  preview(cron: string, timezone: string) {
    return {
      nextRuns: nextMissionRuns(cron, timezone, this.now()).map((d) =>
        d.toISOString(),
      ),
    };
  }
  async create(userId: string, input: z.infer<typeof createMissionSchema>) {
    const next = nextMissionRuns(input.cron, input.timezone, this.now())[0];
    if (input.enabled && !this.options.runnerAvailable)
      throw new MissionError(
        503,
        "The mission runner is unavailable. Save this mission paused for now.",
      );
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
      const [existing] = await tx
        .select()
        .from(t.missions)
        .where(
          and(eq(t.missions.user_id, userId), eq(t.missions.id, input.id)),
        );
      if (existing) return missionView(existing);
      const [goal] = await tx
        .select()
        .from(t.goals)
        .where(
          and(
            eq(t.goals.user_id, userId),
            eq(t.goals.id, input.goalId),
            eq(t.goals.status, "active"),
          ),
        );
      if (!goal) throw new MissionError(404, "Active goal not found");
      const existingRows = await tx
        .select({ status: t.missions.status })
        .from(t.missions)
        .where(eq(t.missions.user_id, userId));
      if (existingRows.length >= 20)
        throw new MissionError(409, "You can save up to 20 missions.");
      if (
        input.enabled &&
        existingRows.filter((m) => m.status === "active").length >= 5
      )
        throw new MissionError(409, "Keep at most five missions active.");
      const [row] = await tx
        .insert(t.missions)
        .values({
          id: input.id,
          user_id: userId,
          goal_id: input.goalId,
          title: input.title,
          instructions: input.instructions,
          kind: input.kind,
          cron: input.cron,
          timezone: input.timezone,
          folder: input.folder,
          status: input.enabled ? "active" : "paused",
          next_run_at: input.enabled ? next : null,
        })
        .returning();
      await tx.insert(t.audit_events).values({
        user_id: userId,
        action: "mission_approved",
        entity: "mission",
        entity_id: row.id,
        sanitized_metadata: { enabled: input.enabled },
      });
      return missionView(row);
    });
  }
  async setEnabled(userId: string, id: string, enabled: boolean) {
    if (enabled && !this.options.runnerAvailable)
      throw new MissionError(503, "The mission runner is unavailable.");
    return this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
      const [mission] = await tx
        .select()
        .from(t.missions)
        .where(and(eq(t.missions.id, id), eq(t.missions.user_id, userId)))
        .for("update");
      if (!mission) throw new MissionError(404, "Mission not found");
      if (enabled && mission.status !== "active") {
        const [active] = await tx
          .select({ total: count() })
          .from(t.missions)
          .where(
            and(
              eq(t.missions.user_id, userId),
              eq(t.missions.status, "active"),
            ),
          );
        if (active.total >= 5)
          throw new MissionError(409, "Keep at most five missions active.");
        const [goal] = await tx
          .select()
          .from(t.goals)
          .where(
            and(
              eq(t.goals.user_id, userId),
              eq(t.goals.id, mission.goal_id),
              eq(t.goals.status, "active"),
            ),
          );
        if (!goal)
          throw new MissionError(
            409,
            "Reactivate this goal before its mission.",
          );
      }
      const [row] = await tx
        .update(t.missions)
        .set({
          status: enabled ? "active" : "paused",
          next_run_at: enabled
            ? nextMissionRuns(mission.cron, mission.timezone, this.now())[0]
            : null,
          updated_at: this.now(),
        })
        .where(and(eq(t.missions.id, id), eq(t.missions.user_id, userId)))
        .returning();
      if (!enabled)
        await tx
          .update(t.mission_runs)
          .set({
            status: "cancelled",
            finished_at: this.now(),
            error: "Mission paused.",
          })
          .where(
            and(
              eq(t.mission_runs.user_id, userId),
              eq(t.mission_runs.mission_id, id),
              inArray(t.mission_runs.status, ["queued", "running"]),
            ),
          );
      return missionView(row);
    });
  }
  async enqueueManual(userId: string, id: string, requestId: string) {
    if (!this.options.runnerAvailable)
      throw new MissionError(503, "The mission runner is unavailable.");
    return this.db.transaction(async (tx) => {
      const [mission] = await tx
        .select()
        .from(t.missions)
        .where(and(eq(t.missions.id, id), eq(t.missions.user_id, userId)))
        .for("update");
      if (!mission) throw new MissionError(404, "Mission not found");
      const [previous] = await tx
        .select()
        .from(t.mission_runs)
        .where(
          and(
            eq(t.mission_runs.user_id, userId),
            eq(t.mission_runs.request_id, requestId),
          ),
        );
      if (previous) {
        if (previous.mission_id !== id)
          throw new MissionError(409, "Request belongs to another mission");
        return { runId: previous.id, status: previous.status };
      }
      if (mission.status !== "active")
        throw new MissionError(409, "Activate this mission before running it.");
      const [pending] = await tx
        .select()
        .from(t.mission_runs)
        .where(
          and(
            eq(t.mission_runs.user_id, userId),
            eq(t.mission_runs.mission_id, id),
            inArray(t.mission_runs.status, ["queued", "running"]),
          ),
        )
        .limit(1);
      if (pending) return { runId: pending.id, status: pending.status };
      const [run] = await tx
        .insert(t.mission_runs)
        .values({
          user_id: userId,
          mission_id: id,
          trigger: "manual",
          request_id: requestId,
          scheduled_for: this.now(),
        })
        .returning();
      return { runId: run.id, status: run.status };
    });
  }
  async putInput(userId: string, id: string, name: string, content: string) {
    return this.db.transaction(async (tx) => {
      const [mission] = await tx
        .select()
        .from(t.missions)
        .where(and(eq(t.missions.id, id), eq(t.missions.user_id, userId)))
        .for("update");
      if (!mission) throw new MissionError(404, "Mission not found");
      await this.files(mission).putInput(name, content);
      return { ok: true };
    });
  }
  async readInput(userId: string, id: string, name: string) {
    const mission = await this.owned(userId, id);
    return { name, content: await this.files(mission).readInput(name) };
  }
  async artifact(userId: string, id: string, runId: string) {
    const mission = await this.owned(userId, id);
    const [run] = await this.db
      .select()
      .from(t.mission_runs)
      .where(
        and(
          eq(t.mission_runs.user_id, userId),
          eq(t.mission_runs.mission_id, id),
          eq(t.mission_runs.id, runId),
          eq(t.mission_runs.status, "succeeded"),
        ),
      );
    if (!run || run.artifact !== `outputs/${runId}.md`)
      throw new MissionError(404, "Generated document not found");
    return {
      name: `${runId}.md`,
      content: await this.files(mission).readOutput(runId),
    };
  }
  /** Trusted scheduler only: derive owners from persisted rows, never caller-provided identity. */
  async dispatch() {
    const now = this.now();
    await this.db
      .update(t.mission_runs)
      .set({
        status: "failed",
        finished_at: now,
        error: "Run interrupted or timed out. You can start a new run.",
      })
      .where(
        and(
          eq(t.mission_runs.status, "running"),
          lt(t.mission_runs.started_at, new Date(now.getTime() - 120_000)),
        ),
      );
    await this.db.transaction(async (tx) => {
      const due = await tx
        .select()
        .from(t.missions)
        .where(
          and(
            eq(t.missions.status, "active"),
            lte(t.missions.next_run_at, now),
          ),
        )
        .orderBy(asc(t.missions.next_run_at))
        .limit(5)
        .for("update", { skipLocked: true });
      for (const mission of due) {
        const [pending] = await tx
          .select({ id: t.mission_runs.id })
          .from(t.mission_runs)
          .where(
            and(
              eq(t.mission_runs.user_id, mission.user_id),
              eq(t.mission_runs.mission_id, mission.id),
              inArray(t.mission_runs.status, ["queued", "running"]),
            ),
          )
          .limit(1);
        if (!pending)
          await tx
            .insert(t.mission_runs)
            .values({
              user_id: mission.user_id,
              mission_id: mission.id,
              trigger: "cron",
              request_id: randomUUID(),
              scheduled_for: mission.next_run_at!,
            })
            .onConflictDoNothing();
        // Coalesce missed ticks, never replay an unbounded backlog.
        await tx
          .update(t.missions)
          .set({
            next_run_at: nextMissionRuns(
              mission.cron,
              mission.timezone,
              now,
            )[0],
          })
          .where(
            and(
              eq(t.missions.id, mission.id),
              eq(t.missions.user_id, mission.user_id),
            ),
          );
      }
    });
    const queued = await this.db
      .select({ id: t.mission_runs.id })
      .from(t.mission_runs)
      .where(eq(t.mission_runs.status, "queued"))
      .orderBy(asc(t.mission_runs.scheduled_for))
      .limit(5);
    return queued.map((run) => run.id);
  }
  private async reserve(
    run: typeof t.mission_runs.$inferSelect,
    token: string,
  ) {
    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${run.user_id}))`,
      );
      // Same user -> mission -> run lock order as pause. This is the AI-attempt
      // authorization point: work admitted earlier may finish, but cannot publish after pause.
      const [mission] = await tx
        .select()
        .from(t.missions)
        .where(
          and(
            eq(t.missions.id, run.mission_id),
            eq(t.missions.user_id, run.user_id),
          ),
        )
        .for("update");
      const [current] = await tx
        .select()
        .from(t.mission_runs)
        .where(
          and(
            eq(t.mission_runs.id, run.id),
            eq(t.mission_runs.user_id, run.user_id),
          ),
        )
        .for("update");
      if (
        mission?.status !== "active" ||
        current?.status !== "running" ||
        current.claim_token !== token
      )
        throw new MissionError(409, "Mission paused before its AI attempt.");
      const [used] = await tx
        .select({ total: count() })
        .from(t.usage_ledger)
        .where(
          and(
            eq(t.usage_ledger.user_id, run.user_id),
            eq(
              t.usage_ledger.period_key,
              this.now().toISOString().slice(0, 10),
            ),
          ),
        );
      if (used.total >= this.options.dailyLimit)
        throw new MissionError(429, "Daily AI request allowance reached.");
      const inserted = await tx
        .insert(t.usage_ledger)
        .values({
          user_id: run.user_id,
          period_key: this.now().toISOString().slice(0, 10),
          operation: "mission_run",
          request_id: run.id,
          tokens_in: 0,
          tokens_out: 0,
          estimated_usd: "0",
        })
        .onConflictDoNothing()
        .returning();
      if (!inserted.length)
        throw new MissionError(409, "This run already used its AI attempt.");
    });
  }
  async execute(runId: string) {
    const claimed = await this.db.transaction(async (tx) => {
      const [snapshot] = await tx
        .select()
        .from(t.mission_runs)
        .where(eq(t.mission_runs.id, runId));
      if (!snapshot || snapshot.status !== "queued") return null;
      const [mission] = await tx
        .select()
        .from(t.missions)
        .where(
          and(
            eq(t.missions.id, snapshot.mission_id),
            eq(t.missions.user_id, snapshot.user_id),
          ),
        )
        .for("update");
      const [run] = await tx
        .select()
        .from(t.mission_runs)
        .where(
          and(
            eq(t.mission_runs.id, runId),
            eq(t.mission_runs.user_id, snapshot.user_id),
          ),
        )
        .for("update");
      if (!run || run.status !== "queued") return null;
      const [goal] = await tx
        .select()
        .from(t.goals)
        .where(
          and(
            eq(t.goals.user_id, run.user_id),
            eq(t.goals.id, mission?.goal_id ?? run.mission_id),
            eq(t.goals.status, "active"),
          ),
        );
      if (!mission || mission.status !== "active" || !goal) {
        await tx
          .update(t.mission_runs)
          .set({
            status: "cancelled",
            finished_at: this.now(),
            error: "Mission or goal is paused.",
          })
          .where(eq(t.mission_runs.id, runId));
        return null;
      }
      const token = randomUUID();
      await tx
        .update(t.mission_runs)
        .set({ status: "running", started_at: this.now(), claim_token: token })
        .where(eq(t.mission_runs.id, runId));
      return { run, mission, goal, token };
    });
    if (!claimed) return { processed: false };
    const { run, mission, goal, token } = claimed;
    try {
      const files = this.files(mission);
      const inputs = await files.modelInputs();
      const tasks = await this.db
        .select()
        .from(t.tasks)
        .where(
          and(
            eq(t.tasks.user_id, run.user_id),
            eq(t.tasks.goal_id, mission.goal_id),
          ),
        )
        .orderBy(desc(t.tasks.updated_at))
        .limit(20);
      await this.reserve(run, token);
      const result = await this.model.generate({
        mission: {
          title: mission.title,
          instructions: mission.instructions,
          kind: mission.kind,
        },
        goal: {
          title: goal.title.slice(0, 180),
          motivation: goal.motivation?.slice(0, 1200) ?? null,
        },
        tasks: tasks.map((task) => ({
          title: task.title.slice(0, 180),
          status: task.status,
          dueAt: task.due_at?.toISOString() ?? null,
        })),
        inputs,
      });
      const output = missionOutputSchema.parse(result.data);
      await this.db
        .update(t.usage_ledger)
        .set({
          tokens_in: result.input,
          tokens_out: result.output,
          estimated_usd: result.cost.toFixed(8),
        })
        .where(
          and(
            eq(t.usage_ledger.user_id, run.user_id),
            eq(t.usage_ledger.request_id, run.id),
            eq(t.usage_ledger.operation, "mission_run"),
          ),
        );
      await this.db.transaction(async (tx) => {
        // Serialize pause with final storage write: after pause returns, no new output can appear.
        const [currentMission] = await tx
          .select()
          .from(t.missions)
          .where(
            and(
              eq(t.missions.id, mission.id),
              eq(t.missions.user_id, run.user_id),
            ),
          )
          .for("update");
        const [currentRun] = await tx
          .select()
          .from(t.mission_runs)
          .where(
            and(
              eq(t.mission_runs.id, runId),
              eq(t.mission_runs.user_id, run.user_id),
            ),
          )
          .for("update");
        if (
          currentMission?.status !== "active" ||
          currentRun?.status !== "running" ||
          currentRun.claim_token !== token
        )
          return;
        const artifact = await files.writeOutput(
          runId,
          `# ${output.title}\n\n${output.markdown}\n`,
        );
        await tx
          .update(t.mission_runs)
          .set({
            status: "succeeded",
            finished_at: this.now(),
            summary: output.summary,
            artifact,
          })
          .where(
            and(
              eq(t.mission_runs.id, runId),
              eq(t.mission_runs.user_id, run.user_id),
              eq(t.mission_runs.claim_token, token),
            ),
          );
      });
      return { processed: true };
    } catch (error) {
      await this.db
        .update(t.mission_runs)
        .set({
          status: "failed",
          finished_at: this.now(),
          error:
            error instanceof MissionError
              ? error.message
              : "Mission could not finish. Try a new run when ready.",
        })
        .where(
          and(
            eq(t.mission_runs.id, runId),
            eq(t.mission_runs.user_id, run.user_id),
            eq(t.mission_runs.status, "running"),
            eq(t.mission_runs.claim_token, token),
          ),
        );
      return { processed: true };
    }
  }
}
