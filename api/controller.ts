import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import {
  acceptSchema,
  goalInputSchema,
  preferencesSchema,
  proposeSchema,
  taskStatusSchema,
  uuid,
} from "../src/shared/contracts";
import { AuthGuard, type AuthRequest } from "./auth";
import { GoalService } from "./service";
import { m4aDuration } from "./audio";

function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new BadRequestException(
      "Invalid request. Check the supplied fields.",
    );
  return result.data;
}
@Controller("v1")
@UseGuards(AuthGuard)
export class GoalController {
  constructor(@Inject(GoalService) private service: GoalService) {}
  @Post("me") profile(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.profile(
      req.userId,
      parse(z.object({ timezone: z.string().max(100) }).strict(), body)
        .timezone,
    );
  }
  @Get("today") today(@Req() req: AuthRequest) {
    return this.service.today(req.userId);
  }
  @Post("goals") goal(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.createGoal(
      req.userId,
      parse(goalInputSchema.extend({ id: uuid }), body),
    );
  }
  @Post("plans/propose") propose(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.service.propose(req.userId, parse(proposeSchema, body));
  }
  @Post("plans/:id/accept") accept(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.accept(
      req.userId,
      parse(uuid, id),
      parse(acceptSchema, body).tasks,
    );
  }
  @Post("plans/:id/reject") reject(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    return this.service.reject(req.userId, parse(uuid, id));
  }
  @Patch("tasks/:id") task(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.service.taskStatus(
      req.userId,
      parse(uuid, id),
      parse(taskStatusSchema, body).status,
    );
  }
  @Patch("settings/goal-checkins") preferences(
    @Req() req: AuthRequest,
    @Body() body: unknown,
  ) {
    return this.service.preferences(
      req.userId,
      parse(preferencesSchema, body).enabled,
    );
  }
  @Post("checkins/open") open(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.openCheckin(
      req.userId,
      parse(z.object({ requestId: uuid }).strict(), body).requestId,
    );
  }
  @Post("checkins/:id/skip") skip(
    @Req() req: AuthRequest,
    @Param("id") id: string,
  ) {
    return this.service.skipCheckin(req.userId, parse(uuid, id));
  }
  @Post("checkins/:id/voice")
  @UseInterceptors(
    FileInterceptor("audio", {
      limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 1 },
    }),
  )
  voice(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
    @UploadedFile() audio?: { buffer: Buffer; mimetype: string },
  ) {
    const request = parse(z.object({ requestId: uuid }).strict(), body);
    if (
      !audio?.buffer.length ||
      !["audio/mp4", "audio/m4a", "audio/x-m4a"].includes(audio.mimetype)
    ) {
      throw new BadRequestException(
        "Record an audio response. Typed answers are not accepted.",
      );
    }
    try {
      m4aDuration(audio.buffer);
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Invalid audio",
      );
    }
    return this.service.answerVoice(
      req.userId,
      parse(uuid, id),
      request.requestId,
      audio,
    );
  }
}
@Controller()
export class HealthController {
  @Get("health") health() {
    return { ok: true };
  }
}
