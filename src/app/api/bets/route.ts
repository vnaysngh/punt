import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

// GET /api/bets — returns the authenticated user's bets with Decimal fields serialized
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;
    const { partyId } = auth;

    const user = await prisma.user.findUnique({ where: { partyId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const bets = await prisma.bet.findMany({
      where: { userId: user.id },
      include: { market: true },
      orderBy: { placedAt: "desc" },
    });

    // Serialize Decimal → number for all money fields
    const serialized = bets.map((b) => ({
      ...b,
      amount:  b.amount.toNumber(),
      payout:  b.payout?.toNumber() ?? null,
      market: b.market ? {
        ...b.market,
        startPrice: b.market.startPrice.toNumber(),
        closePrice: b.market.closePrice?.toNumber() ?? null,
        totalUp:    b.market.totalUp.toNumber(),
        totalDown:  b.market.totalDown.toNumber(),
      } : null,
    }));

    return NextResponse.json(serialized);
  } catch (err) {
    console.error("[bets]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
