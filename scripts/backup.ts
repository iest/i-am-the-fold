import { Redis } from "@upstash/redis";
import { randomBytes } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { dirname, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { validateRedisUrl } from "../server/config";
import { isValidFold } from "../util-client";
import { createNativeStore, type FoldStore } from "../server/store";

export const MAX_BACKUP_BYTES = 1024 * 1024;
export interface Backup {
  version: "2.0.0";
  timestamp: string;
  data: { folds: Record<string, number> };
}
export class BackupError extends Error {}
const record = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function parseBackup(value: unknown, now = Date.now()): Backup {
  if (
    !record(value) ||
    !["1.0.0", "2.0.0"].includes(String(value.version)) ||
    typeof value.timestamp !== "string" ||
    !Number.isFinite(Date.parse(value.timestamp)) ||
    Date.parse(value.timestamp) > now + 300000 ||
    !record(value.data) ||
    !record(value.data.folds)
  ) {
    throw new BackupError("Invalid backup format or timestamp");
  }
  const entries = Object.entries(value.data.folds);
  if (entries.length > 7680) throw new BackupError("Too many fold heights");
  for (const [height, count] of entries) {
    const fold = Number(height);
    if (
      !isValidFold(fold) ||
      String(fold) !== height ||
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 1
    ) {
      throw new BackupError("Backup contains invalid heights or counts");
    }
  }
  // Legacy IP records are intentionally discarded. Existing locks keep their TTLs.
  return {
    version: "2.0.0",
    timestamp: value.timestamp,
    data: { folds: Object.fromEntries(entries) as Record<string, number> },
  };
}

export function backupRedis(env: NodeJS.ProcessEnv = process.env): FoldStore {
  if (env.REDIS_URL) return createNativeStore(env, 10000);
  const url = validateRedisUrl(
    env.UPSTASH_REDIS_REST_URL,
    env.NODE_ENV === "production",
  );
  if (!env.UPSTASH_REDIS_REST_TOKEN)
    throw new BackupError("Set UPSTASH_REDIS_REST_TOKEN in the environment");
  return new Redis({
    url,
    token: env.UPSTASH_REDIS_REST_TOKEN,
    signal: () => AbortSignal.timeout(10000),
    retry: { retries: 0 },
  });
}

export async function readBackup(path: string) {
  const file = await open(path, "r");
  try {
    const buffer = Buffer.alloc(MAX_BACKUP_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_BACKUP_BYTES) throw new BackupError("Backup exceeds 1 MB");
    return parseBackup(JSON.parse(buffer.subarray(0, size).toString("utf8")));
  } finally {
    await file.close();
  }
}

export async function writeBackup(path: string, value: unknown) {
  const backup = parseBackup(value);
  const project = await realpath(
    fileURLToPath(new URL("../", import.meta.url)),
  );
  const directory = await realpath(dirname(resolve(path)));
  const within = relative(project, directory);
  if (
    within === "" ||
    (within !== ".." && !within.startsWith("../") && !isAbsolute(within))
  ) {
    throw new BackupError("Save backups outside the project directory");
  }
  const data = JSON.stringify(backup, null, 2) + "\n";
  if (Buffer.byteLength(data) > MAX_BACKUP_BYTES)
    throw new BackupError("Backup exceeds 1 MB");
  // Exclusive create prevents following/overwriting an existing file or symlink.
  const file = await open(path, "wx", 0o600);
  try {
    await file.writeFile(data);
  } finally {
    await file.close();
  }
}

export const RESTORE_FOLDS = `
  if redis.call('EXISTS', KEYS[1]) ~= 0 then return redis.error_reply('Staging key already exists') end
  if #ARGV == 0 then
    redis.call('DEL', KEYS[2])
    return 0
  end
  for i = 1, #ARGV, 256 do
    local chunk = {}
    for j = i, math.min(i + 255, #ARGV) do chunk[#chunk + 1] = ARGV[j] end
    redis.call('HSET', KEYS[1], unpack(chunk))
    if i == 1 then redis.call('EXPIRE', KEYS[1], 60) end
  end
  redis.call('RENAME', KEYS[1], KEYS[2])
  redis.call('PERSIST', KEYS[2])
  return #ARGV / 2
`;

export async function restoreBackup(
  redis: Pick<Redis, "eval">,
  value: unknown,
) {
  const backup = parseBackup(value);
  const args = Object.entries(backup.data.folds).flatMap(([key, value]) => [
    key,
    String(value),
  ]);
  // Stage a complete validated histogram, then atomically replace only folds.
  return redis.eval(
    RESTORE_FOLDS,
    [`restore:${randomBytes(16).toString("hex")}`, "folds"],
    args,
  );
}
