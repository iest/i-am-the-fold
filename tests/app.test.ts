import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApp } from "../server/app";
import { createPageCache } from "../server/cache";
import type { Assets } from "../server/page";

const assets: Assets = { client: "/assets/client.js", worker: "/assets/worker.js", styles: "/assets/styles.css" };
function options() {
  return {
    db: { getFoldSample: mock.fn(async () => [600, 800, 1000]), addFold: async () => "saved" as const },
    assets,
    publicDirectory: resolve("dist/public"),
  };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test("SSR includes the fold lines, Hyperinc link and browser script without hydration", async () => {
  const app = createApp(options());
  const response = await app.request("/");
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /^<!doctype html>/);
  assert.match(html, /href="https:\/\/hyperinc.ltd">@iest<\/a>/);
  assert.match(html, /top:800px/);
  assert.match(html, /id="current-fold" hidden/);
  assert.match(html, /data-fold-worker="\/assets\/worker.js"/);
  assert.doesNotMatch(html, /__NEXT|_next|react|data-posthog-key/);
  assert.equal(response.headers.get("cache-control"), "no-cache");
});

test("page cache coalesces first renders and refreshes after five minutes", async () => {
  let now = 0;
  let release!: (html: string) => void;
  const render = mock.fn(() => new Promise<string>(resolve => { release = resolve; }));
  const cached = createPageCache(render, () => now);
  const first = cached();
  const concurrent = cached();
  assert.equal(render.mock.callCount(), 1);
  release("first");
  assert.deepEqual(await Promise.all([first, concurrent]), ["first", "first"]);
  now = 299999;
  assert.equal(await cached(), "first");
  assert.equal(render.mock.callCount(), 1);
  now = 300000;
  assert.equal(await cached(), "first");
  assert.equal(await cached(), "first");
  assert.equal(render.mock.callCount(), 2);
  release("second");
  await tick();
  assert.equal(await cached(), "second");
});

test("failed cache refresh keeps the last page and backs off before retrying", async () => {
  let now = 0;
  const render = mock.fn(async () => "first");
  const errors = mock.fn();
  const cached = createPageCache(render, () => now, errors);
  assert.equal(await cached(), "first");
  render.mock.mockImplementation(async () => { throw new Error("Redis unavailable"); });
  now = 300000;
  assert.equal(await cached(), "first");
  await tick();
  assert.equal(errors.mock.callCount(), 1);
  now = 304999;
  assert.equal(await cached(), "first");
  assert.equal(render.mock.callCount(), 2);
  render.mock.mockImplementation(async () => "recovered");
  now = 305000;
  assert.equal(await cached(), "first");
  await tick();
  assert.equal(await cached(), "recovered");
});

test("HTTP routing caches the page but never turns unknown routes into HTML", async () => {
  const config = options();
  const app = createApp(config);
  await Promise.all([app.request("/"), app.request("/"), app.request("/?campaign=test")]);
  assert.equal(config.db.getFoldSample.mock.callCount(), 1);
  assert.equal((await app.request("/missing")).status, 404);
  assert.equal((await app.request("/.env.local")).status, 404);
  assert.equal(await (await app.request("/health")).text(), "ok");
});

test("Fly HTTPS forwarding is respected only when explicitly trusted", async () => {
  const send = (trustFlyProxy: boolean, origin: string) => createApp({ ...options(), trustFlyProxy }).request("http://www.iamthefold.com/api", {
    method: "POST",
    headers: { host: "www.iamthefold.com", origin, "x-forwarded-proto": "https", "content-type": "application/json" },
    body: JSON.stringify({ fold: "invalid" }),
  });
  assert.equal((await send(true, "https://www.iamthefold.com")).status, 400);
  assert.equal((await send(false, "https://www.iamthefold.com")).status, 403);
  assert.equal((await send(true, "https://unrelated.example")).status, 403);
});

test("PostHog proxy fixes destination hosts and strips credentials", async () => {
  const requests: { url: URL; init?: RequestInit }[] = [];
  const upstream = (async (input, init) => {
    requests.push({ url: new URL(String(input)), init });
    return new Response("analytics", { headers: { "content-type": "application/json", "set-cookie": "upstream=secret" } });
  }) as typeof fetch;
  const app = createApp({ ...options(), fetchUpstream: upstream });
  const response = await app.request("/ingest/static/script.js?v=1", { headers: { cookie: "private=secret", authorization: "secret" } });
  assert.equal(requests[0].url.href, "https://eu-assets.i.posthog.com/static/script.js?v=1");
  assert.equal(new Headers(requests[0].init?.headers).has("cookie"), false);
  assert.equal(new Headers(requests[0].init?.headers).has("authorization"), false);
  assert.equal(response.headers.has("set-cookie"), false);
  await app.request("/ingest//unrelated.example/test");
  assert.equal(requests[1].url.origin, "https://eu.i.posthog.com");
  assert.equal((await app.request("/ingest/event", { method: "DELETE" })).status, 404);
});

test("built assets are served with immutable caching and no source files are exposed", async () => {
  const manifest: Assets = JSON.parse(await readFile("dist/assets.json", "utf8"));
  const app = createApp({ ...options(), assets: manifest });
  for (const path of Object.values(manifest)) {
    const response = await app.request(path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  assert.equal((await app.request("/assets/%2e%2e/%2e%2e/package.json")).status, 404);
});
