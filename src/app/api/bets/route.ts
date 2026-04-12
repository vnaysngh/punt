import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/bets?partyId=xxx
export async function GET(req: NextRequest) {
  try {
    const partyId = req.nextUrl.searchParams.get("partyId");
    if (!partyId) {
      return NextResponse.json({ error: "partyId required" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { partyId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const bets = await prisma.bet.findMany({
      where: { userId: user.id },
      include: { market: true },
      orderBy: { placedAt: "desc" },
    });

    return NextResponse.json(bets);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
