import { extensionApi } from "./extension-api";
import { z } from "zod";
import {
  actionsSchema,
  layoutSchema,
  type Control,
  type Layout,
} from "./plans";

export function webUrl(value: string) {
  try {
    const url = new URL(value);
    if (
      (url.protocol === "https:" || url.protocol === "http:") &&
      !url.username &&
      !url.password
    )
      return url;
  } catch {
    // Browser pages and malformed input have no supported origin.
  }
  return null;
}

export function pageAddress(value: string) {
  const url = webUrl(value);
  if (!url) return null;
  const routeHash = url.hash.match(/^#!?\/[^?]*/)?.[0] ?? "";
  return { origin: url.origin, path: url.pathname + routeHash };
}

export function hostPattern(value: string) {
  const url = webUrl(value);
  return url ? `${url.protocol}//${url.hostname}/*` : null;
}

const visitSchema = z.object({
  path: z.string().startsWith("/").max(1024),
  title: z.string().max(1024),
  count: z.number().int().positive(),
  last: z.number(),
});
export type Visit = z.infer<typeof visitSchema>;
const siteSchema = z.object({
  pages: z.record(z.string(), layoutSchema),
  visits: z.array(visitSchema).max(50),
});
export type SiteState = z.infer<typeof siteSchema>;
export const decodeSite = (value: unknown): SiteState =>
  siteSchema.safeParse(value).data ?? { pages: {}, visits: [] };
export const siteKey = (origin: string) => `browser-site:${origin}`;

export async function readSite(origin: string): Promise<SiteState> {
  const key = siteKey(origin);
  return decodeSite((await extensionApi.storage.local.get(key))[key]);
}

export type BrowserSnapshot = {
  instance: string;
  href: string;
  controls: Control[];
  preview?: Layout;
  offerRemember: boolean;
  saved?: Layout;
  run: RunStatus;
};
export type RunStatus = {
  state: "idle" | "running" | "done" | "stopped" | "failed";
  message: string;
};
const scope = z.object({
  instance: z.string().regex(/^[a-f0-9]{32}$/),
  href: z.string().max(8192),
});
export const pageRequest = z.discriminatedUnion("type", [
  z.object({ type: z.literal("inspect") }),
  z.object({ type: z.literal("preview"), scope, layout: layoutSchema }),
  z.object({ type: z.literal("dismiss"), scope }),
  z.object({ type: z.literal("defer"), scope }),
  z.object({ type: z.literal("run"), scope, actions: actionsSchema }),
  z.object({ type: z.literal("stop"), scope }),
]);
export type PageRequest = z.infer<typeof pageRequest>;
export const workerRequest = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("visit"),
    href: z.string().max(8192),
    title: z.string().max(100),
  }),
  z.object({
    type: z.literal("save"),
    href: z.string().max(8192),
    layout: layoutSchema,
  }),
  z.object({ type: z.literal("forget"), href: z.string().max(8192) }),
]);
export type WorkerRequest = z.infer<typeof workerRequest>;
export type Reply<T = unknown> =
  { ok: true; value: T } | { ok: false; error: string };
export const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";

export function respond<T>(
  operation: Promise<T>,
  send: (reply: Reply<T>) => void,
) {
  void operation.then(
    (value) => send({ ok: true, value }),
    (error: unknown) => send({ ok: false, error: errorText(error) }),
  );
  return true;
}
