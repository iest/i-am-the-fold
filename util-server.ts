import jwt, { JwtPayload } from "jsonwebtoken";
import { Redis } from "@upstash/redis";
import { STRENGTH, verifyFold, verifyWork } from "./util-client";

export { STRENGTH, verifyFold, verifyWork };

const redis = Redis.fromEnv();
const SECRET = process.env.SECRET;

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
  challengeTTL = 2 * 60 * 1000; // 2 minutes in milliseconds
  ipTTL = 2 * 7 * 24 * 60 * 60; // 2 weeks in seconds
  challenges = new Set();
  FOLDS = "folds";

  async checkChallenge(challenge: string) {
    return this.challenges.has(challenge);
  }
  async useChallenge(challenge: string) {
    this.challenges.add(challenge);
    setTimeout(() => this.challenges.delete(challenge), this.challengeTTL);
  }

  async storeIP(ip: string) {
    return await redis.set(`ip:${ip}`, 1, { ex: this.ipTTL });
  }
  async checkIP(ip: string) {
    return await redis.exists(`ip:${ip}`);
  }
  async storeFold(fold: number) {
    return await redis.hincrby("folds", fold.toString(), 1);
  }
  async getAllFolds() {
    const folds: Record<string, number> = await redis.hgetall("folds");
    return folds;
  }

  async getFoldArray() {
    const foldData = await this.getAllFolds();

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

  async getFoldSample() {
    const SAMPLE_SIZE = 1000;
    const folds = await this.getFoldArray();
    const uniqFolds = new Set<number>();

    if (folds.length < SAMPLE_SIZE) {
      return folds;
    }

    while (uniqFolds.size < SAMPLE_SIZE) {
      const randomIndex = Math.floor(Math.random() * folds.length);
      uniqFolds.add(folds[randomIndex]);
    }

    return Array.from(uniqFolds);
  }

  async addFold(fold: number, ip: string) {
    await Promise.all([this.storeFold(fold), this.storeIP(ip)]);
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