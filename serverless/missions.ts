import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import * as schema from "../db/schema";
import { MissionsService } from "../api/missions/service";
import { SupabaseBucket } from "../api/missions/storage";
import { OpenAIMissionModel } from "../api/missions/model";
import {
  createMissionsHandler,
  invokeMissionWorker,
} from "../api/missions/handler";
const workerConfig = z.object({
  DATABASE_URL: z.string().min(1),
  SUPABASE_URL: z.string().url(),
  MISSION_STORAGE_SERVICE_KEY: z.string().min(1),
  MISSION_BUCKET: z.literal("alorun-missions").default("alorun-missions"),
  MISSION_WORKER_SECRET: z.string().min(32).max(256),
  MISSION_WORKER_URL: z.string().url(),
  OPENAI_API_KEY: z.string().min(1),
  OPENAI_MODEL: z.string().min(1),
  AI_INPUT_USD_PER_MILLION: z.coerce.number().positive(),
  AI_OUTPUT_USD_PER_MILLION: z.coerce.number().positive(),
  AI_DAILY_REQUEST_LIMIT: z.coerce.number().int().min(1).max(100).default(3),
});
export function createServerlessMissions(
  env: Record<string, string | undefined>,
  background: (promise: Promise<unknown>) => void,
) {
  const result = workerConfig.safeParse({
    ...env,
    MISSION_STORAGE_SERVICE_KEY:
      env.MISSION_STORAGE_SERVICE_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!result.success)
    throw new Error("Mission worker configuration incomplete");
  const config = result.data;
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10_000,
    query_timeout: 15_000,
  });
  const db = drizzle(pool, { schema });
  const model = new OpenAIMissionModel({
    key: config.OPENAI_API_KEY,
    model: config.OPENAI_MODEL,
    inputPrice: config.AI_INPUT_USD_PER_MILLION,
    outputPrice: config.AI_OUTPUT_USD_PER_MILLION,
  });
  const missions = new MissionsService(
    db,
    model,
    new SupabaseBucket(
      config.SUPABASE_URL,
      config.MISSION_STORAGE_SERVICE_KEY,
      config.MISSION_BUCKET,
    ),
    {
      bucket: config.MISSION_BUCKET,
      runnerAvailable: true,
      dailyLimit: config.AI_DAILY_REQUEST_LIMIT,
    },
  );
  const handler = createMissionsHandler(
    missions,
    config.MISSION_WORKER_SECRET,
    (ids) => {
      background(
        Promise.allSettled(
          ids
            .slice(0, 5)
            .map((id) =>
              invokeMissionWorker(
                config.MISSION_WORKER_URL,
                config.MISSION_WORKER_SECRET,
                "run",
                id,
              ),
            ),
        ),
      );
    },
  );
  return Object.assign(handler, { close: () => pool.end() });
}
