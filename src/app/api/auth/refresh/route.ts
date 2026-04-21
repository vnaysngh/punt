import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/api-auth";
import { signSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * POST /api/auth/refresh
 *
 * Silently re-issues a 7-day JWT for an already-authenticated session.
 * No challenge/signature required — the Bearer token proves identity.
 * Called automatically by autoConnect() when the token has <2 days remaining.
 *
 * Security: the existing token must be valid and unexpired (requireAuth checks this).
 * A stolen token cannot be refreshed past its expiry — the attacker's window
 * is still capped at the original 7-day TTL.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth(req);
  if (auth instanceof NextResponse) return auth;

  const token = await signSession(auth.partyId);
  return NextResponse.json({ token });
}
