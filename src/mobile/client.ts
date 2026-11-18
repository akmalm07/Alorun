import { createClient } from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import { randomUUID } from "expo-crypto";
import { z } from "zod";
import { todaySchema } from "../shared/contracts";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const apiUrl = process.env.EXPO_PUBLIC_API_URL;
function isProjectUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "https:" || url.protocol === "http:") &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}
export const configurationError =
  supabaseUrl && !isProjectUrl(supabaseUrl)
    ? "The Supabase URL must be the project root URL, without /rest/v1 or another path. Check the app setup and restart Expo."
    : null;
export const configured = Boolean(
  supabaseUrl && supabaseKey && !configurationError,
);
export const supabase = configured
  ? createClient(supabaseUrl!, supabaseKey!, {
      auth: {
        storage: {
          getItem: (key: string) => SecureStore.getItemAsync(key),
          setItem: (key: string, value: string) =>
            SecureStore.setItemAsync(key, value),
          removeItem: (key: string) => SecureStore.deleteItemAsync(key),
        },
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
    })
  : null;
export const newId = randomUUID;

export async function api(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
  expectedUserId?: string,
): Promise<unknown> {
  if (!supabase || !apiUrl)
    throw new Error("App connection is not configured.");
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error("Please sign in again.");
  if (expectedUserId !== undefined && data.session.user.id !== expectedUserId)
    throw new Error(
      "The signed-in account changed. Reopen Companion before sending or saving messages.",
    );
  const form = body instanceof FormData;
  const response = await fetch(`${apiUrl.replace(/\/$/, "")}/v1${path}`, {
    method,
    signal,
    headers: {
      Authorization: `Bearer ${data.session.access_token}`,
      ...(!form ? { "Content-Type": "application/json" } : {}),
    },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const parsed = z.object({ message: z.string() }).safeParse(value);
    throw new Error(
      parsed.success
        ? parsed.data.message
        : "Unable to save changes. Please retry.",
    );
  }
  return value;
}
export async function loadToday(signal?: AbortSignal) {
  return todaySchema.parse(await api("/today", "GET", undefined, signal));
}
