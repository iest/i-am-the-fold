import assert from "node:assert/strict";
import { before, beforeEach, after, mock, test } from "node:test";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Redis } from "@upstash/redis";
import IORedis from "ioredis";
import jwt from "jsonwebtoken";
import { isValidFold } from "../util-client";

const secret = "local-security-test-secret";
const challenge = "local-security-test-challenge";
const fakeStore = {
  hgetall: async () => null,
  eval: mock.fn(async () => "saved"),
};
let DB: typeof import("../util-server").DB;
let POST: ReturnType<typeof import("../server/api").createApi>["POST"];
let GET: ReturnType<typeof import("../server/api").createApi>["GET"];
let createToken: typeof import("../util-server").createToken;
let proof: string;

before(async () => {
  const previousSecret = process.env.SECRET;
  process.env.SECRET = secret;
  mock.method(Redis, "fromEnv", () => fakeStore);
  ({ DB, createToken } = await import("../util-server"));
  const { createApi } = await import("../server/api");
  ({ POST, GET } = createApi(new DB()));
  if (previousSecret === undefined) delete process.env.SECRET;
  else process.env.SECRET = previousSecret;
  for (let n = 0; ; n++) {
    if (createHash("sha256").update(challenge + n).digest("hex").startsWith("0000")) {
      proof = String(n);
      break;
    }
  }
});

beforeEach(() => {
  fakeStore.eval.mock.resetCalls();
  fakeStore.eval.mock.mockImplementation(async () => "saved");
});
after(() => mock.restoreAll());

function request(body: unknown, headers: Record<string, string> = {}, url = "https://www.iamthefold.com/api") {
  return new Request(url, {
    method: "POST",
    headers: {
      host: "www.iamthefold.com",
      origin: "https://www.iamthefold.com",
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "fly-client-ip": "192.0.2.1",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
function submission(overrides: Record<string, unknown> = {}) {
  return { fold: 800, token: createToken(challenge), proof, ...overrides };
}
function sampleDB(data: Record<string, unknown> | null) {
  return new DB({
    hgetall: (async () => data) as Redis["hgetall"],
    eval: async () => { throw new Error("Sampling must not write"); },
  });
}

test("height validation accepts only integers within the viewport bounds", () => {
  for (const value of [1, 800, 7680]) assert.equal(isValidFold(value), true);
  for (const value of [0, -1, 7681, 800.5, NaN, Infinity, "800", true, {}, [], null, undefined]) {
    assert.equal(isValidFold(value), false, String(value));
  }
});

test("invalid submissions are rejected before token validation or database writes", async () => {
  for (const fold of [0, 7681, 800.5, "1000000000", "not-a-height", true, {}, [], null]) {
    const response = await POST(request({ fold, token: "invalid", proof: "1" }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).message, "Invalid fold");
  }
  for (const body of [null, [], "bad", 123]) assert.equal((await POST(request(body))).status, 400);
  assert.equal(fakeStore.eval.mock.callCount(), 0);
});

test("token and proof types and lengths are bounded", async () => {
  for (const fields of [{ token: {} }, { token: "x".repeat(1025) }, { proof: 1 }, { proof: {} }, { proof: "x" }, { proof: "1".repeat(17) }]) {
    assert.equal((await POST(request(submission(fields)))).status, 400);
  }
  assert.equal(fakeStore.eval.mock.callCount(), 0);
});

test("foreign, absent, null and wrong-scheme origins are rejected", async () => {
  for (const origin of ["https://unrelated.example", "", "null", "http://www.iamthefold.com", "https://www.iamthefold.com.evil.example"]) {
    assert.equal((await POST(request(submission(), { origin }))).status, 403);
  }
  const absent = request(submission());
  absent.headers.delete("origin");
  assert.equal((await POST(absent)).status, 403);
  assert.equal((await POST(request(submission(), { "sec-fetch-site": "cross-site" }))).status, 403);
  assert.equal(fakeStore.eval.mock.callCount(), 0);
});

test("same-origin JSON works behind Fly's internal bind address and on localhost", async () => {
  assert.equal((await POST(request(submission(), {}, "https://0.0.0.0:3000/api"))).status, 200);
  assert.equal((await POST(request(submission(), { host: "localhost:3000", origin: "http://localhost:3000" }, "http://localhost:3000/api"))).status, 200);
});

test("text/plain and missing content types are rejected; JSON charset is allowed", async () => {
  for (const type of ["text/plain", "", "application/x-www-form-urlencoded"]) {
    assert.equal((await POST(request(submission(), { "content-type": type }))).status, 415);
  }
  assert.equal(fakeStore.eval.mock.callCount(), 0);
  assert.equal((await POST(request(submission(), { "content-type": "application/json; charset=utf-8" }))).status, 200);
});

test("malformed JSON and oversized bodies are rejected", async () => {
  const malformed = request({});
  const bad = new Request(malformed.url, { method: "POST", headers: malformed.headers, body: "{" });
  assert.equal((await POST(bad)).status, 400);
  assert.equal((await POST(request({ padding: "x".repeat(4096) }))).status, 413);
  assert.equal((await POST(request({}, { "content-length": "5000" }))).status, 413);
  assert.equal((await POST(request({ padding: "é".repeat(2100) }, { "content-length": "1" }))).status, 413);
  assert.equal(fakeStore.eval.mock.callCount(), 0);
});

test("bad signatures, expired tokens, unexpected algorithms and invalid proofs cannot save", async () => {
  for (const token of [
    jwt.sign({ challenge }, "wrong-secret", { expiresIn: "2m" }),
    jwt.sign({ challenge }, secret, { expiresIn: -1 }),
    jwt.sign({ challenge }, secret, { algorithm: "HS384", expiresIn: "2m" }),
    jwt.sign({ challenge: {} }, secret, { expiresIn: "2m" }),
  ]) assert.equal((await POST(request(submission({ token })))).status, 403);
  let badProof = "0";
  while (createHash("sha256").update(challenge + badProof).digest("hex").startsWith("0000")) badProof = String(Number(badProof) + 1);
  assert.equal((await POST(request(submission({ proof: badProof })))).status, 403);
  assert.equal(fakeStore.eval.mock.callCount(), 0);
});

test("challenge responses are fresh and not cacheable", async () => {
  const first = await GET();
  const second = await GET();
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.notEqual((await first.json()).challenge, (await second.json()).challenge);
});

test("save response waits for Redis; duplicates and failures are reported", async () => {
  let release!: (value: string) => void;
  let entered: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  fakeStore.eval.mock.mockImplementation(() => {
    entered();
    return new Promise<string>(resolve => { release = resolve; });
  });
  let resolved = false;
  const response = POST(request(submission())).then(result => { resolved = true; return result; });
  await started;
  assert.equal(resolved, false);
  release("saved");
  assert.equal((await response).status, 200);
  for (const result of ["challenge_used", "ip_used"]) {
    fakeStore.eval.mock.mockImplementation(async () => result);
    assert.equal((await POST(request(submission()))).status, 403);
  }
  const log = mock.method(console, "error", () => {});
  try {
    fakeStore.eval.mock.mockImplementation(async () => { throw new Error("Redis unavailable"); });
    assert.equal((await POST(request(submission()))).status, 503);
  } finally { log.mock.restore(); }
});

test("sampling handles empty data, few distinct heights and huge counts", async () => {
  assert.deepEqual(await sampleDB(null).getFoldSample(), []);
  assert.deepEqual(await sampleDB({ 800: 2, 900: 1 }).getFoldSample(), [800, 800, 900]);
  assert.deepEqual(await sampleDB({ 800: 1000 }).getFoldSample(), [800]);
  assert.deepEqual(await sampleDB({ 800: Number.MAX_SAFE_INTEGER }).getFoldSample(), [800]);
  const data = Object.fromEntries(Array.from({ length: 1500 }, (_, i) => [String(i + 1), 2]));
  const sample = await sampleDB(data).getFoldSample();
  assert.equal(sample.length, 1000);
  assert.equal(new Set(sample).size, 1000);
  assert.ok(sample.every(isValidFold));
});

test("sampling filters corrupt historical heights and counts", async () => {
  assert.deepEqual(await sampleDB({
    800: 2, "not-a-height": 10, "1e3": 1, "0800": 1, "800.5": 1,
    0: 1, 7681: 1, 900: -1, 901: 0, 902: 1.5, 903: "2", 904: null,
    905: Number.MAX_SAFE_INTEGER + 1, 906: Infinity,
  }).getFoldSample(), [800, 800]);
});

const hasRedis = spawnSync("redis-server", ["--version"]).status === 0;
test("real Redis atomically deduplicates concurrent writes across DB instances", { skip: !hasRedis, timeout: 10000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "fold-"));
  const socket = join(directory, "redis.sock");
  const server = spawn("redis-server", ["--port", "0", "--unixsocket", socket, "--unixsocketperm", "700", "--save", "", "--appendonly", "no", "--dir", directory], { stdio: "ignore" });
  const client = new IORedis({ path: socket, retryStrategy: () => 50, maxRetriesPerRequest: 20 });
  client.on("error", () => {});
  t.after(async () => {
    client.disconnect();
    const exited = once(server, "exit");
    server.kill();
    await exited;
    await rm(directory, { recursive: true, force: true });
  });
  await client.ping();
  const store = {
    eval: (script: string, keys: string[], args: string[]) => client.eval(script, keys.length, ...keys, ...args),
    hgetall: () => { throw new Error("Not used"); },
  } as ConstructorParameters<typeof DB>[0];
  const results = await Promise.all(Array.from({ length: 20 }, () => new DB(store).addFold(800, "192.0.2.1", "one-challenge")));
  assert.equal(results.filter(result => result === "saved").length, 1);
  assert.equal(await client.hget("folds", "800"), "1");
  assert.equal(await new DB(store).addFold(800, "192.0.2.2", "one-challenge"), "challenge_used");
  assert.equal(await new DB(store).addFold(800, "192.0.2.1", "another-challenge"), "ip_used");
  assert.equal(await client.exists("challenge:another-challenge"), 0);
  const ipRace = await Promise.all(Array.from({ length: 20 }, (_, i) => new DB(store).addFold(900, "192.0.2.3", `unique-${i}`)));
  assert.equal(ipRace.filter(result => result === "saved").length, 1);
  assert.equal(await client.hget("folds", "900"), "1");
  const challengeRace = await Promise.all(Array.from({ length: 20 }, (_, i) => new DB(store).addFold(1000, `198.51.100.${i + 1}`, "shared-challenge")));
  assert.equal(challengeRace.filter(result => result === "saved").length, 1);
  assert.equal(await client.hget("folds", "1000"), "1");
  await client.hset("folds", "1100", "corrupt-count");
  await assert.rejects(new DB(store).addFold(1100, "203.0.113.1", "failed-write"));
  assert.equal(await client.exists("challenge:failed-write", "ip:203.0.113.1"), 0);
  assert.ok(await client.ttl("challenge:one-challenge") > 0);
  assert.ok(await client.ttl("challenge:one-challenge") <= 120);
  assert.ok(await client.ttl("ip:192.0.2.1") > 120);
  assert.ok(await client.ttl("ip:192.0.2.1") <= 1209600);
});
