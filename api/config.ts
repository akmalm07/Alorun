import { z } from "zod";

const configSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1),
  OPENAI_TRANSCRIPTION_MODEL: z.string().min(1),
  AI_INPUT_USD_PER_MILLION: z.coerce.number().positive(),
  AI_OUTPUT_USD_PER_MILLION: z.coerce.number().positive(),
  AI_TRANSCRIPTION_USD_PER_MINUTE: z.coerce.number().positive(),
  AI_DAILY_REQUEST_LIMIT: z.coerce.number().int().min(1).max(100).default(3),
  CHAT_ENCRYPTION_KEY: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
  MISSION_BUCKET: z.literal("alorun-missions").default("alorun-missions"),
  MISSION_STORAGE_SERVICE_KEY: z.string().min(1).optional(),
  MISSION_WORKER_SECRET: z.string().min(32).max(256).optional(),
  MISSION_WORKER_URL: z.string().url().optional(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
});
export type Config = z.infer<typeof configSchema>;
export function loadConfig(): Config {
  const result = configSchema.safeParse(process.env);
  if (!result.success)
    throw new Error(
      `Invalid server configuration: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  return result.data;
}
