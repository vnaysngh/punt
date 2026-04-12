import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBtcPrice } from "@/lib/price";
import { addMinutes } from "date-fns";

async function settleMarket(marketId: string) {
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: { bets: { include: { user: true } } },
  });
  if (!market || market.status === "SETTLED") return;

  const closePrice = await getBtcPrice();
  const winningDirection = closePrice > market.startPrice ? "UP" : "DOWN";
  const totalPool = market.totalUp + market.totalDown;
  const winningPool = winningDirection === "UP" ? market.totalUp : market.totalDown;
  const now = new Date();

  type BetWithUser = { id: string; userId: string; direction: string; amount: number };
  const bets = market.bets as BetWithUser[];

  if (totalPool === 0 || winningPool === 0) {
    // No bets — just settle with no payouts
    await prisma.$transaction([
      prisma.market.update({
        where: { id: marketId },
        data: { closePrice, direction: winningDirection, status: "SETTLED", settledAt: now },
      }),
      ...bets.map((bet) => prisma.bet.update({ where: { id: bet.id }, data: { status: "REFUNDED", payout: bet.amount, settledAt: now } })),
      ...bets.map((bet) => prisma.user.update({ where: { id: bet.userId }, data: { appBalance: { increment: bet.amount } } })),
    ]);
    return;
  }

  const winnerBets = bets.filter((b) => b.direction === winningDirection);
  const loserBets  = bets.filter((b) => b.direction !== winningDirection);
  const payouts    = winnerBets.map((bet) => ({
    bet,
    payout: parseFloat(((bet.amount / winningPool) * totalPool).toFixed(8)),
  }));

  await prisma.$transaction([
    prisma.market.update({
      where: { id: marketId },
      data: { closePrice, direction: winningDirection, status: "SETTLED", settledAt: now },
    }),
    ...payouts.map(({ bet, payout }) => prisma.bet.update({ where: { id: bet.id }, data: { status: "WON", payout, settledAt: now } })),
    ...payouts.map(({ bet, payout }) => prisma.user.update({ where: { id: bet.userId }, data: { appBalance: { increment: payout } } })),
    ...loserBets.map((bet) => prisma.bet.update({ where: { id: bet.id }, data: { status: "LOST", payout: 0, settledAt: now } })),
  ]);
}

// GET /api/markets — auto-settles expired markets, auto-creates a new one, returns open+settled
export async function GET() {
  try {
    const now = new Date();

    // Find expired-but-not-settled markets and settle them
    const expired = await prisma.market.findMany({
      where: { status: "OPEN", closeAt: { lte: now } },
    });
    await Promise.all(expired.map((m) => settleMarket(m.id)));

    // Ensure there is always exactly one open market
    const open = await prisma.market.findFirst({ where: { status: "OPEN" } });
    if (!open) {
      const startPrice = await getBtcPrice();
      await prisma.market.create({
        data: {
          question: "What will BTC/USD be in 15 minutes?",
          assetPair: "BTC/USD",
          category: "crypto",
          startPrice,
          openAt: now,
          closeAt: addMinutes(now, 15),
          status: "OPEN",
        },
      });
    }

    const markets = await prisma.market.findMany({
      where: { status: { in: ["OPEN", "SETTLED"] } },
      orderBy: { openAt: "desc" },
      take: 20,
    });

    return NextResponse.json(markets);
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
