import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import * as tables from "../db/schema";
import {
  chatMessageSchema,
  chatReplySchema,
  type ChatMode,
  type ChatTurn,
  type ChatSave,
} from "../src/shared/contracts";
import { recentConversation } from "../src/domain/conversation";
import type { Database } from "./database";
import type { AIProvider } from "./provider";
import type { GoalService } from "./service";
import { ChatEncryption } from "./chat-crypto";

export class ChatService {
  constructor(
    private db: Database,
    private ai: AIProvider,
    private usage: Pick<GoalService, "consume">,
    private encryption: ChatEncryption | null,
  ) {}
  async reply(
    userId: string,
    input: { requestId: string; mode: ChatMode; messages: ChatTurn[] },
  ) {
    const [goals, tasks] = await Promise.all([
      this.db
        .select()
        .from(tables.goals)
        .where(
          and(
            eq(tables.goals.user_id, userId),
            eq(tables.goals.status, "active"),
          ),
        )
        .orderBy(desc(tables.goals.created_at))
        .limit(10),
      this.db
        .select()
        .from(tables.tasks)
        .where(eq(tables.tasks.user_id, userId))
        .orderBy(desc(tables.tasks.updated_at))
        .limit(20),
    ]);
    const result = await this.usage.consume(
      userId,
      input.requestId,
      "chat",
      () =>
        this.ai
          .chat(input.mode, recentConversation(input.messages), {
            goals: goals.map((g) => ({
              id: g.id,
              title: g.title.slice(0, 180),
              motivation: g.motivation?.slice(0, 1200) ?? null,
            })),
            tasks: tasks.map((t) => ({
              id: t.id,
              goalId: t.goal_id,
              title: t.title.slice(0, 180),
              status: t.status,
              dueAt: t.due_at?.toISOString() ?? null,
            })),
          })
          .then((response) => ({
            ...response,
            data: chatReplySchema.parse(response.data),
          })),
    );
    // Model suggestions confer no authority. Only permit an affordance for an owned goal.
    return {
      ...result,
      suggestedGoalId:
        input.mode === "plan" &&
        goals.some((g) => g.id === result.suggestedGoalId)
          ? result.suggestedGoalId
          : null,
    };
  }
  async transcribe(
    userId: string,
    requestId: string,
    audio: { buffer: Buffer; mimetype: string },
  ) {
    const text = await this.usage.consume(userId, requestId, "dictation", () =>
      this.ai.transcribe(audio.buffer, audio.mimetype),
    );
    if (!text.trim())
      throw new BadRequestException(
        "No speech was detected. Record again or type your message.",
      );
    return { text: text.trim().slice(0, 4000) };
  }
  async history(userId: string) {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`chat:${userId}`}))`,
      );
      const [prefs] = await tx
        .select()
        .from(tables.privacy_settings)
        .where(eq(tables.privacy_settings.user_id, userId));
      const base = {
        historyVersion: prefs?.updated_at.toISOString() ?? null,
        savingAvailable: Boolean(this.encryption),
        saveHistory: prefs?.save_chat_history ?? false,
      };
      if (!base.saveHistory || !this.encryption)
        return { ...base, threadId: null, messages: [] };
      const [thread] = await tx
        .select()
        .from(tables.chat_threads)
        .where(eq(tables.chat_threads.user_id, userId))
        .orderBy(desc(tables.chat_threads.created_at))
        .limit(1);
      if (!thread) return { ...base, threadId: null, messages: [] };
      const rows = await tx
        .select()
        .from(tables.chat_messages)
        .where(
          and(
            eq(tables.chat_messages.user_id, userId),
            eq(tables.chat_messages.thread_id, thread.id),
          ),
        )
        .orderBy(
          desc(tables.chat_messages.created_at),
          desc(tables.chat_messages.id),
        )
        .limit(60);
      try {
        const messages = rows
          .reverse()
          .map((row) =>
            chatMessageSchema.parse(
              JSON.parse(
                this.encryption!.open(
                  row.content_protected,
                  userId,
                  thread.id,
                  row.id,
                ),
              ),
            ),
          );
        return { ...base, threadId: thread.id, messages };
      } catch {
        throw new ServiceUnavailableException(
          "Saved chat is temporarily unavailable. Your goals and tasks remain available; contact support if retrying does not help.",
        );
      }
    });
  }
  async settings(userId: string, enabled: boolean) {
    if (enabled && !this.encryption)
      throw new ServiceUnavailableException(
        "Chat history saving is not configured on this server. Temporary chat is available.",
      );
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`chat:${userId}`}))`,
      );
      const [row] = await tx
        .insert(tables.privacy_settings)
        .values({ user_id: userId, save_chat_history: enabled })
        .onConflictDoUpdate({
          target: tables.privacy_settings.user_id,
          set: {
            save_chat_history: enabled,
            updated_at: sql`GREATEST(clock_timestamp(), ${tables.privacy_settings.updated_at} + interval '1 millisecond')`,
          },
        })
        .returning();
      return {
        saveHistory: enabled,
        historyVersion: row.updated_at.toISOString(),
      };
    });
  }
  async save(userId: string, input: ChatSave) {
    if (new Set(input.messages.map((m) => m.id)).size !== input.messages.length)
      throw new BadRequestException("Duplicate message IDs");
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`chat:${userId}`}))`,
      );
      const [prefs] = await tx
        .select()
        .from(tables.privacy_settings)
        .where(eq(tables.privacy_settings.user_id, userId));
      if (!prefs?.save_chat_history) return { saved: false };
      // A clear/consent change invalidates even already queued requests from another screen/device.
      if (prefs.updated_at.toISOString() !== input.historyVersion)
        throw new ConflictException(
          "Chat history changed. Reopen Companion before saving this transcript.",
        );
      if (!this.encryption)
        throw new ServiceUnavailableException(
          "Chat history saving is unavailable.",
        );
      const [thread] = await tx
        .select()
        .from(tables.chat_threads)
        .where(
          and(
            eq(tables.chat_threads.id, input.threadId),
            eq(tables.chat_threads.user_id, userId),
          ),
        );
      if (!thread) {
        const created = await tx
          .insert(tables.chat_threads)
          .values({ id: input.threadId, user_id: userId, title: "Companion" })
          .onConflictDoNothing()
          .returning();
        if (!created.length)
          throw new NotFoundException("Conversation not found");
      }
      const existing = await tx
        .select()
        .from(tables.chat_messages)
        .where(
          and(
            eq(tables.chat_messages.user_id, userId),
            inArray(
              tables.chat_messages.id,
              input.messages.map((m) => m.id),
            ),
          ),
        );
      if (
        existing.some(
          (row) => row.user_id !== userId || row.thread_id !== input.threadId,
        )
      )
        throw new ConflictException(
          "A message belongs to another conversation",
        );
      const storedIds = new Set(existing.map((row) => row.id));
      for (const row of existing) {
        const incoming = chatMessageSchema.parse(
          input.messages.find((m) => m.id === row.id)!,
        );
        const stored = chatMessageSchema.parse(
          JSON.parse(
            this.encryption.open(
              row.content_protected,
              userId,
              input.threadId,
              row.id,
            ),
          ),
        );
        if (JSON.stringify(stored) !== JSON.stringify(incoming))
          throw new ConflictException(
            "Saved transcript messages cannot be overwritten",
          );
      }
      // Preserve turn order even when a complete voice session is finalized in one request.
      const [last] = await tx
        .select({ createdAt: tables.chat_messages.created_at })
        .from(tables.chat_messages)
        .where(
          and(
            eq(tables.chat_messages.user_id, userId),
            eq(tables.chat_messages.thread_id, input.threadId),
          ),
        )
        .orderBy(desc(tables.chat_messages.created_at))
        .limit(1);
      const baseTime = Math.max(
        Date.now(),
        (last?.createdAt.getTime() ?? 0) + 1,
      );
      const fresh = input.messages.filter((m) => !storedIds.has(m.id));
      if (fresh.length) {
        const inserted = await tx
          .insert(tables.chat_messages)
          .values(
            fresh.map((message, index) => ({
              id: message.id,
              user_id: userId,
              thread_id: input.threadId,
              role: message.role,
              content_protected: this.encryption!.seal(
                JSON.stringify(chatMessageSchema.parse(message)),
                userId,
                input.threadId,
                message.id,
              ),
              created_at: new Date(baseTime + index),
            })),
          )
          .onConflictDoNothing()
          .returning({ id: tables.chat_messages.id });
        if (inserted.length !== fresh.length)
          throw new ConflictException("Message IDs are already in use");
      }
      return { saved: true };
    });
  }
  async clear(userId: string) {
    return this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`chat:${userId}`}))`,
      );
      await tx
        .delete(tables.chat_messages)
        .where(eq(tables.chat_messages.user_id, userId));
      await tx
        .delete(tables.chat_threads)
        .where(eq(tables.chat_threads.user_id, userId));
      const [row] = await tx
        .update(tables.privacy_settings)
        .set({
          updated_at: sql`GREATEST(clock_timestamp(), ${tables.privacy_settings.updated_at} + interval '1 millisecond')`,
        })
        .where(eq(tables.privacy_settings.user_id, userId))
        .returning();
      return {
        ok: true,
        historyVersion: row?.updated_at.toISOString() ?? null,
      };
    });
  }
}
