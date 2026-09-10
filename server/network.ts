import { isIP } from "node:net";

export function normalizeIP(address: string | undefined): string | undefined {
  if (!address || address.includes("%") || !isIP(address)) return undefined;
  if (isIP(address) === 4) return address;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]+):([a-f0-9]+)$/.exec(canonical);
  if (mapped) {
    const high = parseInt(mapped[1], 16),
      low = parseInt(mapped[2], 16);
    return [high >> 8, high & 255, low >> 8, low & 255].join(".");
  }
  return canonical;
}

// Group IPv6 privacy addresses for short request budgets, not the two-week lock.
export function rateLimitKey(address: string) {
  if (isIP(address) !== 6) return address;
  const [left, right] = address.split("::");
  const start = left ? left.split(":") : [];
  const end = right ? right.split(":") : [];
  const parts =
    right === undefined
      ? start
      : [...start, ...Array(8 - start.length - end.length).fill("0"), ...end];
  return (
    parts
      .slice(0, 4)
      .map((part) => part.padStart(4, "0"))
      .join(":") + "::/64"
  );
}
