import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, asc, count, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import * as tables from "../db/schema";
import {
  proposalSchema,
  type Proposal,
  type TaskDraft,
  type Window,
} from "../src/shared/contracts";
import { scheduleTasks, taskWindow } from "../src/domain/schedule";
import { shouldPrompt } from "../src/domain/checkins";
import type { Database } from "./database";
import type { AIProvider, AIResult } from "./provider";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export class GoalService {
  constructor(
    private db: Database,
    private ai: AIProvider,
    private dailyLimit: number,
    private now = () => new Date(),
  ) {}

  private async goal(userId: string, id: string) {
    const [goal] = await this.db
      .select()
      .from(tables.goals)
      .where(and(eq(tables.goals.user_id, userId), eq(tables.goals.id, id)));
    if (!goal) throw new NotFoundException("Goal not found");
    return goal;
  }
  async profile(userId: string, timezone: string) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    } catch {
      throw new BadRequestException("Invalid timezone");
    }
    await this.db.transaction(async (tx) => {
      await tx
        .insert(tables.users_profile)
        .values({ id: userId, timezone })
        .onConflictDoUpdate({
          target: tables.users_profile.id,
          set: { timezone },
        });
      await tx
        .insert(tables.privacy_settings)
        .values({ user_id: userId })
        .onConflictDoNothing();
    });
    return { ok: true };
  }
  async today(userId: string) {
    const [goals, tasks, proposals, preferences] = await Promise.all([
      this.db
        .select()
        .from(tables.goals)
        .where(eq(tables.goals.user_id, userId))
        .orderBy(asc(tables.goals.created_at)),
      this.db
        .select()
        .from(tables.tasks)
        .where(eq(tables.tasks.user_id, userId))
        .orderBy(asc(tables.tasks.due_at)),
      this.db
        .select()
        .from(tables.plan_proposals)
        .where(
          and(
            eq(tables.plan_proposals.user_id, userId),
            eq(tables.plan_proposals.status, "pending"),
          ),
        ),
      this.db
        .select()
        .from(tables.goal_checkin_preferences)
        .where(eq(tables.goal_checkin_preferences.user_id, userId)),
    ]);
    return {
      goals: goals.map((g) => ({
        id: g.id,
        title: g.title,
        motivation: g.motivation,
      })),
      tasks: tasks.map((t) => ({
        id: t.id,
        goalId: t.goal_id,
        title: t.title,
        description: t.description,
        dueAt: t.due_at?.toISOString() ?? null,
        estimateMinutes: t.estimate_minutes,
        status: t.status,
      })),
      proposals: proposals.map((p) => proposalSchema.parse(p.proposal_json)),
      checkinsEnabled: preferences[0]?.enabled ?? false,
    };
  }
  async createGoal(
    userId: string,
    input: { id: string; title: string; motivation: string },
  ) {
    const [goal] = await this.db
      .insert(tables.goals)
      .values({
        id: input.id,
        user_id: userId,
        title: input.title,
        motivation: input.motivation,
      })
      .onConflictDoNothing()
      .returning();
    if (!goal) return this.goal(userId, input.id);
    return { id: goal.id, title: goal.title, motivation: goal.motivation };
  }
  private async reserve(userId: string, requestId: string, operation: string) {
    const day = this.now().toISOString().slice(0, 10);
    await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
      const [existing] = await tx
        .select()
        .from(tables.usage_ledger)
        .where(
          and(
            eq(tables.usage_ledger.user_id, userId),
            eq(tables.usage_ledger.request_id, requestId),
            eq(tables.usage_ledger.operation, operation),
          ),
        );
      if (existing)
        throw new ConflictException(
          "Request already attempted. Refresh or retry with a new request ID.",
        );
      const [usage] = await tx
        .select({ total: count() })
        .from(tables.usage_ledger)
        .where(
          and(
            eq(tables.usage_ledger.user_id, userId),
            eq(tables.usage_ledger.period_key, day),
          ),
        );
      if (usage.total >= this.dailyLimit)
        throw new HttpException(
          "Daily AI request limit reached. Tasks and calendar remain available.",
          429,
        );
      await tx.insert(tables.usage_ledger).values({
        user_id: userId,
        period_key: day,
        request_id: requestId,
        operation,
        tokens_in: 0,
        tokens_out: 0,
        estimated_usd: "0",
      });
    });
  }
  private async releaseReservation(
    userId: string,
    requestId: string,
    operation: string,
  ) {
    await this.db
      .delete(tables.usage_ledger)
      .where(
        and(
          eq(tables.usage_ledger.user_id, userId),
          eq(tables.usage_ledger.request_id, requestId),
          eq(tables.usage_ledger.operation, operation),
        ),
      );
  }
  /** Shared quota/usage boundary for approved internal AI operations; never exposed as a model tool. */
  async consume<T>(
    userId: string,
    requestId: string,
    operation: string,
    run: () => Promise<AIResult<T>>,
    transaction?: Transaction,
  ) {
    if (!transaction) await this.reserve(userId, requestId, operation);
    try {
      const result = await run();
      await (transaction ?? this.db)
        .update(tables.usage_ledger)
        .set({
          tokens_in: result.input,
          tokens_out: result.output,
          estimated_usd: result.cost.toFixed(8),
        })
        .where(
          and(
            eq(tables.usage_ledger.user_id, userId),
            eq(tables.usage_ledger.request_id, requestId),
            eq(tables.usage_ledger.operation, operation),
          ),
        );
      return result.data;
    } catch {
      // Keep the reservation on provider failure: retries must not evade daily limits.
      throw new ServiceUnavailableException(
        "AI request failed. Your tasks are unchanged. Please try again.",
      );
    }
  }
  async propose(
    userId: string,
    input: { goalId: string; requestId: string; windows: Window[] },
  ) {
    const goal = await this.goal(userId, input.goalId);
    const [existing] = await this.db
      .select()
      .from(tables.plan_proposals)
      .where(
        and(
          eq(tables.plan_proposals.id, input.requestId),
          eq(tables.plan_proposals.user_id, userId),
        ),
      );
    if (existing) return proposalSchema.parse(existing.proposal_json);
    // Validate availability before spending an AI request.
    scheduleTasks([], input.windows, [], this.now());
    const capacity = Math.floor(
      input.windows.reduce(
        (n, w) => n + Date.parse(w.end) - Date.parse(w.start),
        0,
      ) / 60_000,
    );
    const model = await this.consume(userId, input.requestId, "plan", () =>
      this.ai.plan(goal, capacity),
    );
    const current = await this.today(userId);
    const busy = current.tasks
      .filter((t) => t.status !== "completed")
      .flatMap((t) => {
        const w = taskWindow(t);
        return w ? [w] : [];
      });
    const proposal: Proposal = {
      id: input.requestId,
      goalId: goal.id,
      rationale: model.rationale,
      windows: input.windows,
      tasks: scheduleTasks(model.tasks, input.windows, busy, this.now()),
    };
    await this.db
      .insert(tables.plan_proposals)
      .values({ id: proposal.id, user_id: userId, proposal_json: proposal });
    return proposal;
  }
  async accept(userId: string, proposalId: string, drafts: TaskDraft[]) {
    return this.db.transaction(async (tx) => {
      // Serialize every accepted plan for this user, including distinct proposals.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${userId}))`);
      const [row] = await tx
        .select()
        .from(tables.plan_proposals)
        .where(
          and(
            eq(tables.plan_proposals.user_id, userId),
            eq(tables.plan_proposals.id, proposalId),
          ),
        )
        .for("update");
      if (!row) throw new NotFoundException("Plan not found");
      const proposal = proposalSchema.parse(row.proposal_json);
      if (row.status === "accepted")
        return { taskIds: proposal.acceptedTaskIds ?? [] };
      if (row.status !== "pending")
        throw new ConflictException("This plan is no longer pending");
      const [goal] = await tx
        .select()
        .from(tables.goals)
        .where(
          and(
            eq(tables.goals.id, proposal.goalId),
            eq(tables.goals.user_id, userId),
          ),
        );
      if (!goal || goal.status !== "active")
        throw new ConflictException("Goal is no longer active");
      const current = await tx
        .select()
        .from(tables.tasks)
        .where(eq(tables.tasks.user_id, userId));
      const busy = current
        .filter((t) => t.status !== "completed")
        .flatMap((t) => {
          const w = taskWindow({
            dueAt: t.due_at?.toISOString() ?? null,
            estimateMinutes: t.estimate_minutes,
          });
          return w ? [w] : [];
        });
      const scheduled = scheduleTasks(
        drafts,
        proposal.windows,
        busy,
        this.now(),
      );
      const created = await tx
        .insert(tables.tasks)
        .values(
          scheduled.map((t) => ({
            user_id: userId,
            goal_id: proposal.goalId,
            title: t.title,
            description: t.description,
            estimate_minutes: t.estimateMinutes,
            due_at: new Date(t.end),
            status: "pending",
          })),
        )
        .returning({ id: tables.tasks.id });
      const taskIds = created.map((t) => t.id);
      await tx
        .update(tables.plan_proposals)
        .set({
          status: "accepted",
          accepted_at: this.now(),
          proposal_json: {
            ...proposal,
            tasks: scheduled,
            acceptedTaskIds: taskIds,
          },
        })
        .where(
          and(
            eq(tables.plan_proposals.id, proposalId),
            eq(tables.plan_proposals.user_id, userId),
          ),
        );
      await tx.insert(tables.audit_events).values({
        user_id: userId,
        action: "plan_accepted",
        entity: "plan",
        entity_id: proposalId,
        sanitized_metadata: { taskCount: taskIds.length },
      });
      return { taskIds };
    });
  }
  async reject(userId: string, id: string) {
    const rows = await this.db
      .update(tables.plan_proposals)
      .set({ status: "rejected" })
      .where(
        and(
          eq(tables.plan_proposals.user_id, userId),
          eq(tables.plan_proposals.id, id),
          eq(tables.plan_proposals.status, "pending"),
        ),
      )
      .returning({ id: tables.plan_proposals.id });
    if (!rows.length) throw new NotFoundException("Pending plan not found");
    return { ok: true };
  }
  async taskStatus(
    userId: string,
    id: string,
    status: "pending" | "completed",
  ) {
    return this.db.transaction(async (tx) => {
      const [task] = await tx
        .update(tables.tasks)
        .set({ status, updated_at: this.now() })
        .where(and(eq(tables.tasks.user_id, userId), eq(tables.tasks.id, id)))
        .returning();
      if (!task) throw new NotFoundException("Task not found");
      await tx.insert(tables.audit_events).values({
        user_id: userId,
        action: `task_${status}`,
        entity: "task",
        entity_id: id,
      });
      return { ok: true };
    });
  }
  async preferences(userId: string, enabled: boolean) {
    await this.db
      .insert(tables.goal_checkin_preferences)
      .values({ user_id: userId, enabled })
      .onConflictDoUpdate({
        target: tables.goal_checkin_preferences.user_id,
        set: { enabled },
      });
    return { enabled };
  }
  async openCheckin(userId: string, requestId: string) {
    // Check eligibility before reserving quota; recheck under the transaction lock below.
    const [preference] = await this.db
      .select()
      .from(tables.goal_checkin_preferences)
      .where(eq(tables.goal_checkin_preferences.user_id, userId));
    if (!preference?.enabled) return { checkin: null };
    const snapshot = await this.db
      .select()
      .from(tables.goal_checkins)
      .where(eq(tables.goal_checkins.user_id, userId));
    const preNow = this.now();
    if (
      snapshot.some(
        (s) =>
          preNow.getTime() -
            Math.max(s.last_prompted_at.getTime(), s.updated_at.getTime()) <
          24 * 3600_000,
      )
    )
      return { checkin: null };
    const candidates = await this.db
      .select({ goalId: tables.tasks.goal_id })
      .from(tables.tasks)
      .where(
        and(
          eq(tables.tasks.user_id, userId),
          eq(tables.tasks.status, "pending"),
          lt(tables.tasks.due_at, preNow),
        ),
      );
    if (
      !snapshot.some((s) => s.status === "skipped") &&
      !candidates.some((t) => t.goalId)
    )
      return { checkin: null };
    // Reserve before taking the long-running transaction, so concurrent requests cannot
    // exhaust the connection pool while waiting for a second connection for quota writes.
    await this.reserve(userId, requestId, "question");
    // This transaction deduplicates simultaneous foreground/open requests and opt-out races.
    let invokedAI = false;
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`checkin:${userId}`}))`,
        );
        const [prefs] = await tx
          .select()
          .from(tables.goal_checkin_preferences)
          .where(eq(tables.goal_checkin_preferences.user_id, userId))
          .for("update");
        if (!prefs?.enabled) return { checkin: null };
        const now = this.now();
        const states = await tx
          .select()
          .from(tables.goal_checkins)
          .where(eq(tables.goal_checkins.user_id, userId));
        // At most one interruption per user/day, regardless of how many goals are overdue.
        if (
          states.some(
            (s) =>
              now.getTime() -
                Math.max(s.last_prompted_at.getTime(), s.updated_at.getTime()) <
              24 * 3600_000,
          )
        )
          return { checkin: null };
        const goals = await tx
          .select()
          .from(tables.goals)
          .where(
            and(
              eq(tables.goals.user_id, userId),
              eq(tables.goals.status, "active"),
            ),
          )
          .orderBy(asc(tables.goals.created_at));
        const overdue = await tx
          .select()
          .from(tables.tasks)
          .where(
            and(
              eq(tables.tasks.user_id, userId),
              eq(tables.tasks.status, "pending"),
              lt(tables.tasks.due_at, now),
            ),
          );
        for (const goal of goals) {
          const state = states.find((s) => s.goal_id === goal.id);
          const hasOverdue = overdue.some((t) => t.goal_id === goal.id);
          if (
            !shouldPrompt(
              true,
              hasOverdue,
              state
                ? {
                    status: z
                      .enum(["pending", "skipped", "answered"])
                      .parse(state.status),
                    lastPromptedAt: state.last_prompted_at,
                    updatedAt: state.updated_at,
                  }
                : null,
              now,
            )
          )
            continue;
          invokedAI = true;
          const question = await this.consume(
            userId,
            requestId,
            "question",
            () =>
              this.ai.question(
                goal,
                state?.status === "skipped" ? "skipped" : "overdue",
              ),
            tx,
          );
          const [checkin] = await tx
            .insert(tables.goal_checkins)
            .values({
              user_id: userId,
              goal_id: goal.id,
              question,
              last_prompted_at: now,
            })
            .onConflictDoUpdate({
              target: [
                tables.goal_checkins.user_id,
                tables.goal_checkins.goal_id,
              ],
              set: {
                question,
                status: "pending",
                last_prompted_at: now,
                updated_at: now,
              },
            })
            .returning();
          return {
            checkin: {
              id: checkin.id,
              goalId: checkin.goal_id,
              question: checkin.question,
              status: "pending" as const,
            },
          };
        }
        return { checkin: null };
      });
    } finally {
      if (!invokedAI)
        await this.releaseReservation(userId, requestId, "question");
    }
  }
  async skipCheckin(userId: string, id: string) {
    const rows = await this.db
      .update(tables.goal_checkins)
      .set({ status: "skipped", updated_at: this.now() })
      .where(
        and(
          eq(tables.goal_checkins.user_id, userId),
          eq(tables.goal_checkins.id, id),
          eq(tables.goal_checkins.status, "pending"),
        ),
      )
      .returning();
    if (!rows.length) throw new NotFoundException("Pending check-in not found");
    return { ok: true };
  }
  async answerVoice(
    userId: string,
    id: string,
    requestId: string,
    audio: { buffer: Buffer; mimetype: string },
  ) {
    const [initial] = await this.db
      .select()
      .from(tables.goal_checkins)
      .where(
        and(
          eq(tables.goal_checkins.id, id),
          eq(tables.goal_checkins.user_id, userId),
        ),
      );
    if (!initial) throw new NotFoundException("Check-in not found");
    if (initial.status === "answered") return { answered: true };
    if (initial.status !== "pending")
      throw new ConflictException("Check-in is no longer pending");
    await this.reserve(userId, requestId, "transcription");
    let invokedAI = false;
    try {
      return await this.db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`checkin:${userId}`}))`,
        );
        const [prefs] = await tx
          .select()
          .from(tables.goal_checkin_preferences)
          .where(eq(tables.goal_checkin_preferences.user_id, userId))
          .for("update");
        if (!prefs?.enabled)
          throw new ConflictException("Voice check-ins are disabled");
        const [row] = await tx
          .select()
          .from(tables.goal_checkins)
          .where(
            and(
              eq(tables.goal_checkins.id, id),
              eq(tables.goal_checkins.user_id, userId),
            ),
          )
          .for("update");
        if (!row) throw new NotFoundException("Check-in not found");
        if (row.status === "answered") return { answered: true };
        if (row.status !== "pending")
          throw new ConflictException("Check-in is no longer pending");
        invokedAI = true;
        const transcript = await this.consume(
          userId,
          requestId,
          "transcription",
          () => this.ai.transcribe(audio.buffer, audio.mimetype),
          tx,
        );
        if (!transcript.trim())
          throw new BadRequestException(
            "No speech was detected. Please record again.",
          );
        // Do not store the transcript, audio, or turn it into a completion/memory assertion.
        await tx
          .update(tables.goal_checkins)
          .set({ status: "answered", updated_at: this.now() })
          .where(
            and(
              eq(tables.goal_checkins.id, id),
              eq(tables.goal_checkins.user_id, userId),
            ),
          );
        return { answered: true };
      });
    } finally {
      if (!invokedAI)
        await this.releaseReservation(userId, requestId, "transcription");
    }
  }
}
