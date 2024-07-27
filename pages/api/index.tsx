import crypto from "crypto";
import { NextApiRequest, NextApiResponse } from "next";
import {
  createToken,
  DB,
  ResponseData,
  verifyFold,
  verifyToken,
  verifyWork,
} from "../../util";

const db = new DB();

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ResponseData | { message: string }>
) {
  if (req.method === "POST") {
    const {
      socket: { remoteAddress },
      body: { fold, token, workToken },
    } = req;

    if (!fold || !token || !workToken) {
      res.status(400).send({ message: "Missing parameters" });
      return;
    }

    // Make sure this IP hasn't already submitted a fold
    if (await db.checkIP(remoteAddress)) {
      console.log("Fold already saved", { remoteAddress });
      res.status(403).send({ message: "Fold already saved" });
      return;
    }

    // Verify the challenge was created by this server and hasn't expired
    const { expired, challenge, err } = await verifyToken(token);
    if (err || expired) {
      console.log("Bad token", { err, expired });
      res.status(403).send({ message: "Bad token" });
      return;
    }

    // Verify the challenge hasn't already been used
    if (await db.checkChallenge(challenge)) {
      console.log("Challenge reuse rejected", { challenge });
      res.status(403).send({ message: "Challenge reuse rejected" });
      return;
    }

    // Verify that the proof-of-work checks out
    if (!verifyWork(challenge, workToken)) {
      console.log("Challenge failed", { challenge });
      res.status(403).send({ message: "Challenge failed" });
      return;
    }

    // Cool! We have valid proof-of-work
    await db.useChallenge(challenge);

    // Check the submitted fold is actually valid
    if (verifyFold(fold)) {
      console.log("Invalid fold", { fold });
      res.status(400).send({ message: "Invalid fold" });
      return;
    }

    // Cool! We have a valid fold and we're done here
    db.addFold(fold, remoteAddress);
    res.status(200).send({ message: "Fold saved" });
    return;
  }

  const challenge = crypto.randomBytes(50).toString("base64");
  const folds = await db.getRandomUniqFolds();
  const max = folds.reduce((a, b) => Math.max(a, b), 0);
  const token = createToken(challenge);

  res.send({
    folds,
    max,
    challenge,
    token,
  });
}
