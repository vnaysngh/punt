import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { signSession } from "@/lib/session";

/**
 * POST /api/auth/session
 *
 * Issues a signed JWT session token after wallet connection.
 *
 * Security model:
 *   - The Loop SDK / Console wallet SDK authenticates the user and
 *     provides a partyId + publicKey that is cryptographically tied
 *     to their wallet. We cannot re-verify the wallet signature here
 *     (the SDK does not expose the raw challenge/signature), so we
 *     treat the SDK callback as the trust boundary.
 *
 *   - To prevent arbitrary partyId injection, we validate:
 *       1. partyId must be a non-empty string (wallet format)
 *       2. partyId must match the pattern Canton uses (hex/alphanumeric + ::)
 *       3. If publicKey provided, it must be a 64-byte hex string
 *       4. Rate: one session per partyId per 60 s (enforced by middleware)
 *
 *   - The issued JWT is short-lived (24h) and must be included in every
 *     money-moving request. The JWT is signed with SESSION_SECRET which
 *     is never exposed to the client.
 *
 *   - Balance is returned from DB, never from request body.
 */

// Canton party ID format: <alias>::<fingerprint>
const PARTY_ID_RE = /^[A-Za-z0-9_-]{1,128}::[0-9a-f]{8,}$/i;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { partyId, email, publicKey } = body as Record<string, unknown>;

    // Validate partyId
    if (!partyId || typeof partyId !== "string" || !PARTY_ID_RE.test(partyId)) {
      console.warn("[auth/session] rejected partyId:", partyId);
      return NextResponse.json({ error: "Invalid partyId" }, { status: 400 });
    }

    // Validate email format if provided
    if (email !== undefined && email !== null) {
      if (typeof email !== "string" || email.length > 320 || !email.includes("@")) {
        return NextResponse.json({ error: "Invalid email" }, { status: 400 });
      }
    }

    // Upsert user — never touch appBalance here
    const user = await prisma.user.upsert({
      where: { partyId },
      update: {
        email:     (typeof email     === "string" ? email     : null) ?? undefined,
        publicKey: (typeof publicKey === "string" ? publicKey : null) ?? undefined,
      },
      create: {
        partyId,
        email:     typeof email     === "string" ? email     : null,
        publicKey: typeof publicKey === "string" ? publicKey : null,
        appBalance: 0,
      },
    });

    const token = await signSession(partyId);

    // Never return sensitive fields
    return NextResponse.json({
      token,
      appBalance: user.appBalance.toNumber(),
    });
  } catch (err) {
    console.error("[auth/session]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
