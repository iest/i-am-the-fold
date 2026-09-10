import { Redis } from "@upstash/redis";
import IORedis from "ioredis";
import { lookup } from "node:dns/promises";
import { validateNativeRedisUrl } from "./config";

export type FoldStore = Pick<Redis, "hgetall" | "eval"> & {
  close?: () => void;
};

export async function nativeConnectionUrl(
  env: NodeJS.ProcessEnv,
  resolve: (
    hostname: string,
    options: { family: 6 },
  ) => Promise<{ address: string }> = lookup,
) {
  const { url, privateFly } = validateNativeRedisUrl(env.REDIS_URL!, env);
  if (privateFly) {
    const { address } = await resolve(url.hostname, { family: 6 });
    if (!address.toLowerCase().startsWith("fdaa:"))
      throw new Error("Fly Redis did not resolve to its private network");
    // Connect to the checked private address, preventing a second DNS lookup.
    url.hostname = `[${address}]`;
  }
  return url.toString();
}

export function createNativeStore(
  env: NodeJS.ProcessEnv,
  timeoutMs = 5000,
): FoldStore {
  validateNativeRedisUrl(env.REDIS_URL!, env);
  let client: IORedis | undefined;
  let connecting: Promise<IORedis> | undefined;
  let generation = 0;
  const close = () => {
    generation++;
    client?.disconnect();
    client = undefined;
    connecting = undefined;
  };
  const connect = () => {
    if (client?.status === "ready") return Promise.resolve(client);
    if (connecting) return connecting;
    const current = generation;
    connecting = (async () => {
      const url = await nativeConnectionUrl(env);
      if (current !== generation) throw new Error("Redis operation expired");
      const connection = new IORedis(url, {
        lazyConnect: true,
        enableOfflineQueue: false,
        enableReadyCheck: false,
        connectTimeout: timeoutMs,
        commandTimeout: timeoutMs,
        maxRetriesPerRequest: 0,
        retryStrategy: () => null,
        autoResendUnfulfilledCommands: false,
      });
      connection.on("error", () => {}); // Never log credential-bearing SDK errors.
      client = connection;
      await connection.connect();
      if (current !== generation) throw new Error("Redis operation expired");
      return connection;
    })().finally(() => {
      if (current === generation) connecting = undefined;
    });
    return connecting;
  };
  async function execute<T>(
    run: (connection: IORedis) => Promise<T>,
  ): Promise<T> {
    let expired = false;
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        expired = true;
        close();
        reject(new Error("Redis operation timed out"));
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        connect().then((connection) => {
          if (expired) throw new Error("Redis operation expired");
          return run(connection);
        }),
        timeout,
      ]);
    } catch {
      close();
      throw new Error("Redis operation failed");
    } finally {
      clearTimeout(timer!);
    }
  }
  return {
    close,
    hgetall: async <T>(key: string): Promise<T | null> => {
      const values = await execute((connection) => connection.hgetall(key));
      if (!Object.keys(values).length) return null;
      // Match the REST client's integer decoding; retain invalid values for validation.
      return Object.fromEntries(
        Object.entries(values).map(([key, value]) => {
          const number = Number(value);
          return [
            key,
            Number.isSafeInteger(number) && String(number) === value
              ? number
              : value,
          ];
        }),
      ) as T;
    },
    eval: async <TArgs extends unknown[], TResult>(
      script: string,
      keys: string[],
      args: TArgs,
    ): Promise<TResult> =>
      execute((connection) =>
        connection.eval(script, keys.length, ...keys, ...args.map(String)),
      ) as Promise<TResult>,
  };
}

export function createFoldStore(): FoldStore {
  return process.env.REDIS_URL
    ? createNativeStore(process.env)
    : Redis.fromEnv({
        signal: () => AbortSignal.timeout(5000),
        retry: { retries: 0 },
      });
}
