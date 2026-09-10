import {
  createToken,
  DB,
  isValidFold,
  verifyToken,
  verifyWork,
} from "../../util-server";
import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

const db = new DB();
const MAX_BODY_BYTES = 4096;

class PayloadTooLargeError extends Error {}

function isSameOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  if (!origin || !host) return false;
  if (
    req.headers.has("sec-fetch-site") &&
    req.headers.get("sec-fetch-site") !== "same-origin"
  ) {
    return false;
  }

  try {
    // Next derives the protocol from Fly's forwarded HTTPS metadata. Use Host
    // because req.nextUrl may contain Next's internal bind address (0.0.0.0).
    return origin === new URL(`${req.nextUrl.protocol}//${host}`).origin;
  } catch {
    return false;
  }
}

async function readBody(req: NextRequest): Promise<unknown> {
  if (Number(req.headers.get("content-length")) > MAX_BODY_BYTES) {
    throw new PayloadTooLargeError();
  }
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Missing body");
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new PayloadTooLargeError();
      }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

export async function GET() {
  const challenge = crypto.randomBytes(50).toString("base64");
  const token = createToken(challenge);
  return NextResponse.json(
    { token, challenge },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) {
    return NextResponse.json({ message: "Invalid origin" }, { status: 403 });
  }
  const contentType = req.headers
    .get("content-type")?.split(";")[0].trim().toLowerCase();
  if (contentType !== "application/json") {
    return NextResponse.json({ message: "Expected application/json" }, { status: 415 });
  }

  let body: unknown;
  try {
    body = await readBody(req);
  } catch (error) {
    return NextResponse.json(
      {
        message: error instanceof PayloadTooLargeError ? "Request too large" : "Invalid JSON",
      },
      { status: error instanceof PayloadTooLargeError ? 413 : 400 },
    );
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ message: "Invalid submission" }, { status: 400 });
  }
  const { fold, token, proof } = body as Record<string, unknown>;
  if (!isValidFold(fold)) {
    return NextResponse.json({ message: "Invalid fold" }, { status: 400 });
  }
  if (
    typeof token !== "string" || !token || token.length > 1024 ||
    typeof proof !== "string" || !/^\d{1,16}$/.test(proof)
  ) {
    return NextResponse.json({ message: "Invalid token or proof" }, { status: 400 });
  }

  const { expired, challenge, err } = await verifyToken(token);
  if (err || expired) {
    return NextResponse.json({ message: "Bad token" }, { status: 403 });
  }
  if (!(await verifyWork(challenge, proof))) {
    return NextResponse.json({ message: "Challenge failed" }, { status: 403 });
  }

  const flyClientIp = req.headers.get("fly-client-ip");
  const forwarded = req.headers.get("x-forwarded-for");
  const ip = flyClientIp ||
    (forwarded ? forwarded.split(",")[0].trim() : req.ip) || "unknown";
  try {
    const result = await db.addFold(fold, ip, challenge);
    if (result !== "saved") {
      return NextResponse.json(
        {
          message: result === "challenge_used" ? "Challenge reuse rejected" : "Fold already saved",
        },
        { status: 403 },
      );
    }
    return NextResponse.json({ message: "Fold saved" });
  } catch (error) {
    console.error("Error saving fold", error);
    return NextResponse.json({ message: "Unable to save fold" }, { status: 503 });
  }
}
