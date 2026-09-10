import { Hono } from "hono";
import type { HttpBindings } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { compress } from "hono/compress";
import { secureHeaders } from "hono/secure-headers";
import { DB } from "../util-server";
import { createApi, isSameOrigin } from "./api";
import { createPageCache, PageUnavailable } from "./cache";
import { Page, type Assets } from "./page";
import { createRateLimiter } from "./limits";
import { normalizeIP, rateLimitKey } from "./network";

export interface AppOptions {
  db: Pick<DB, "getFoldSample" | "addFold">;
  assets: Assets;
  publicDirectory: string;
  posthogKey?: string;
  trustFlyProxy?: boolean;
  production?: boolean;
  now?: () => number;
}

export function createApp(options: AppOptions) {
  const app = new Hono<{ Bindings: HttpBindings }>();
  const api = createApi(options.db, options.now);
  const perSource = createRateLimiter(12, 6, 4096, options.now);
  const globalBudget = createRateLimiter(60, 300, 1, options.now);
  let activeSubmissions = 0;
  const clientIP = (c: {
    req: { header: (name: string) => string | undefined };
    env?: HttpBindings;
  }) =>
    normalizeIP(
      options.trustFlyProxy
        ? c.req.header("fly-client-ip")
        : c.env?.incoming?.socket.remoteAddress,
    );
  const cachedPage = createPageCache(async () => {
    const folds = await options.db.getFoldSample();
    return (
      "<!doctype html>" +
      (await (
        <Page
          folds={folds}
          assets={options.assets}
          posthogKey={options.posthogKey}
        />
      ).toString())
    );
  }, options.now);

  app.use(
    "*",
    secureHeaders({
      xFrameOptions: "DENY",
      referrerPolicy: "strict-origin-when-cross-origin",
      strictTransportSecurity: options.production ? "max-age=31536000" : false,
      contentSecurityPolicy: {
        defaultSrc: ["'self'"],
        baseUri: ["'none'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'none'"],
        scriptSrc: ["'self'", "https://eu-assets.i.posthog.com"],
        styleSrc: ["'self'"],
        styleSrcAttr: ["'unsafe-inline'"],
        workerSrc: ["'self'"],
        connectSrc: [
          "'self'",
          "https://eu.i.posthog.com",
          "https://eu-assets.i.posthog.com",
        ],
        imgSrc: ["'self'", "data:", "https://eu.i.posthog.com"],
      },
    }),
  );
  app.use("*", compress());
  app.get("/", async (c) => {
    c.header("Cache-Control", "no-cache");
    return c.html(await cachedPage());
  });
  app.get("/health", (c) => c.text("ok"));
  app.use("/api", async (c, next) => {
    c.header("Cache-Control", "no-store");
    const site = c.req.header("sec-fetch-site");
    const forwarded = options.trustFlyProxy
      ? c.req.header("x-forwarded-proto")
      : undefined;
    const protocol =
      forwarded === "https" || forwarded === "http"
        ? `${forwarded}:`
        : new URL(c.req.url).protocol;
    // Foreign pages must not be able to spend a visitor's request allowance.
    if (
      (site && site !== "same-origin" && site !== "none") ||
      (c.req.method === "POST" && !isSameOrigin(c.req.raw, protocol))
    ) {
      return c.json({ message: "Invalid origin" }, 403);
    }
    const ip = clientIP(c);
    if (!ip)
      return c.json({ message: "Unable to identify request source" }, 400);
    // Same budget for challenge issuance and writes; no Redis call on rejection.
    if (
      !perSource(rateLimitKey(ip)) ||
      !globalBudget("all") ||
      activeSubmissions >= 32
    ) {
      c.header("Retry-After", "10");
      return c.json({ message: "Too many requests" }, 429);
    }
    activeSubmissions++;
    try {
      await next();
    } finally {
      activeSubmissions--;
    }
  });
  app.get("/api", () => api.GET());
  app.post("/api", (c) => {
    const forwardedProtocol = options.trustFlyProxy
      ? c.req.header("x-forwarded-proto")
      : undefined;
    return api.POST(c.req.raw, {
      protocol:
        forwardedProtocol === "https" || forwardedProtocol === "http"
          ? `${forwardedProtocol}:`
          : undefined,
      ip: clientIP(c),
    });
  });

  app.use("/assets/*", async (c, next) => {
    await next();
    if (c.res.ok)
      c.header("Cache-Control", "public, max-age=31536000, immutable");
  });
  app.get("/assets/*", serveStatic({ root: options.publicDirectory }));

  app.onError((error, c) => {
    c.header("Cache-Control", "no-store");
    if (error instanceof PageUnavailable)
      c.header("Retry-After", String(error.retryAfter));
    else console.error("Request failed");
    return c.text("Temporarily unavailable", 503);
  });
  return app;
}
