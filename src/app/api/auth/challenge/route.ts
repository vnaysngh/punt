import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

export const dynamic = "force-dynamic";

/**
 * GET /api/auth/challenge?partyId=<partyId>
 *
 * Issues a one-time random challenge for the client to sign with their
 * Loop wallet private key. The signed challenge is then sent back with
 * POST /api/auth/session to prove wallet ownership.
 *
 * Security:
 *   - Challenge is 32 random bytes (hex) — unguessable
 *   - Expires after 5 minutes — limits replay window
 *   - One challenge per partyId — requesting a new one invalidates the old one
 *   - Challenge is deleted on use (in session route)
 */

// In-memory store: partyId → { challenge, expiresAt }
// Fine for a single-instance server (Railway). For horizontal scaling, use Redis.
const challenges = new Map<string, { challenge: string; expiresAt: number }>();

// Rate limiter: max 5 challenges per partyId per minute
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const MAX_CHALLENGES_PER_MINUTE = 5;

// Clean up expired challenges and rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [partyId, entry] of challenges) {
    if (entry.expiresAt < now) challenges.delete(partyId);
  }
  for (const [partyId, entry] of rateLimits) {
    if (entry.resetAt < now) rateLimits.delete(partyId);
  }
}, 5 * 60 * 1000);

function checkRateLimit(partyId: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(partyId);
  if (!entry || entry.resetAt < now) {
    rateLimits.set(partyId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count < MAX_CHALLENGES_PER_MINUTE) {
    entry.count++;
    return true;
  }
  return false;
}

const PARTY_ID_RE = /^[A-Za-z0-9_-]{1,128}::[0-9a-f]{8,}$/i;
const TTL_MS = 5 * 60 * 1000; // 5 minutes

export function getChallengeForParty(partyId: string): string | null {
  const entry = challenges.get(partyId);
  if (!entry || entry.expiresAt < Date.now()) {
    challenges.delete(partyId);
    return null;
  }
  return entry.challenge;
}

export function consumeChallengeForParty(partyId: string): string | null {
  const challenge = getChallengeForParty(partyId);
  if (challenge) challenges.delete(partyId); // one-time use
  return challenge;
}

export async function GET(req: NextRequest) {
  const partyId = req.nextUrl.searchParams.get("partyId");

  if (!partyId || !PARTY_ID_RE.test(partyId)) {
    return NextResponse.json({ error: "Invalid partyId" }, { status: 400 });
  }

  if (!checkRateLimit(partyId)) {
    return NextResponse.json(
      { error: "Too many challenge requests. Please wait a moment." },
      { status: 429 }
    );
  }

  const challenge = crypto.randomBytes(32).toString("hex");
  challenges.set(partyId, { challenge, expiresAt: Date.now() + TTL_MS });

  return NextResponse.json({ challenge });
}
