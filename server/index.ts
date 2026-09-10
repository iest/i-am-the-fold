import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DB } from "../util-server";
import { createApp } from "./app";
import type { Assets } from "./page";
import { validateConfig } from "./config";
import { Server } from "node:http";

const config = validateConfig(process.env);
const db = new DB();
if (process.argv.includes("--check-config")) {
  try {
    await db.getFoldSample();
    console.log("Production configuration and Redis read check passed");
  } catch {
    console.error("Production Redis read check failed");
    process.exitCode = 1;
  } finally {
    db.close();
  }
  process.exit(process.exitCode ?? 0);
}
const assets: Assets = JSON.parse(
  readFileSync(new URL("./assets.json", import.meta.url), "utf8"),
);
const app = createApp({
  db,
  assets,
  publicDirectory: fileURLToPath(new URL("./public", import.meta.url)),
  posthogKey: process.env.POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY,
  trustFlyProxy: Boolean(process.env.FLY_APP_NAME),
  production: config.production,
});
const server = serve(
  { fetch: app.fetch, hostname: "0.0.0.0", port: config.port },
  (info) => {
    console.log(`Listening on http://localhost:${info.port}`);
  },
);
if (!(server instanceof Server)) throw new Error("Expected the HTTP/1 server");
server.requestTimeout = 10000;
server.headersTimeout = 10000;
server.keepAliveTimeout = 5000;
server.maxConnections = 256;
server.maxRequestsPerSocket = 100;
server.setTimeout(15000, (socket) => socket.destroy());
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close((error) => {
      db.close();
      process.exit(error ? 1 : 0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
