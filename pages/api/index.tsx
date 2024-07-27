import { kv } from "@vercel/kv";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { NextApiRequest, NextApiResponse } from "next";
import work from "work-token/sync";
import { ResponseData } from "../../util";

const STRENGTH = 3;
const SECRET = crypto.randomBytes(16).toString("hex");

class DB {
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
const db = new DB();

const verifyToken = async (token: string) => {
  try {
    const { challenge, exp } = jwt.verify(token, SECRET) as {
      challenge: string;
      exp: number;
    };
    return { challenge, expired: Date.now() > exp };
  } catch (err) {
    return { err, expired: true };
  }
};

const verifyFold = (foldStr: string) => {
  const tallestScreen = 7680; // 8k screen
  const fold = Number(foldStr);
  return !foldStr || !fold || fold > tallestScreen || fold < 1;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData | { message: string }>
) {
  if (req.method === "POST") {
    const {
      socket: { remoteAddress },
      body: { fold, token, workToken },
    } = req;

    // Make sure this IP hasn't already submitted a fold
    if (await db.checkIP(remoteAddress)) {
      res.status(403).send({ message: "Fold already saved" });
      return;
    }

    // Verify the challenge was created by this server and hasn't expired
    const { expired, challenge, err } = await verifyToken(token);
    if (err || expired) {
      res.status(403).send({ message: "Bad token" });
      return;
    }

    // Verify the challenge hasn't already been used
    if (await db.checkChallenge(challenge)) {
      res.status(403).send({ message: "Challenge reuse rejected" });
      return;
    }

    // Verify that the proof-of-work checks out
    if (!work.check(challenge, STRENGTH, workToken)) {
      res.status(403).send({ message: "Challenge failed" });
      return;
    }

    // Cool! We have valid proof-of-work
    await db.useChallenge(challenge);

    // Check the submitted fold is actually valid
    if (!verifyFold(fold)) {
      res.status(400).send({ message: "Invalid fold" });
      return;
    }

    // Cool! We have a valid fold and we're done here
    db.addFold(fold, remoteAddress);
    res.status(200).send({ message: "Fold saved" });
    return;
  }

  // Generate a challenge for the client to work on
  const challenge = crypto.randomBytes(50).toString("base64");

  const folds = await db.getRandomUniqFolds();
  const max = folds.reduce((a, b) => Math.max(a, b), 0);

  const token = jwt.sign({ challenge }, SECRET, { expiresIn: "2m" });

  res.send({
    folds,
    max,
    challenge,
    token,
  });
}
