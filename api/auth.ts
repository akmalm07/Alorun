import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { createClient } from "@supabase/supabase-js";
export interface AuthRequest {
  headers: Record<string, string | string[] | undefined>;
  userId: string;
}
export interface AuthVerifier {
  verify(token: string): Promise<string | null>;
}
export const AUTH_VERIFIER = "AUTH_VERIFIER";
export function createVerifier(url: string, key: string): AuthVerifier {
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return {
    async verify(token) {
      const { data, error } = await client.auth.getUser(token);
      return error ? null : (data.user?.id ?? null);
    },
  };
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AUTH_VERIFIER) private verifier: AuthVerifier) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const authorization = request.headers.authorization;
    if (
      typeof authorization !== "string" ||
      !authorization.startsWith("Bearer ")
    )
      throw new UnauthorizedException();
    const userId = await this.verifier.verify(authorization.slice(7));
    if (!userId) throw new UnauthorizedException();
    request.userId = userId;
    return true;
  }
}
