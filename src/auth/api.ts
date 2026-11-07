/** Public API origin only. Never put service keys in the app. */
const API_URL = process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, '') ?? 'http://10.0.2.2:3000';

export type AuthUser = { id: string; email: string | null };
export type AuthSession = { accessToken: string; refreshToken: string; expiresAt: number | null };
export type AuthResponse = { user: AuthUser; session: AuthSession | null };

export class ApiError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

/** Typed transport boundary; add domain-specific methods here as the API grows. */
export async function apiRequest<T>(path: string, options: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}/v1${path}`, {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }
  if (!response.ok) {
    // Avoid exposing provider internals and never log credentials or response bodies.
    throw new ApiError(response.status === 401 ? 'Your email or password could not be verified.' : 'Something went wrong. Please try again.', response.status);
  }
  return response.json() as Promise<T>;
}
