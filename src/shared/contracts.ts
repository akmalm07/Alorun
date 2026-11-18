import { z } from "zod";

export const uuid = z.string().uuid();
const instant = z.string().datetime({ offset: true });
export const windowSchema = z.object({ start: instant, end: instant }).strict();
export const taskDraftSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    description: z.string().trim().max(1200),
    estimateMinutes: z.number().int().min(5).max(240),
  })
  .strict();
export const modelPlanSchema = z
  .object({
    rationale: z.string().trim().min(1).max(1200),
    tasks: z.array(taskDraftSchema).min(1).max(30),
  })
  .strict();
export const proposeSchema = z
  .object({
    goalId: uuid,
    requestId: uuid,
    windows: z.array(windowSchema).min(1).max(31),
  })
  .strict();
export const scheduledTaskSchema = taskDraftSchema.extend({
  start: instant,
  end: instant,
});
export const proposalSchema = z.object({
  id: uuid,
  goalId: uuid,
  rationale: z.string(),
  tasks: z.array(scheduledTaskSchema).min(1).max(30),
  windows: z.array(windowSchema),
  acceptedTaskIds: z.array(uuid).optional(),
});
export const acceptSchema = z
  .object({ tasks: z.array(taskDraftSchema).min(1).max(30) })
  .strict();
export const goalInputSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    motivation: z.string().trim().max(1200),
  })
  .strict();
export const taskStatusSchema = z
  .object({ status: z.enum(["pending", "completed"]) })
  .strict();
export const preferencesSchema = z.object({ enabled: z.boolean() }).strict();
export const goalSchema = z.object({
  id: uuid,
  title: z.string(),
  motivation: z.string().nullable(),
});
export const taskSchema = z.object({
  id: uuid,
  goalId: uuid.nullable(),
  title: z.string(),
  description: z.string().nullable(),
  dueAt: instant.nullable(),
  estimateMinutes: z.number().nullable(),
  status: z.string(),
});
export const checkinSchema = z.object({
  id: uuid,
  goalId: uuid,
  question: z.string(),
  status: z.enum(["pending", "skipped", "answered"]),
});
export const todaySchema = z.object({
  goals: z.array(goalSchema),
  tasks: z.array(taskSchema),
  proposals: z.array(proposalSchema),
  checkinsEnabled: z.boolean(),
});
export type Goal = z.infer<typeof goalSchema>;
export type Task = z.infer<typeof taskSchema>;
export type Proposal = z.infer<typeof proposalSchema>;
export type Checkin = z.infer<typeof checkinSchema>;
export type Window = z.infer<typeof windowSchema>;
export type TaskDraft = z.infer<typeof taskDraftSchema>;
export type ScheduledTask = z.infer<typeof scheduledTaskSchema>;

export const chatModeSchema = z.enum(["listen", "think", "plan"]);
export const chatTurnSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(4000),
  })
  .strict();
export const chatRequestSchema = z
  .object({
    requestId: uuid,
    mode: chatModeSchema,
    messages: z.array(chatTurnSchema).min(1).max(12),
  })
  .strict()
  .refine((input) => input.messages.at(-1)?.role === "user", {
    message: "A conversation must end with a user message.",
  });
export const chatReplySchema = z
  .object({
    reply: z.string().trim().min(1).max(4000),
    suggestedGoalId: uuid.nullable(),
  })
  .strict();
export const chatMessageSchema = chatTurnSchema.extend({
  id: uuid,
  source: z.enum(["text", "dictation", "voice"]),
  suggestedGoalId: uuid.nullable(),
});
export const chatSaveSchema = z
  .object({
    threadId: uuid,
    historyVersion: instant,
    messages: z.array(chatMessageSchema).min(1).max(60),
  })
  .strict();
export const threadMetaSchema = z
  .object({
    title: z.string().min(1).max(60),
    parentId: uuid.nullable().default(null),
    parentSnapshot: z.array(chatTurnSchema).max(20).default([]),
    manualPin: z.enum(["pinned", "unpinned"]).nullable().default(null),
    autoPin: z.boolean().default(false),
    lastActiveAt: instant.optional(),
  })
  .strict();
export const threadSummarySchema = threadMetaSchema.extend({
  id: uuid,
  createdAt: instant,
});
export type ThreadMeta = z.infer<typeof threadMetaSchema>;
export type ThreadSummary = z.infer<typeof threadSummarySchema>;
export const chatHistorySchema = z.object({
  threadId: uuid.nullable(),
  messages: z.array(chatMessageSchema),
  saveHistory: z.boolean(),
  savingAvailable: z.boolean(),
  historyVersion: instant.nullable(),
  metadata: threadMetaSchema.optional(),
});
export const chatSettingsSchema = z.object({
  saveHistory: z.boolean(),
  historyVersion: instant,
});
export const chatClearSchema = z.object({
  ok: z.boolean(),
  historyVersion: instant.nullable(),
});
export const transcriptionSchema = z.object({
  text: z.string().trim().min(1).max(4000),
});
export type ChatMode = z.infer<typeof chatModeSchema>;
export type ChatTurn = z.infer<typeof chatTurnSchema>;
export type ChatReply = z.infer<typeof chatReplySchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type ChatSave = z.infer<typeof chatSaveSchema>;
export type ChatContext = {
  goals: { id: string; title: string; motivation: string | null }[];
  tasks: {
    id: string;
    goalId: string | null;
    title: string;
    status: string;
    dueAt: string | null;
  }[];
};
