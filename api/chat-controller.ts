import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Patch,
  Post,
  Req,
  Param,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";
import {
  chatRequestSchema,
  chatSaveSchema,
  uuid,
  threadMetaSchema,
} from "../src/shared/contracts";
import { AuthGuard, type AuthRequest } from "./auth";
import { ChatService } from "./chat-service";
import { m4aDuration } from "./audio";

function parse<T>(schema: z.ZodType<T>, input: unknown) {
  const value = schema.safeParse(input);
  if (!value.success)
    throw new BadRequestException("Invalid conversation request");
  return value.data;
}
@Controller("v1/chat")
@UseGuards(AuthGuard)
export class ChatController {
  constructor(@Inject(ChatService) private service: ChatService) {}
  @Post("reply") reply(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.reply(req.userId, parse(chatRequestSchema, body));
  }
  @Get("threads") threads(@Req() req: AuthRequest) {
    return this.service.threads(req.userId);
  }
  @Patch("threads/:id/pin") pin(
    @Req() req: AuthRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const input = parse(
      z
        .object({ manualPin: z.enum(["pinned", "unpinned"]).nullable() })
        .strict(),
      body,
    );
    return this.service.pin(req.userId, parse(uuid, id), input.manualPin);
  }
  @Get("history") history(
    @Req() req: AuthRequest,
    @Query("threadId") id?: string,
  ) {
    return this.service.history(req.userId, id ? parse(uuid, id) : undefined);
  }
  @Post("history") save(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.save(
      req.userId,
      parse(
        chatSaveSchema.extend({ metadata: threadMetaSchema.optional() }),
        body,
      ),
    );
  }
  @Patch("settings") settings(@Req() req: AuthRequest, @Body() body: unknown) {
    return this.service.settings(
      req.userId,
      parse(z.object({ saveHistory: z.boolean() }).strict(), body).saveHistory,
    );
  }
  @Delete("history") clear(@Req() req: AuthRequest) {
    return this.service.clear(req.userId);
  }
  @Post("transcribe")
  @UseInterceptors(
    FileInterceptor("audio", {
      limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 1 },
    }),
  )
  transcribe(
    @Req() req: AuthRequest,
    @Body() body: unknown,
    @UploadedFile() audio?: { buffer: Buffer; mimetype: string },
  ) {
    const input = parse(z.object({ requestId: uuid }).strict(), body);
    if (
      !audio?.buffer.length ||
      !["audio/mp4", "audio/m4a", "audio/x-m4a"].includes(audio.mimetype)
    )
      throw new BadRequestException("Record a native M4A voice clip.");
    try {
      m4aDuration(audio.buffer);
    } catch {
      throw new BadRequestException(
        "Record between 1 and 60 seconds of valid M4A audio.",
      );
    }
    return this.service.transcribe(req.userId, input.requestId, audio);
  }
}
