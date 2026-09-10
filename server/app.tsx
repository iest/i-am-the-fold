import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { compress } from "hono/compress";
import { isIP } from "node:net";
import { DB } from "../util-server";
import { createApi } from "./api";
import { createPageCache } from "./cache";
import { Page, type Assets } from "./page";

export interface AppOptions {
  db: Pick<DB, "getFoldSample" | "addFold">;
  assets: Assets;
  publicDirectory: string;
  posthogKey?: string;
  trustFlyProxy?: boolean;
  now?: () => number;
  fetchUpstream?: typeof fetch;
}

export function createApp(options: AppOptions) {
  const app = new Hono<{ Bindings: HttpBindings }>();
  const api = createApi(options.db);
  const cachedPage = createPageCache(async () => {
    const folds = await options.db.getFoldSample();
    return "<!doctype html>" + await (<Page folds={folds} assets={options.assets} posthogKey={options.posthogKey} />).toString();
  }, options.now);

  app.use("*", compress());
  app.get("/", async c => {
    c.header("Cache-Control", "no-cache");
    return c.html(await cachedPage());
  });
  app.get("/health", c => c.text("ok"));
  app.get("/api", () => api.GET());
  app.post("/api", c => {
    const forwardedProtocol = options.trustFlyProxy ? c.req.header("x-forwarded-proto") : undefined;
    const address = options.trustFlyProxy
      ? c.req.header("fly-client-ip")
      : c.env?.incoming?.socket.remoteAddress;
    return api.POST(c.req.raw, {
      protocol: forwardedProtocol === "https" || forwardedProtocol === "http" ? `${forwardedProtocol}:` : undefined,
      ip: address && isIP(address) ? address : "unknown",
    });
  });

  app.use("/assets/*", async (c, next) => {
    await next();
    if (c.res.ok) c.header("Cache-Control", "public, max-age=31536000, immutable");
  });
  app.get("/assets/*", serveStatic({ root: options.publicDirectory }));

  // Only these two fixed PostHog hosts can be reached through this proxy.
  app.on(["GET", "POST"], "/ingest/*", async c => {
    const requestUrl = new URL(c.req.url);
    const target = new URL(requestUrl.pathname.startsWith("/ingest/static/")
      ? "https://eu-assets.i.posthog.com"
      : "https://eu.i.posthog.com");
    target.pathname = requestUrl.pathname.slice("/ingest".length);
    target.search = requestUrl.search;
    const headers = new Headers();
    for (const name of ["content-type", "accept", "user-agent"]) {
      const value = c.req.header(name);
      if (value) headers.set(name, value);
    }
    const upstream = await (options.fetchUpstream || fetch)(target, {
      method: c.req.method,
      headers,
      body: c.req.method === "POST" ? c.req.raw.body : undefined,
      duplex: "half",
      redirect: "manual",
      signal: AbortSignal.timeout(15000),
    } as RequestInit);
    const responseHeaders = new Headers();
    for (const name of ["content-type", "cache-control"]) {
      const value = upstream.headers.get(name);
      if (value) responseHeaders.set(name, value);
    }
    return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
  });

  app.onError((error, c) => {
    console.error("Request failed", error);
    return c.text("Temporarily unavailable", 503);
  });
  return app;
}
