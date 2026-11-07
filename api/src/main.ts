import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('v1');
  // Browser origins must be explicitly configured. Native apps do not use CORS.
  const origins = process.env.CORS_ORIGINS?.split(',').map((value) => value.trim()).filter(Boolean);
  if (origins?.length) app.enableCors({ origin: origins });
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535');
  await app.listen(port, '0.0.0.0');
}
void bootstrap();
