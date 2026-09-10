// Process-local budgets protect CPU and Redis without a network call per rejection.
// Every map has a hard size bound; Fly also caps concurrent requests per machine.
export function createRateLimiter(
  capacity: number,
  perMinute: number,
  maxKeys = 4096,
  now = Date.now,
) {
  const buckets = new Map<string, { tokens: number; at: number }>();
  return (key: string) => {
    const time = now();
    let bucket = buckets.get(key);
    if (!bucket) {
      if (buckets.size >= maxKeys) {
        for (const [id, value] of buckets) {
          if (time - value.at >= (capacity * 60000) / perMinute)
            buckets.delete(id);
        }
      }
      if (buckets.size >= maxKeys) return false;
      bucket = { tokens: capacity, at: time };
      buckets.set(key, bucket);
    }
    bucket.tokens = Math.min(
      capacity,
      bucket.tokens + (Math.max(0, time - bucket.at) * perMinute) / 60000,
    );
    bucket.at = time;
    if (bucket.tokens < 1) return false;
    bucket.tokens--;
    return true;
  };
}

export function createReplayCache(maxKeys = 2048, now = Date.now) {
  const used = new Map<string, number>();
  function has(key: string) {
    const expiry = used.get(key);
    if (expiry === undefined) return false;
    if (expiry <= now()) {
      used.delete(key);
      return false;
    }
    return true;
  }
  return {
    has,
    claim(key: string): "claimed" | "used" | "full" {
      if (has(key)) return "used";
      if (used.size >= maxKeys) {
        for (const [id, expiry] of used) if (expiry <= now()) used.delete(id);
      }
      if (used.size >= maxKeys) return "full";
      used.set(key, now() + 120000);
      return "claimed";
    },
  };
}
