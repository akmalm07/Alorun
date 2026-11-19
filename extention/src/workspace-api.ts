import { extensionApi } from "./browser/extension-api";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { hostPattern, webUrl } from "./browser/protocol";

function configuredUrl(raw: string | undefined) {
  const url = webUrl(raw ?? "");
  if (!url || url.search || url.hash) return undefined;
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    return undefined;
  return url;
}

const authUrl = configuredUrl(process.env.PLASMO_PUBLIC_SUPABASE_URL);
const apiUrl = configuredUrl(process.env.PLASMO_PUBLIC_ALORUN_API_URL);
const publicKey = process.env.PLASMO_PUBLIC_SUPABASE_ANON_KEY;

export const auth =
  authUrl && authUrl.pathname === "/" && apiUrl && publicKey
    ? createClient(authUrl.href, publicKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
        },
      })
    : null;

export async function grantAccountAccess() {
  const origins = [authUrl, apiUrl].flatMap((url) => {
    const pattern = url && hostPattern(url.href);
    return pattern ? [pattern] : [];
  });
  if (
    !(await extensionApi.permissions.request({
      origins: [...new Set(origins)],
    }))
  )
    throw new Error(
      "Allow this extension to reach the Alorun account and API to continue.",
    );
}

export type AppRequest = (
  path: string,
  method?: "GET" | "POST" | "PATCH" | "DELETE",
  body?: unknown,
) => Promise<unknown>;

export function appRequest(owner: string): AppRequest {
  return async (path, method = "GET", body) => {
    if (!auth || !apiUrl)
      throw new Error("The Alorun app connection needs configuration.");
    const { data, error } = await auth.auth.getSession();
    if (error || !data.session || data.session.user.id !== owner)
      throw new Error("Sign in again to continue.");
    const response = await fetch(
      `${apiUrl.href.replace(/\/$/, "")}/v1${path}`,
      {
        method,
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      },
    );
    const value: unknown = await response.json().catch(() => undefined);
    if (!response.ok) {
      const detail = z.object({ message: z.string() }).safeParse(value);
      throw new Error(
        detail.success
          ? detail.data.message
          : "Alorun couldn't complete the request. Try again.",
      );
    }
    return value;
  };
}
