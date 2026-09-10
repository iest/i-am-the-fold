import jwt, { JwtPayload } from "jsonwebtoken";
import { Redis } from "@upstash/redis";
import { STRENGTH, isValidFold, verifyWork } from "./util-client";

export { STRENGTH, isValidFold, verifyWork };

const SECRET = process.env.SECRET;

function getSecret() {
  if (!SECRET) throw new Error("Set SECRET before using the submission API");
  return SECRET;
}

type FoldStore = Pick<Redis, "hgetall" | "eval">;
type SaveResult = "saved" | "challenge_used" | "ip_used";

// Redis executes the checks and writes together, across all application instances.
const SAVE_FOLD = `
  if redis.call("EXISTS", KEYS[1]) == 1 then
    return "challenge_used"
  end
  if redis.call("EXISTS", KEYS[2]) == 1 then
    return "ip_used"
  end
  redis.call("HINCRBY", KEYS[3], ARGV[1], 1)
  redis.call("SET", KEYS[1], 1, "EX", ARGV[2])
  redis.call("SET", KEYS[2], 1, "EX", ARGV[3])
  return "saved"
`;

export type ResponseData = {
  folds: number[];
  max: number;
  challenge: string;
  token: string;
};

interface FoldJWT extends JwtPayload {
  challenge: string;
  exp: number;
}

export class DB {
  challengeTTL = 2 * 60; // At least the remaining JWT lifetime, in seconds
  ipTTL = 2 * 7 * 24 * 60 * 60; // 2 weeks in seconds

  constructor(private readonly redis: FoldStore = Redis.fromEnv()) {}

  async getFoldSample() {
    const SAMPLE_SIZE = 1000;
    const stored = await this.redis.hgetall<Record<string, unknown>>("folds");
    const entries = Object.entries(stored || {}).flatMap(([key, count]) => {
      const fold = Number(key);
      if (
        !isValidFold(fold) || String(fold) !== key ||
        typeof count !== "number" || !Number.isSafeInteger(count) || count < 1
      ) {
        return [];
      }
      return [{ fold, count }];
    });

    const total = entries.reduce((sum, { count }) => sum + count, 0);
    if (total < SAMPLE_SIZE) {
      return entries.flatMap(({ fold, count }) => Array<number>(count).fill(fold));
    }

    // An exponential race preserves count-weighted sampling without replacement,
    // while doing bounded work even with few distinct heights or huge counts.
    return entries
      .map(({ fold, count }) => ({
        fold,
        rank: -Math.log(1 - Math.random()) / count,
      }))
      .sort((a, b) => a.rank - b.rank)
      .slice(0, SAMPLE_SIZE)
      .map(({ fold }) => fold);
  }

  async addFold(fold: number, ip: string, challenge: string): Promise<SaveResult> {
    if (!isValidFold(fold)) throw new Error("Invalid fold");
    return this.redis.eval<string[], SaveResult>(
      SAVE_FOLD,
      [`challenge:${challenge}`, `ip:${ip}`, "folds"],
      [String(fold), String(this.challengeTTL), String(this.ipTTL)],
    );
  }
}

export const verifyToken = async (token: string) => {
  try {
    const { challenge, exp } = jwt.verify(token, getSecret(), {
      algorithms: ["HS256"],
    }) as FoldJWT;
    if (
      typeof challenge !== "string" || !challenge || challenge.length > 128 ||
      !Number.isFinite(exp)
    ) {
      throw new Error("Invalid token payload");
    }
    return { challenge, expired: Date.now() > exp * 1000 };
  } catch (err) {
    return { err, expired: true };
  }
};

export const createToken = (challenge: string) => {
  return jwt.sign({ challenge }, getSecret(), { expiresIn: "2m" });
};
