import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createClient, type Session, type SupabaseClient, type User } from '@supabase/supabase-js';
import { z } from 'zod';

const credentialsSchema = z.object({ email: z.string().trim().email().max(254), password: z.string().min(8).max(128) }).strict();
const refreshSchema = z.object({ refreshToken: z.string().min(1).max(4096) }).strict();

function failure(status: number, code: string, message: string): never {
  throw new HttpException({ code, message }, status);
}
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) return failure(400, 'VALIDATION_ERROR', 'Check the supplied fields and try again.');
  return result.data;
}
function publicUser(user: User | null) {
  return user ? { id: user.id, email: user.email ?? null } : null;
}
function publicSession(session: Session | null) {
  return session ? { accessToken: session.access_token, refreshToken: session.refresh_token, expiresAt: session.expires_at ?? null } : null;
}

/** One stateless client per request prevents one user's session leaking to another. */
@Injectable()
export class AuthService {
  private client(): SupabaseClient {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) return failure(503, 'AUTH_UNAVAILABLE', 'Authentication is not configured.');
    return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  }

  async signUp(body: unknown) {
    const credentials = parse(credentialsSchema, body);
    const { data, error } = await this.client().auth.signUp(credentials);
    if (error) return failure(400, 'AUTH_FAILED', 'Unable to create account. Check your details and try again.');
    return { user: publicUser(data.user), session: publicSession(data.session) };
  }

  async signIn(body: unknown) {
    const credentials = parse(credentialsSchema, body);
    const { data, error } = await this.client().auth.signInWithPassword(credentials);
    if (error) return failure(401, 'AUTH_FAILED', 'Unable to sign in. Check your credentials and try again.');
    return { user: publicUser(data.user), session: publicSession(data.session) };
  }

  async refresh(body: unknown) {
    const { refreshToken } = parse(refreshSchema, body);
    const { data, error } = await this.client().auth.refreshSession({ refresh_token: refreshToken });
    if (error) return failure(401, 'AUTH_REQUIRED', 'Your session has expired. Sign in again.');
    return { user: publicUser(data.user), session: publicSession(data.session) };
  }

  async me(authorization?: string) {
    const token = bearer(authorization);
    // getUser verifies the token with the authentication server, unlike decoding a JWT locally.
    const { data, error } = await this.client().auth.getUser(token);
    if (error || !data.user) return failure(401, 'AUTH_REQUIRED', 'Sign in to continue.');
    return { user: publicUser(data.user) };
  }

  async signOut(authorization?: string) {
    const token = bearer(authorization);
    await this.me(authorization);
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) return failure(503, 'AUTH_UNAVAILABLE', 'Authentication is not configured.');
    try {
      const response = await fetch(`${url.replace(/\/$/, '')}/auth/v1/logout?scope=local`, {
        method: 'POST', headers: { apikey: key, Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return failure(503, 'AUTH_UNAVAILABLE', 'Unable to sign out right now.');
    } catch (error) {
      if (error instanceof HttpException) throw error;
      return failure(503, 'AUTH_UNAVAILABLE', 'Unable to sign out right now.');
    }
    return { ok: true };
  }
}

export function bearer(header?: string): string {
  const match = /^Bearer ([^\s]+)$/i.exec(header ?? '');
  if (!match) return failure(HttpStatus.UNAUTHORIZED, 'AUTH_REQUIRED', 'Sign in to continue.');
  return match[1];
}
