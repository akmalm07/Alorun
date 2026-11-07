import { Body, Controller, Get, Headers, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller()
export class AppController {
  constructor(private readonly auth: AuthService) {}

  @Get('health') health() { return { status: 'ok' }; }
  @Post('auth/sign-up') signUp(@Body() body: unknown) { return this.auth.signUp(body); }
  @Post('auth/sign-in') signIn(@Body() body: unknown) { return this.auth.signIn(body); }
  @Post('auth/refresh') refresh(@Body() body: unknown) { return this.auth.refresh(body); }
  @Post('auth/sign-out') signOut(@Headers('authorization') authorization?: string) { return this.auth.signOut(authorization); }
  @Get('me') me(@Headers('authorization') authorization?: string) { return this.auth.me(authorization); }
}
