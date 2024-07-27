import jwt, { JwtPayload } from "jsonwebtoken";
import crypto from "crypto";
import { kv } from "@vercel/kv";
import work from "work-token/sync";

export const STRENGTH = 3;
export const SECRET = crypto.randomBytes(16).toString("hex");

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
  challengeTTL = 2 * 60 * 1000;
  challenges = new Set();

  USED_IPS = "used_ips";
  FOLDS = "folds";

  async checkChallenge(challenge: string) {
    return this.challenges.has(challenge);
  }
  async useChallenge(challenge: string) {
    this.challenges.add(challenge);
    setTimeout(() => this.challenges.delete(challenge), this.challengeTTL);
  }

  async checkIP(ip: string) {
    return await kv.sismember(this.USED_IPS, ip);
  }

  async getFolds() {
    const foldData: Record<string, number> = await kv.hgetall(this.FOLDS);

    if (!foldData) {
      return [];
    }

    const folds: number[] = [];

    for (const [key, value] of Object.entries(foldData)) {
      for (let i = 0; i < value; i++) {
        folds.push(Number(key));
      }
    }
    return folds;
  }
  async getRandomUniqFolds() {
    const SAMPLE_SIZE = 1000;
    const folds = await this.getFolds();
    const uniqFolds = new Set<number>();

    if (folds.length < SAMPLE_SIZE) {
      return folds;
    }

    while (uniqFolds.size < SAMPLE_SIZE) {
      uniqFolds.add(folds[Math.floor(Math.random() * folds.length)]);
    }

    return Array.from(uniqFolds);
  }

  async addFold(fold: number, ip: string) {
    await kv.hincrby(this.FOLDS, fold.toString(), 1);
    await kv.sadd(this.USED_IPS, ip);
  }
}

export const verifyToken = async (token: string) => {
  try {
    const { challenge, exp } = jwt.verify(token, SECRET) as FoldJWT;
    return { challenge, expired: Date.now() > exp * 1000 };
  } catch (err) {
    return { err, expired: true };
  }
};

export const createToken = (challenge: string) => {
  return jwt.sign({ challenge }, SECRET, { expiresIn: "2m" });
};

export const verifyFold = (fold: number) => {
  if (typeof fold !== "number") {
    return false;
  }
  const tallestScreen = 7680; // 8k screen
  console.log({
    fold,
    [`!fold`]: !fold,
    [`fold > tallestScreen`]: fold > tallestScreen,
    [`fold < 1`]: fold < 1,
  });

  return !fold || fold > tallestScreen || fold < 1;
};

export const verifyWork = (challenge: string, workToken: string) => {
  return work.check(challenge, STRENGTH, workToken);
};
