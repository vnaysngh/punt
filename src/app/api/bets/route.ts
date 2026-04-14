import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

const MAX_PAGE_SIZE = 100;

/**
 * GET /api/bets?limit=50&cursor=<betId>
 *
 * Returns the authenticated user's bets (paginated, cursor-based).
 * Security:
 *   - Auth required (Bearer JWT)
 *   - Only returns bets belonging to the authenticated user
 *   - Page size capped at 100
 *   - Cursor-based pagination prevents offset scanning attacks
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;
    const { partyId } = auth;

    const user = await prisma.user.findUnique({ where: { partyId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const url    = new URL(req.url);
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const limit  = Math.min(
      Math.max(1, parseInt(url.searchParams.get("limit") ?? "50", 10) || 50),
      MAX_PAGE_SIZE
    );

    const bets = await prisma.bet.findMany({
      where: { userId: user.id },
      include: { market: true },
      orderBy: { placedAt: "desc" },
      take: limit + 1, // fetch one extra for hasMore detection
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore    = bets.length > limit;
    const page       = hasMore ? bets.slice(0, limit) : bets;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    // Serialize Decimal → number for all money fields
    const serialized = page.map((b: (typeof bets)[number]) => ({
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

    return NextResponse.json(serialized, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[bets]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
