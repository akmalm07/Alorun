import { z } from "zod";
import { uuid } from "./contracts";
const instant = z.string().datetime({ offset: true });
export const missionKindSchema = z.enum(["practice", "briefing", "review"]);
export const missionDefinitionSchema = z
  .object({
    goalId: uuid,
    title: z.string().trim().min(3).max(120),
    instructions: z.string().trim().min(10).max(2000),
    kind: missionKindSchema,
    cron: z.string().trim().min(9).max(100),
    timezone: z.string().min(1).max(80),
    folder: z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/),
  })
  .strict();
export const createMissionSchema = missionDefinitionSchema.extend({
  id: uuid,
  enabled: z.boolean(),
  approved: z.literal(true),
});
export const missionSuggestionSchema = z.object({
  goalId: uuid,
  title: z.string(),
  instructions: z.string(),
  kind: missionKindSchema,
  reason: z.string(),
  cron: z.string(),
  folder: z.string(),
});
export const missionSchema = missionDefinitionSchema.extend({
  id: uuid,
  status: z.enum(["active", "paused"]),
  nextRunAt: instant.nullable(),
  createdAt: instant,
});
export const missionRunSchema = z.object({
  id: uuid,
  missionId: uuid,
  status: z.enum(["queued", "running", "succeeded", "failed", "cancelled"]),
  scheduledFor: instant,
  startedAt: instant.nullable(),
  finishedAt: instant.nullable(),
  summary: z.string().nullable(),
  error: z.string().nullable(),
  artifact: z.string().nullable(),
});
export const missionsPageSchema = z.object({
  missions: z.array(missionSchema),
  suggestions: z.array(missionSuggestionSchema),
  runnerAvailable: z.boolean(),
  bucket: z.string(),
});
export const missionDetailSchema = z.object({
  mission: missionSchema,
  runs: z.array(missionRunSchema),
  files: z.array(z.object({ name: z.string(), size: z.number() })),
  storagePath: z.string(),
  storageAvailable: z.boolean(),
});
export const missionOutputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    summary: z.string().trim().min(1).max(320),
    markdown: z.string().trim().min(10).max(16000),
  })
  .strict();
export const missionScheduleSchema = z
  .object({ cron: z.string().max(100), timezone: z.string().max(80) })
  .strict();
export const missionInputSchema = z
  .object({
    name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,55}\.(txt|md|json)$/),
    content: z.string().min(1).max(16000),
  })
  .strict();
export type MissionDefinition = z.infer<typeof missionDefinitionSchema>;
export type Mission = z.infer<typeof missionSchema>;
export type MissionRun = z.infer<typeof missionRunSchema>;
export type MissionSuggestion = z.infer<typeof missionSuggestionSchema>;
export type MissionOutput = z.infer<typeof missionOutputSchema>;
