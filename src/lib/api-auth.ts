import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/session";

/**
 * Verify the Bearer session token on a request.
 * Returns the authenticated partyId, or a 401 response if invalid.
 *
 * Usage in route handlers:
 *   const auth = await requireAuth(req);
 *   if (auth instanceof NextResponse) return auth;
 *   const { partyId } = auth;
 */
export async function requireAuth(
  req: NextRequest
): Promise<{ partyId: string } | NextResponse> {
  const partyId = await getSessionFromRequest(req);
  if (!partyId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return { partyId };
}
