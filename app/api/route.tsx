import crypto from "crypto";
import { headers } from "next/headers";
import { NextApiRequest, NextApiResponse } from "next";
import {
  createToken,
  DB,
  ResponseData,
  verifyFold,
  verifyToken,
  verifyWork,
} from "../../util";
import { NextRequest, NextResponse } from "next/server";

const db = new DB();

export async function POST(req: NextRequest) {
  const { fold, token, workToken } = await req.json();
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0] : req.ip;

  console.log(">>>>", { ip });

  if (!fold || !token || !workToken) {
    return NextResponse.json(
      { message: "Missing parameters" },
      { status: 400 }
    );
  }

  // Make sure this IP hasn't already submitted a fold
  if (await db.checkIP(ip)) {
    console.log("Fold already saved", { ip });
    return NextResponse.json(
      { message: "Fold already saved" },
      { status: 403 }
    );
  }

  // Verify the challenge was created by this server and hasn't expired
  const { expired, challenge, err } = await verifyToken(token);
  if (err || expired) {
    console.log("Bad token", { err, expired });
    return NextResponse.json({ message: "Bad token" }, { status: 403 });
  }

  // Verify the challenge hasn't already been used
  if (await db.checkChallenge(challenge)) {
    console.log("Challenge reuse rejected", { challenge });
    return NextResponse.json(
      { message: "Challenge reuse rejected" },
      { status: 403 }
    );
  }

  // Verify that the proof-of-work checks out
  if (!verifyWork(challenge, workToken)) {
    console.log("Challenge failed", { challenge });
    return NextResponse.json({ message: "Challenge failed" }, { status: 403 });
  }

  // Cool! We have valid proof-of-work
  await db.useChallenge(challenge);

  // Check the submitted fold is actually valid
  if (verifyFold(fold)) {
    console.log("Invalid fold", { fold });
    return NextResponse.json({ message: "Invalid fold" }, { status: 400 });
  }

  // Cool! We have a valid fold and we're done here
  db.addFold(fold, ip);
  return NextResponse.json({ message: "Fold saved" });
}
