import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/markets/[id]/bet
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: marketId } = await params;
    const { partyId, direction, amount } = await req.json();

    if (!partyId || !direction || !amount || amount <= 0) {
      return NextResponse.json({ error: "Invalid params" }, { status: 400 });
    }

    if (!["UP", "DOWN"].includes(direction)) {
      return NextResponse.json({ error: "Direction must be UP or DOWN" }, { status: 400 });
    }

    const market = await prisma.market.findUnique({ where: { id: marketId } });
    if (!market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    if (market.status !== "OPEN") {
      return NextResponse.json({ error: "Market is not open for betting" }, { status: 400 });
    }

    if (new Date() >= market.closeAt) {
      return NextResponse.json({ error: "Market has expired" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { partyId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (user.appBalance < amount) {
      return NextResponse.json({ error: "Insufficient app balance" }, { status: 400 });
    }

    // Deduct from app balance and place bet atomically
    const [bet] = await prisma.$transaction([
      prisma.bet.create({
        data: {
          userId: user.id,
          marketId,
          direction,
          amount,
          status: "PENDING",
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { appBalance: { decrement: amount } },
      }),
      prisma.market.update({
        where: { id: marketId },
        data: {
          totalUp: direction === "UP" ? { increment: amount } : undefined,
          totalDown: direction === "DOWN" ? { increment: amount } : undefined,
        },
      }),
    ]);

    const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });

    return NextResponse.json({ bet, appBalance: updatedUser?.appBalance ?? 0 }, { status: 201 });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
