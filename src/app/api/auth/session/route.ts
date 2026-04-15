import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { signSession } from "@/lib/session";
import { consumeChallengeForParty } from "@/app/api/auth/challenge/route";
import forge from "node-forge";

/**
 * POST /api/auth/session
 *
 * Issues a signed JWT after cryptographically verifying wallet ownership.
 *
 * Flow:
 *   1. Client calls GET /api/auth/challenge?partyId=... → gets a random challenge
 *   2. Client signs the challenge with their Loop wallet private key
 *   3. Client sends { partyId, publicKey, signature, challenge } here
 *   4. Server verifies: Ed25519 signature over challenge using publicKey
 *   5. Server issues JWT containing partyId
 *
 * Security:
 *   - Proves the client controls the private key for this partyId
 *   - Challenge is one-time use — deleted after verification
 *   - Challenge expires after 5 minutes
 *   - publicKey stored in DB for future verification
 */

const PARTY_ID_RE = /^[A-Za-z0-9_-]{1,128}::[0-9a-f]{8,}$/i;

function verifyEd25519(
  publicKeyHex: string,
  message: string,
  signatureHex: string
): boolean {
  try {
    const publicKey = forge.util.hexToBytes(publicKeyHex);
    const signature = forge.util.hexToBytes(signatureHex);
    return forge.pki.ed25519.verify({
      message,
      encoding: "utf8",
      publicKey,
      signature,
    });
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { partyId, publicKey, signature, challenge, email } = body as Record<string, unknown>;

    // Validate partyId format
    if (!partyId || typeof partyId !== "string" || !PARTY_ID_RE.test(partyId)) {
      return NextResponse.json({ error: "Invalid partyId" }, { status: 400 });
    }

    // Validate publicKey — required for signature verification
    if (
      !publicKey ||
      typeof publicKey !== "string" ||
      publicKey.length < 16 ||
      publicKey.length > 256 ||
      !/^[0-9a-fA-F]+$/.test(publicKey)
    ) {
      return NextResponse.json({ error: "Invalid publicKey" }, { status: 400 });
    }

    // Validate signature format
    if (
      !signature ||
      typeof signature !== "string" ||
      !/^[0-9a-fA-F]+$/.test(signature)
    ) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    // Validate challenge format
    if (!challenge || typeof challenge !== "string") {
      return NextResponse.json({ error: "Challenge required" }, { status: 400 });
    }

    // Consume challenge — one-time use, also validates it exists and hasn't expired
    const storedChallenge = consumeChallengeForParty(partyId);
    if (!storedChallenge) {
      return NextResponse.json(
        { error: "Challenge expired or not found. Request a new one." },
        { status: 401 }
      );
    }

    // Verify the challenge matches what we issued
    if (storedChallenge !== challenge) {
      return NextResponse.json({ error: "Challenge mismatch" }, { status: 401 });
    }

    // Cryptographic verification — proves client owns the private key for this publicKey
    const valid = verifyEd25519(publicKey, challenge, signature);
    if (!valid) {
      console.warn("[auth/session] Signature verification failed for partyId:", partyId);
      return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
    }

    // Validate email if provided
    if (email !== undefined && email !== null) {
      if (typeof email !== "string" || email.length > 320 || !email.includes("@")) {
        return NextResponse.json({ error: "Invalid email" }, { status: 400 });
      }
    }

    // Upsert user — never touch appBalance here
    const user = await prisma.user.upsert({
      where: { partyId },
      update: {
        publicKey,
        email: (typeof email === "string" ? email : null) ?? undefined,
      },
      create: {
        partyId,
        publicKey,
        email:      typeof email === "string" ? email : null,
        appBalance: 0,
      },
    });

    const token = await signSession(partyId);

    return NextResponse.json({
      token,
      appBalance: user.appBalance.toNumber(),
    });
  } catch (err) {
    console.error("[auth/session]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
