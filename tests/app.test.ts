import assert from "node:assert/strict";
import { test, mock, before } from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createApp } from "../server/app";
import { createPageCache } from "../server/cache";
import type { HttpBindings } from "@hono/node-server";
import type { Assets } from "../server/page";

before(() => {
  process.env.SECRET = "isolated-app-test-secret";
});
const connection = {
  incoming: { socket: { remoteAddress: "192.0.2.1" } },
} as HttpBindings;
const assets: Assets = {
  client: "/assets/client.js",
  worker: "/assets/worker.js",
  styles: "/assets/styles.css",
};
function options() {
  return {
    db: {
      getFoldSample: mock.fn(async () => [600, 800, 1000]),
      addFold: async () => "saved" as const,
    },
    assets,
    publicDirectory: resolve("dist/public"),
  };
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

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
  const render = mock.fn(
    () =>
      new Promise<string>((resolve) => {
        release = resolve;
      }),
  );
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
  render.mock.mockImplementation(async () => {
    throw new Error("Redis unavailable");
  });
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
  await Promise.all([
    app.request("/"),
    app.request("/"),
    app.request("/?campaign=test"),
  ]);
  assert.equal(config.db.getFoldSample.mock.callCount(), 1);
  assert.equal((await app.request("/missing")).status, 404);
  assert.equal((await app.request("/.env.local")).status, 404);
  assert.equal(await (await app.request("/health")).text(), "ok");
});

test("Fly HTTPS forwarding is respected only when explicitly trusted", async () => {
  const send = (trustFlyProxy: boolean, origin: string) =>
    createApp({ ...options(), trustFlyProxy }).request(
      "http://www.iamthefold.com/api",
      {
        method: "POST",
        headers: {
          host: "www.iamthefold.com",
          origin,
          "x-forwarded-proto": "https",
          "fly-client-ip": "192.0.2.1",
          "content-type": "application/json",
        },
        body: JSON.stringify({ fold: "invalid" }),
      },
      connection,
    );
  assert.equal((await send(true, "https://www.iamthefold.com")).status, 400);
  assert.equal((await send(false, "https://www.iamthefold.com")).status, 403);
  assert.equal((await send(true, "https://unrelated.example")).status, 403);
});

test("analytics requests cannot use the application as an outbound proxy", async () => {
  const app = createApp({ ...options(), posthogKey: "public-project-key" });
  for (const path of [
    "/ingest/e/",
    "/ingest/static/script.js",
    "/ingest//other.example",
  ]) {
    assert.equal((await app.request(path)).status, 404);
    assert.equal(
      (
        await app.request(path, {
          method: "POST",
          headers: {
            origin: "https://foreign.example",
            "content-type": "text/plain",
          },
          body: "x".repeat(65536),
        })
      ).status,
      404,
    );
  }
});

test("page headers block embedding and constrain scripts without setting development HSTS", async () => {
  for (const production of [false, true]) {
    const response = await createApp({ ...options(), production }).request("/");
    assert.equal(response.headers.get("x-frame-options"), "DENY");
    assert.match(
      response.headers.get("content-security-policy")!,
      /frame-ancestors 'none'/,
    );
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(response.headers.has("strict-transport-security"), production);
  }
});

test("API request budgets reject before issuing challenges or accessing Redis", async () => {
  const app = createApp({ ...options(), trustFlyProxy: true, now: () => 0 });
  for (let i = 0; i < 12; i++)
    assert.equal(
      (await app.request("/api", { headers: { "fly-client-ip": "192.0.2.1" } }))
        .status,
      200,
    );
  const blocked = await app.request("/api", {
    headers: { "fly-client-ip": "192.0.2.1" },
  });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get("retry-after"), "10");
  assert.equal(blocked.headers.get("cache-control"), "no-store");
  assert.equal(
    (await app.request("/api", { headers: { "fly-client-ip": "192.0.2.2" } }))
      .status,
    200,
  );
  assert.equal((await app.request("/api")).status, 400);
  // The global budget also caps a burst from many distinct addresses.
  for (let i = 3; i < 50; i++)
    assert.equal(
      (
        await app.request("/api", {
          headers: { "fly-client-ip": `192.0.2.${i}` },
        })
      ).status,
      200,
    );
  assert.equal(
    (await app.request("/api", { headers: { "fly-client-ip": "192.0.2.200" } }))
      .status,
    429,
  );
});

test("a cold-cache failure retries only after the backoff", async () => {
  let now = 0;
  const config = options();
  config.db.getFoldSample.mock.mockImplementation(async () => {
    throw new Error("unavailable");
  });
  const app = createApp({ ...config, now: () => now });
  for (let i = 0; i < 20; i++) {
    const response = await app.request("/");
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "5");
  }
  assert.equal(config.db.getFoldSample.mock.callCount(), 1);
  now = 5000;
  config.db.getFoldSample.mock.mockImplementation(async () => [800]);
  assert.equal((await app.request("/")).status, 200);
  assert.equal(config.db.getFoldSample.mock.callCount(), 2);
});

test("built assets are served with immutable caching and no source files are exposed", async () => {
  const manifest: Assets = JSON.parse(
    await readFile("dist/assets.json", "utf8"),
  );
  const app = createApp({ ...options(), assets: manifest });
  for (const path of Object.values(manifest)) {
    const response = await app.request(path);
    assert.equal(response.status, 200, path);
    assert.equal(
      response.headers.get("cache-control"),
      "public, max-age=31536000, immutable",
    );
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  assert.equal(
    (await app.request("/assets/%2e%2e/%2e%2e/package.json")).status,
    404,
  );
});

test("foreign browser requests cannot spend a visitor's API allowance", async () => {
  const app = createApp({ ...options(), trustFlyProxy: true, now: () => 0 });
  for (let i = 0; i < 20; i++) {
    const response = await app.request("https://fold.example/api", {
      method: "POST",
      headers: {
        host: "fold.example",
        origin: "https://foreign.example",
        "fly-client-ip": "192.0.2.1",
        "sec-fetch-site": "cross-site",
        "content-type": "text/plain",
      },
      body: "{}",
    });
    assert.equal(response.status, 403);
  }
  assert.equal(
    (await app.request("/api", { headers: { "fly-client-ip": "192.0.2.1" } }))
      .status,
    200,
  );
});

test("the API concurrency cap releases slots after body parsing failures", async () => {
  const app = createApp({ ...options(), trustFlyProxy: true, now: () => 0 });
  const readers: ReadableStreamDefaultController<Uint8Array>[] = [];
  const pending = Array.from({ length: 32 }, (_, index) => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        readers.push(controller);
      },
    });
    return app.request(
      new Request("https://fold.example/api", {
        method: "POST",
        headers: {
          host: "fold.example",
          origin: "https://fold.example",
          "content-type": "application/json",
          "fly-client-ip": `192.0.2.${index + 1}`,
        },
        body,
        duplex: "half",
      } as RequestInit),
    );
  });
  try {
    await tick();
    assert.equal(
      (
        await app.request("/api", {
          headers: { "fly-client-ip": "192.0.2.200" },
        })
      ).status,
      429,
    );
  } finally {
    for (const reader of readers) {
      reader.enqueue(new TextEncoder().encode("{}"));
      reader.close();
    }
  }
  assert.ok(
    (await Promise.all(pending)).every((response) => response.status === 400),
  );
  assert.equal(
    (await app.request("/api", { headers: { "fly-client-ip": "192.0.2.201" } }))
      .status,
    200,
  );
});
