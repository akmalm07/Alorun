import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from "@nestjs/common";
import { ScheduleError } from "../src/domain/schedule";
import { MissionError } from "./missions/errors";
@Catch()
export class RedactedErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host
      .switchToHttp()
      .getResponse<{ status(code: number): { json(body: unknown): void } }>();
    const status =
      error instanceof HttpException
        ? error.getStatus()
        : error instanceof MissionError
          ? error.status
          : error instanceof ScheduleError
            ? 409
            : 500;
    const message =
      error instanceof HttpException ||
      error instanceof ScheduleError ||
      error instanceof MissionError
        ? error.message
        : "Request failed. Please retry.";
    response.status(status).json({ message });
  }
}
