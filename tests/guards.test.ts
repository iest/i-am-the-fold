import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRateLimiter, createReplayCache } from "../server/limits";
import { normalizeIP, rateLimitKey } from "../server/network";
import { BodyError, readJsonBody } from "../server/body";
import { validateConfig, validateRedisUrl } from "../server/config";
import {
  parseBackup,
  readBackup,
  writeBackup,
  restoreBackup,
  MAX_BACKUP_BYTES,
} from "../scripts/backup";

const fixture = () => ({
  version: "2.0.0",
  timestamp: new Date().toISOString(),
  data: { folds: { 800: 2 } },
});

test("rate-limit and replay maps stay bounded and recover after expiry", () => {
  let now = 0;
  const allow = createRateLimiter(2, 2, 2, () => now);
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), true);
  assert.equal(allow("a"), false);
  assert.equal(allow("b"), true);
  assert.equal(allow("c"), false);
  now = 60000;
  assert.equal(allow("c"), true);
  const cache = createReplayCache(1, () => now);
  assert.equal(cache.claim("a"), "claimed");
  assert.equal(cache.claim("a"), "used");
  assert.equal(cache.claim("b"), "full");
  now += 120000;
  assert.equal(cache.claim("b"), "claimed");
  assert.equal(cache.has("a"), false);
});

test("equivalent IP spellings and IPv6 privacy addresses share request budgets", () => {
  assert.equal(normalizeIP("::ffff:192.0.2.1"), "192.0.2.1");
  assert.equal(normalizeIP("2001:0db8:0000:0001:0:0:0:2"), "2001:db8:0:1::2");
  assert.equal(normalizeIP("spoofed"), undefined);
  assert.equal(normalizeIP("fe80::1%eth0"), undefined);
  assert.equal(
    rateLimitKey(normalizeIP("2001:db8:0:1::2")!),
    rateLimitKey(normalizeIP("2001:db8:0:1:abcd::3")!),
  );
  assert.notEqual(
    rateLimitKey("2001:db8:0:1::2"),
    rateLimitKey("2001:db8:0:2::2"),
  );
});

test("slow and oversized streams cannot hold rejection open through cancellation", async () => {
  const streaming = (stream: ReadableStream<Uint8Array>) =>
    new Request("https://example.test/api", {
      method: "POST",
      body: stream,
      duplex: "half",
    } as RequestInit);
  const stalled = new ReadableStream<Uint8Array>({
    cancel: () => new Promise(() => {}),
  });
  await assert.rejects(
    readJsonBody(streaming(stalled), 4096, 20),
    (error: unknown) => error instanceof BodyError && error.status === 408,
  );
  const large = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new Uint8Array(5000));
    },
    cancel: () => new Promise(() => {}),
  });
  await assert.rejects(
    readJsonBody(streaming(large), 4096, 20),
    (error: unknown) => error instanceof BodyError && error.status === 413,
  );
  assert.deepEqual(
    await readJsonBody(
      new Request("https://example.test", {
        method: "POST",
        body: '{"fold":800}',
      }),
    ),
    { fold: 800 },
  );
});

test("production rejects weak signing keys and insecure Redis configuration", () => {
  const env = {
    NODE_ENV: "production",
    SECRET: "b76abc62bdc78d059cf36c7b1fb5f5b957221bad836e4a781c2ed1a794f604e1",
    UPSTASH_REDIS_REST_URL: "https://redis.example.test",
    UPSTASH_REDIS_REST_TOKEN: "fake-token",
  };
  assert.equal(validateConfig(env).port, 3000);
  for (const secret of ["", "secret", "a".repeat(64), "test-secret".repeat(8)])
    assert.throws(() => validateConfig({ ...env, SECRET: secret }));
  for (const url of [
    "http://redis.example.test",
    "http://127.0.0.1",
    "https://user:pass@redis.example.test",
    "https://redis.example.test/?token=fake",
  ])
    assert.throws(() =>
      validateConfig({ ...env, UPSTASH_REDIS_REST_URL: url }),
    );
  assert.equal(
    validateRedisUrl("http://127.0.0.1:8079"),
    "http://127.0.0.1:8079",
  );
  assert.throws(() => validateRedisUrl("http://remote.example.test"));
  assert.throws(() => validateConfig({ ...env, PORT: "0" }));
});

test("backups contain only validated histogram data and never restore IP TTLs", async () => {
  const legacy = {
    ...fixture(),
    version: "1.0.0",
    data: { folds: { 800: 2 }, ips: [{ key: "ip:192.0.2.1", ttl: 1209600 }] },
  };
  const backup = parseBackup(legacy);
  assert.deepEqual(backup.data, { folds: { 800: 2 } });
  assert.equal(backup.version, "2.0.0");
  let called = false;
  const store = {
    eval: async () => {
      called = true;
    },
  } as any;
  for (const folds of [
    { 800: -1 },
    { "0800": 1 },
    { 7681: 2 },
    { 800: "2" },
    { 800: Number.MAX_SAFE_INTEGER + 1 },
    JSON.parse('{"__proto__":2}'),
  ]) {
    await assert.rejects(
      restoreBackup(store, { ...fixture(), data: { folds } }),
    );
  }
  assert.equal(called, false);
});

test("backup files are private, exclusive, bounded, and kept outside the repository", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fold-backup-"));
  try {
    const file = join(directory, "backup.json");
    await writeBackup(file, fixture());
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual((await readBackup(file)).data, fixture().data);
    const before = await readFile(file, "utf8");
    await assert.rejects(writeBackup(file, fixture()));
    assert.equal(await readFile(file, "utf8"), before);
    await assert.rejects(writeBackup(resolve("backup-test.json"), fixture()));
    await symlink(resolve("."), join(directory, "repo"));
    await assert.rejects(
      writeBackup(join(directory, "repo", "backup-test.json"), fixture()),
    );
    await writeFile(
      join(directory, "large.json"),
      "x".repeat(MAX_BACKUP_BYTES + 1),
    );
    await assert.rejects(
      readBackup(join(directory, "large.json")),
      /exceeds 1 MB/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
