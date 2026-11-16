import "reflect-metadata";
import { RedactedErrors } from "./errors";
import { Module } from "@nestjs/common";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { NestFactory } from "@nestjs/core";
import { loadConfig } from "./config";
import { createDatabase } from "./database";
import { AuthGuard, AUTH_VERIFIER, createVerifier } from "./auth";
import { GoalController, HealthController } from "./controller";
import { OpenAIProvider } from "./provider";
import { GoalService } from "./service";
import { ChatService } from "./chat-service";
import { ChatController } from "./chat-controller";
import { ChatEncryption } from "./chat-crypto";
import { MissionsService } from "./missions/service";
import { MissionsController, MISSION_WAKE } from "./missions/controller";
import { SupabaseBucket } from "./missions/storage";
import { OpenAIMissionModel } from "./missions/model";
import { invokeMissionWorker } from "./missions/handler";

async function main() {
  const config = loadConfig();
  const { db, pool } = createDatabase(config.DATABASE_URL);
  const provider = new OpenAIProvider(config);
  @Module({
    controllers: [
      GoalController,
      ChatController,
      MissionsController,
      HealthController,
    ],
    providers: [
      {
        provide: MissionsService,
        useFactory: () =>
          new MissionsService(
            db,
            new OpenAIMissionModel({
              key: config.OPENAI_API_KEY,
              model: config.OPENAI_MODEL,
              inputPrice: config.AI_INPUT_USD_PER_MILLION,
              outputPrice: config.AI_OUTPUT_USD_PER_MILLION,
            }),
            config.MISSION_STORAGE_SERVICE_KEY
              ? new SupabaseBucket(
                  config.SUPABASE_URL,
                  config.MISSION_STORAGE_SERVICE_KEY,
                  config.MISSION_BUCKET,
                )
              : null,
            {
              bucket: config.MISSION_BUCKET,
              runnerAvailable: Boolean(
                config.MISSION_STORAGE_SERVICE_KEY &&
                config.MISSION_WORKER_URL &&
                config.MISSION_WORKER_SECRET,
              ),
              dailyLimit: config.AI_DAILY_REQUEST_LIMIT,
            },
          ),
      },
      {
        provide: MISSION_WAKE,
        useValue: async (runId: string) => {
          if (!config.MISSION_WORKER_URL || !config.MISSION_WORKER_SECRET)
            throw new Error("Runner unavailable");
          await invokeMissionWorker(
            config.MISSION_WORKER_URL,
            config.MISSION_WORKER_SECRET,
            "wake",
            runId,
          );
        },
      },
      {
        provide: ChatService,
        inject: [GoalService],
        useFactory: (usage: GoalService) =>
          new ChatService(
            db,
            provider,
            usage,
            config.CHAT_ENCRYPTION_KEY
              ? new ChatEncryption(config.CHAT_ENCRYPTION_KEY)
              : null,
          ),
      },
      AuthGuard,
      {
        provide: AUTH_VERIFIER,
        useFactory: () =>
          createVerifier(config.SUPABASE_URL, config.SUPABASE_ANON_KEY),
      },
      {
        provide: GoalService,
        useFactory: () =>
          new GoalService(db, provider, config.AI_DAILY_REQUEST_LIMIT),
      },
    ],
  })
  class AppModule {}
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    logger: ["error", "warn"],
  });
  app.useBodyParser("json", { limit: "2mb" });
  app.useGlobalFilters(new RedactedErrors());
  // Native clients don't need CORS. Do not expose browser origins by default.
  app.enableShutdownHooks();
  await app.listen(config.PORT, "0.0.0.0");
  const shutdown = () => {
    void pool.end();
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}
void main().catch(() => {
  console.error(
    "API startup failed. Check server configuration and database access.",
  );
  process.exitCode = 1;
});
