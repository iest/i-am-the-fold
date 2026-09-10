export function validateRedisUrl(
  value: string | undefined,
  production = false,
) {
  if (!value) throw new Error("Set UPSTASH_REDIS_REST_URL");
  const url = new URL(value);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" && local && !production)
  ) {
    throw new Error(
      "Redis requires HTTPS (HTTP is only allowed for local development)",
    );
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "Use a Redis REST origin without embedded credentials, paths or query parameters",
    );
  }
  return url.origin;
}

export function validateConfig(env: NodeJS.ProcessEnv) {
  const production = env.NODE_ENV === "production";
  if (!env.SECRET) throw new Error("Set SECRET before starting the server");
  if (
    production &&
    (Buffer.byteLength(env.SECRET) < 32 ||
      new Set(env.SECRET).size < 8 ||
      /^(test|secret|change.?me|development|example)/i.test(env.SECRET))
  ) {
    throw new Error(
      "Production SECRET must be a strong random key of at least 32 bytes",
    );
  }
  validateRedisUrl(env.UPSTASH_REDIS_REST_URL, production);
  if (!env.UPSTASH_REDIS_REST_TOKEN)
    throw new Error("Set UPSTASH_REDIS_REST_TOKEN");
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("Invalid PORT");
  return { production, port };
}
