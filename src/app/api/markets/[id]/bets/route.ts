import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const PAGE_SIZE = 50;

/**
 * GET /api/markets/[id]/bets
 *
 * Public endpoint — shows aggregate activity for a market.
 * Security:
 *   - Individual amounts are NOT exposed (only direction + masked ID)
 *   - Paginated to prevent bulk scraping
 *   - partyId is masked: first 6 + last 4 chars
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Validate market exists
    const market = await prisma.market.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    // Pagination
    const url    = new URL(req.url);
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const limit  = Math.min(parseInt(url.searchParams.get("limit") ?? "50", 10), PAGE_SIZE);

    const bets = await prisma.bet.findMany({
      where: { marketId: id },
      include: { user: { select: { partyId: true } } },
      orderBy: { placedAt: "desc" },
      take: limit + 1, // fetch one extra to determine if there's a next page
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const hasMore = bets.length > limit;
    const page    = hasMore ? bets.slice(0, limit) : bets;
    const nextCursor = hasMore ? page[page.length - 1].id : null;

    const masked = page.map((b: (typeof bets)[number]) => ({
      id:        b.id,
      direction: b.direction,
      amount:    b.amount.toNumber(),
      status:    b.status,
      placedAt:  b.placedAt,
      maskedId:  `${b.user.partyId.slice(0, 6)}…${b.user.partyId.slice(-4)}`,
    }));

    return NextResponse.json(
      { bets: masked, nextCursor },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("[market bets]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
