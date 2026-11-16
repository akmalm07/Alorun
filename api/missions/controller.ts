import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from "@nestjs/common";
import { z } from "zod";
import {
  createMissionSchema,
  missionInputSchema,
  missionScheduleSchema,
} from "../../src/shared/missions";
import { uuid } from "../../src/shared/contracts";
import { AuthGuard, type AuthRequest } from "../auth";
import { MissionsService } from "./service";
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new BadRequestException("Check the mission fields and try again.");
  return parsed.data;
}
export const MISSION_WAKE = "MISSION_WAKE";
@Controller("v1/missions")
@UseGuards(AuthGuard)
export class MissionsController {
  constructor(
    @Inject(MissionsService) private missions: MissionsService,
    @Inject(MISSION_WAKE) private wake: (runId: string) => Promise<void>,
  ) {}
  @Get() list(@Req() req: AuthRequest) {
    return this.missions.list(req.userId);
  }
  @Post("preview") preview(@Body() body: unknown) {
    const input = parse(missionScheduleSchema, body);
    return this.missions.preview(input.cron, input.timezone);
  }
  @Post() create(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.missions.create(req.userId, parse(createMissionSchema, body));
  }
  @Get(":id") detail(@Req() req: AuthRequest, @Param("id") id: string) {
    return this.missions.detail(req.userId, parse(uuid, id));
  }
  @Patch(":id") toggle(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return this.missions.setEnabled(
      req.userId,
      parse(uuid, id),
      parse(z.object({ enabled: z.boolean() }).strict(), body).enabled,
    );
  }
  @Post(":id/run") async run(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const result = await this.missions.enqueueManual(
      req.userId,
      parse(uuid, id),
      parse(z.object({ requestId: uuid }).strict(), body).requestId,
    );
    if (result.status === "queued") {
      try {
        await this.wake(result.runId);
      } catch {
        /* Durable queue is recovered by the next dispatcher tick. */
      }
    }
    return result;
  }
  @Get(":id/files") read(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Query("name") name: unknown,
  ) {
    return this.missions.readInput(
      req.userId,
      parse(uuid, id),
      parse(missionInputSchema.shape.name, name),
    );
  }
  @Post(":id/files") write(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = parse(missionInputSchema, body);
    return this.missions.putInput(
      req.userId,
      parse(uuid, id),
      input.name,
      input.content,
    );
  }
  @Get(":id/runs/:runId/artifact") artifact(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Param("runId") runId: string,
  ) {
    return this.missions.artifact(
      req.userId,
      parse(uuid, id),
      parse(uuid, runId),
    );
  }
}
