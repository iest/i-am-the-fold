import jwt, { JwtPayload } from "jsonwebtoken";
import { kv } from "@vercel/kv";

export const STRENGTH = 4;
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
    return await kv.set(`ip:${ip}`, 1, { ex: this.ipTTL });
  }
  async checkIP(ip: string) {
    return await kv.exists(`ip:${ip}`);
  }
  async storeFold(fold: number) {
    return await kv.hincrby("folds", fold.toString(), 1);
  }
  async getAllFolds() {
    const folds: Record<string, number> = await kv.hgetall("folds");
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

export const verifyFold = (fold: number) => {
  if (typeof fold !== "number") {
    return false;
  }
  const tallestScreen = 7680; // 8k screen

  return !fold || fold > tallestScreen || fold < 1;
};

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

async function sha256(message: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return hashHex;
}
async function findProof(
  challenge: string,
  difficulty: number
): Promise<string | null> {
  let proof = 0;
  const target = "0".repeat(difficulty);

  const timeoutPromise = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), 10000)
  );

  const proofPromise = (async () => {
    while (true) {
      const hash = await sha256(challenge + proof);
      if (hash.startsWith(target)) {
        return proof.toString();
      }
      proof++;
    }
  })();

  return Promise.race([proofPromise, timeoutPromise]);
}

async function verifyProofOfWork(
  challenge: string,
  proof: string,
  difficulty: number
): Promise<boolean> {
  const hash = await sha256(challenge + proof);
  return hash.startsWith("0".repeat(difficulty));
}

export const verifyWork = async (challenge: string, proof: string) =>
  verifyProofOfWork(challenge, proof, STRENGTH);
export const solveWork = async (challenge: string) =>
  findProof(challenge, STRENGTH);
