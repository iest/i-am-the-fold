import { serve } from "@hono/node-server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DB } from "../util-server";
import { createApp } from "./app";
import type { Assets } from "./page";

if (!process.env.SECRET) throw new Error("Set SECRET before starting the server");
const assets: Assets = JSON.parse(readFileSync(new URL("./assets.json", import.meta.url), "utf8"));
const app = createApp({
  db: new DB(),
  assets,
  publicDirectory: fileURLToPath(new URL("./public", import.meta.url)),
  posthogKey: process.env.POSTHOG_KEY || process.env.NEXT_PUBLIC_POSTHOG_KEY,
  trustFlyProxy: Boolean(process.env.FLY_APP_NAME),
});
const server = serve({ fetch: app.fetch, hostname: "0.0.0.0", port: Number(process.env.PORT || 3000) }, info => {
  console.log(`Listening on http://localhost:${info.port}`);
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close(error => { process.exit(error ? 1 : 0); });
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
