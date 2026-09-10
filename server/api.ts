import {
  createToken,
  DB,
  isValidFold,
  verifyToken,
  verifyWork,
} from "../util-server";
import crypto from "crypto";
import { BodyError, readJsonBody } from "./body";
import { createReplayCache } from "./limits";

export function isSameOrigin(req: Request, protocol: string) {
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
    return origin === new URL(`${protocol}//${host}`).origin;
  } catch {
    return false;
  }
}

export function createApi(db: Pick<DB, "addFold">, now = Date.now) {
  const replay = createReplayCache(2048, now);
  const reused = () =>
    Response.json({ message: "Challenge reuse rejected" }, { status: 403 });
  async function GET() {
    const challenge = crypto.randomBytes(50).toString("base64");
    const token = createToken(challenge);
    return Response.json(
      { token, challenge },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  async function POST(
    req: Request,
    info: { ip?: string; protocol?: string } = {},
  ) {
    if (!isSameOrigin(req, info.protocol || new URL(req.url).protocol)) {
      return Response.json({ message: "Invalid origin" }, { status: 403 });
    }
    const contentType = req.headers
      .get("content-type")
      ?.split(";")[0]
      .trim()
      .toLowerCase();
    if (contentType !== "application/json") {
      return Response.json(
        { message: "Expected application/json" },
        { status: 415 },
      );
    }

    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch (error) {
      return Response.json(
        {
          message: error instanceof BodyError ? error.message : "Invalid JSON",
        },
        { status: error instanceof BodyError ? error.status : 400 },
      );
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return Response.json({ message: "Invalid submission" }, { status: 400 });
    }
    const { fold, token, proof } = body as Record<string, unknown>;
    if (!isValidFold(fold)) {
      return Response.json({ message: "Invalid fold" }, { status: 400 });
    }
    if (
      typeof token !== "string" ||
      !token ||
      token.length > 1024 ||
      typeof proof !== "string" ||
      !/^\d{1,16}$/.test(proof)
    ) {
      return Response.json(
        { message: "Invalid token or proof" },
        { status: 400 },
      );
    }

    if (replay.has(token)) return reused();
    const { expired, challenge, err } = await verifyToken(token);
    if (err || expired || !challenge) {
      return Response.json({ message: "Bad token" }, { status: 403 });
    }
    if (!(await verifyWork(challenge, proof))) {
      return Response.json({ message: "Challenge failed" }, { status: 403 });
    }

    // Claim synchronously after validation so concurrent replays cannot all write.
    const claimed = replay.claim(token);
    if (claimed === "used") return reused();
    if (claimed === "full")
      return Response.json(
        { message: "Try again shortly" },
        { status: 429, headers: { "Retry-After": "10" } },
      );

    const ip = info.ip || "unknown";
    try {
      const result = await db.addFold(fold, ip, challenge);
      if (result !== "saved") {
        return Response.json(
          {
            message:
              result === "challenge_used"
                ? "Challenge reuse rejected"
                : "Fold already saved",
          },
          { status: 403 },
        );
      }
      return Response.json({ message: "Fold saved" });
    } catch (error) {
      // SDK errors can contain command arguments, including legacy IP keys.
      console.error("Error saving fold");
      return Response.json({ message: "Unable to save fold" }, { status: 503 });
    }
  }

  return { GET, POST };
}
