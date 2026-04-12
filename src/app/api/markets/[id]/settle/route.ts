import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBtcPrice } from "@/lib/price";

type BetWithUser = {
  id: string;
  userId: string;
  direction: string;
  amount: number;
  status: string;
};

// POST /api/markets/[id]/settle
// Called by cron/admin after 15-minute window closes
// Provide closePrice to determine winner
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: marketId } = await params;
    const body = await req.json().catch(() => ({}));

    // Use provided closePrice or fetch live BTC price
    const closePrice: number = body.closePrice ?? await getBtcPrice();

    const market = await prisma.market.findUnique({
      where: { id: marketId },
      include: { bets: { include: { user: true } } },
    });

    if (!market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }

    if (market.status === "SETTLED") {
      return NextResponse.json({ error: "Market already settled" }, { status: 400 });
    }

    const winningDirection = closePrice > market.startPrice ? "UP" : "DOWN";
    const totalPool = market.totalUp + market.totalDown;
    const winningPool = winningDirection === "UP" ? market.totalUp : market.totalDown;

    const now = new Date();

    if (totalPool === 0 || winningPool === 0) {
      // No bets or no winners — refund all
      await prisma.$transaction([
        prisma.market.update({
          where: { id: marketId },
          data: { closePrice, direction: winningDirection, status: "SETTLED", settledAt: now },
        }),
        ...(market.bets as BetWithUser[]).map((bet) =>
          prisma.bet.update({
            where: { id: bet.id },
            data: { status: "REFUNDED", payout: bet.amount, settledAt: now },
          })
        ),
        ...(market.bets as BetWithUser[]).map((bet) =>
          prisma.user.update({
            where: { id: bet.userId },
            data: { appBalance: { increment: bet.amount } },
          })
        ),
      ]);
      return NextResponse.json({ settled: true, winningDirection, refunded: true });
    }

    // Proportional payout: winner gets their share of the full pool
    const winnerBets = (market.bets as BetWithUser[]).filter((b) => b.direction === winningDirection);
    const loserBets = (market.bets as BetWithUser[]).filter((b) => b.direction !== winningDirection);

    const payouts = winnerBets.map((bet) => {
      const share = bet.amount / winningPool;
      const payout = parseFloat((share * totalPool).toFixed(8));
      return { bet, payout };
    });

    await prisma.$transaction([
      prisma.market.update({
        where: { id: marketId },
        data: { closePrice, direction: winningDirection, status: "SETTLED", settledAt: now },
      }),
      ...payouts.map(({ bet, payout }: { bet: BetWithUser; payout: number }) =>
        prisma.bet.update({
          where: { id: bet.id },
          data: { status: "WON", payout, settledAt: now },
        })
      ),
      ...payouts.map(({ bet, payout }: { bet: BetWithUser; payout: number }) =>
        prisma.user.update({
          where: { id: bet.userId },
          data: { appBalance: { increment: payout } },
        })
      ),
      ...loserBets.map((bet: BetWithUser) =>
        prisma.bet.update({
          where: { id: bet.id },
          data: { status: "LOST", payout: 0, settledAt: now },
        })
      ),
    ]);

    return NextResponse.json({ settled: true, winningDirection, closePrice });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
