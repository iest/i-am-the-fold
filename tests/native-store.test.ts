import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer, type Socket, type AddressInfo } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { createNativeStore, nativeConnectionUrl } from "../server/store";
import { validateNativeRedisUrl, validateConfig } from "../server/config";
import { DB } from "../util-server";

test("native Redis requires TLS or a verified Fly private endpoint", async () => {
  const prod = { NODE_ENV: "production", FLY_APP_NAME: "i-am-the-fold" };
  for (const url of [
    "http://example.test",
    "redis://example.test",
    "redis://localhost",
    "redis://fly-db.upstash.io?tls=false",
  ])
    assert.throws(() => validateNativeRedisUrl(url, prod));
  assert.throws(() =>
    validateNativeRedisUrl("redis://fly-db.upstash.io", {
      NODE_ENV: "production",
    }),
  );
  assert.equal(
    validateNativeRedisUrl("rediss://example.test", prod).privateFly,
    false,
  );
  const env = {
    ...prod,
    REDIS_URL: "redis://default:fake@fly-db.upstash.io:6379",
  };
  await assert.rejects(
    nativeConnectionUrl(env, async () => ({ address: "2001:db8::1" })),
  );
  const url = new URL(
    await nativeConnectionUrl(env, async () => ({ address: "fdaa:1234::1" })),
  );
  assert.equal(url.hostname, "[fdaa:1234::1]");
  assert.equal(url.password, "fake");
  assert.equal(
    validateConfig({
      ...env,
      SECRET:
        "c20df06116c0412473fcf381625e391a379b28b04d8bc8d15fe2096526333a3a",
    }).port,
    3000,
  );
});

const hasRedis = spawnSync("redis-server", ["--version"]).status === 0;
if (process.env.REQUIRE_REDIS_TESTS === "1" && !hasRedis)
  throw new Error("Redis is required");
test(
  "native adapter reads integer counts and atomically saves concurrent submissions",
  { skip: !hasRedis, timeout: 10000 },
  async (t) => {
    const reservation = createServer();
    reservation.listen(0, "127.0.0.1");
    await once(reservation, "listening");
    const port = (reservation.address() as AddressInfo).port;
    await new Promise<void>((resolve) => reservation.close(() => resolve()));
    const process = spawn(
      "redis-server",
      [
        "--bind",
        "127.0.0.1",
        "--port",
        String(port),
        "--save",
        "",
        "--appendonly",
        "no",
      ],
      { stdio: ["ignore", "pipe", "ignore"] },
    );
    const store = createNativeStore({ REDIS_URL: `redis://127.0.0.1:${port}` });
    const other = createNativeStore({ REDIS_URL: `redis://127.0.0.1:${port}` });
    t.after(async () => {
      store.close?.();
      other.close?.();
      const stopped = once(process, "exit");
      process.kill();
      await stopped;
    });
    await new Promise<void>((resolve, reject) => {
      process.on("error", reject);
      process.stdout.on("data", (data) => {
        if (String(data).includes("Ready to accept connections")) resolve();
      });
    });
    globalThis.process.env.SECRET = "local-native-store-test-key";
    const databases = [new DB(store), new DB(other)];
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        databases[i % 2].addFold(800, "192.0.2.1", "native-challenge"),
      ),
    );
    assert.equal(results.filter((value) => value === "saved").length, 1);
    assert.deepEqual(await store.hgetall("folds"), { 800: 1 });
    await store.eval(
      "redis.call('HSET', KEYS[1], '801', 'invalid'); return 'ok'",
      ["folds"],
      [],
    );
    assert.deepEqual(await databases[0].getFoldSample(), [800]);
    assert.equal(await store.hgetall("missing"), null);
  },
);

test(
  "native Redis deadlines disconnect stalled commands",
  { timeout: 3000 },
  async (t) => {
    const sockets = new Set<Socket>();
    const server = createServer((socket) => {
      sockets.add(socket);
      socket.resume();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const store = createNativeStore(
      { REDIS_URL: `redis://127.0.0.1:${port}` },
      40,
    );
    t.after(() => {
      store.close?.();
      sockets.forEach((socket) => socket.destroy());
      server.close();
    });
    await assert.rejects(store.hgetall("folds"), /Redis operation failed/);
    await assert.rejects(
      store.eval("return 1", [], []),
      /Redis operation failed/,
    );
  },
);
