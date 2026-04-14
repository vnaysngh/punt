import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

// GET /api/users — returns the authenticated user's own record only
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;
    const { partyId } = auth;

    const user = await prisma.user.findUnique({ where: { partyId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Convert Decimal → number so the client receives a JSON number, not a string
    return NextResponse.json({
      id:         user.id,
      partyId:    user.partyId,
      email:      user.email,
      appBalance: user.appBalance.toNumber(),
      createdAt:  user.createdAt,
    });
  } catch (err) {
    console.error("[users GET]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
