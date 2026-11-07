import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AuthService } from './auth.service';

@Module({ controllers: [AppController], providers: [AuthService] })
export class AppModule {}
