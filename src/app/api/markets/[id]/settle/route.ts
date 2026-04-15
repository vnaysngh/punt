import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBtcPrice } from "@/lib/price";
import { verifyCronSecret } from "@/lib/cron-auth";

type BetRow = { id: string; userId: string; direction: string; amount: number };

const SATS         = 1e8;
const toSatsBig    = (n: number) => BigInt(Math.round(n * SATS));
const fromSatsBig  = (n: bigint) => Number(n) / SATS;
// 5% platform fee — BigInt(95)/BigInt(100) used directly in payout math to avoid float multiply

// DRAW: use epsilon comparison instead of strict equality — float prices from exchange
// may have rounding noise even when economically equal.
const PRICE_EPSILON = 0.000001; // sub-cent — no real BTC price move is this small

/**
 * POST /api/markets/[id]/settle
 * CRON-ONLY. Requires x-cron-secret or Authorization: Bearer CRON_SECRET.
 * Never accepts a caller-supplied price — always fetches live from exchange.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { id: marketId } = await params;

    const market = await prisma.market.findUnique({
      where: { id: marketId },
      include: { bets: true },
    });

    if (!market) return NextResponse.json({ error: "Market not found" }, { status: 404 });
    if (market.status === "SETTLED") return NextResponse.json({ error: "Already settled" }, { status: 400 });

    // Safety: never settle a market whose close time is still in the future
    if (market.closeAt.getTime() > Date.now()) {
      return NextResponse.json({ error: "Market has not expired yet" }, { status: 400 });
    }

    // Convert Decimal → number at the boundary
    const startPrice  = market.startPrice.toNumber();
    const totalUp     = market.totalUp.toNumber();
    const totalDown   = market.totalDown.toNumber();
    const bets: BetRow[] = market.bets.map((b: { id: string; userId: string; direction: string; amount: { toNumber(): number } }) => ({
      id:        b.id,
      userId:    b.userId,
      direction: b.direction,
      amount:    b.amount.toNumber(),
    }));

    const closePrice = await getBtcPrice();
    const totalPool  = totalUp + totalDown;
    const now = new Date();

    // DRAW: use epsilon comparison — strict equality fails for floating-point exchange prices
    const isDraw = Math.abs(closePrice - startPrice) < PRICE_EPSILON;
    const winningDirection = isDraw ? "DRAW" : closePrice > startPrice ? "UP" : "DOWN";
    const winningPool = isDraw ? 0 : winningDirection === "UP" ? totalUp : totalDown;

    if (totalPool === 0) {
      // Wrap in $transaction for consistent double-settlement guard:
      // concurrent settle calls both hit WHERE status≠SETTLED; only one wins, other gets P2025.
      await prisma.$transaction([
        prisma.market.update({
          where: { id: marketId, status: { not: "SETTLED" } },
          data: { closePrice, direction: winningDirection, status: "SETTLED", settledAt: now },
        }),
      ]);
      return NextResponse.json({ settled: true, winningDirection, bets: 0 });
    }

    if (isDraw || winningPool === 0) {
      await prisma.$transaction([
        prisma.market.update({
          where: { id: marketId, status: { not: "SETTLED" } },
          data: { closePrice, direction: winningDirection, status: "SETTLED", settledAt: now },
        }),
        ...bets.map((bet) =>
          prisma.bet.update({ where: { id: bet.id }, data: { status: "REFUNDED", payout: bet.amount, settledAt: now } })
        ),
        ...bets.map((bet) =>
          prisma.user.update({ where: { id: bet.userId }, data: { appBalance: { increment: bet.amount } } })
        ),
      ]);
      return NextResponse.json({ settled: true, winningDirection, refunded: bets.length });
    }

    const winnerBets = bets.filter((b) => b.direction === winningDirection);
    const loserBets  = bets.filter((b) => b.direction !== winningDirection);

    // 5% platform fee from total pool before distribution.
    // IMPORTANT: Use BigInt arithmetic — betSats * adjustedPoolSats can reach ~1e25,
    // which overflows float64 safe integer range (Number.MAX_SAFE_INTEGER = 9e15).
    const totalPoolSatsBig    = toSatsBig(totalPool);
    const adjustedPoolSatsBig = (totalPoolSatsBig * BigInt(95)) / BigInt(100);
    const winningPoolSatsBig  = toSatsBig(winningPool);

    const payouts = winnerBets.map((bet) => {
      const betSatsBig    = toSatsBig(bet.amount);
      // BigInt division truncates (floor) automatically
      const payoutSatsBig = (betSatsBig * adjustedPoolSatsBig) / winningPoolSatsBig;
      return { bet, payout: fromSatsBig(payoutSatsBig) };
    });

    await prisma.$transaction([
      prisma.market.update({
        where: { id: marketId, status: { not: "SETTLED" } },
        data: { closePrice, direction: winningDirection, status: "SETTLED", settledAt: now },
      }),
      ...payouts.map(({ bet, payout }) =>
        prisma.bet.update({ where: { id: bet.id }, data: { status: "WON", payout, settledAt: now } })
      ),
      ...payouts.map(({ bet, payout }) =>
        prisma.user.update({ where: { id: bet.userId }, data: { appBalance: { increment: payout } } })
      ),
      ...loserBets.map((bet) =>
        prisma.bet.update({ where: { id: bet.id }, data: { status: "LOST", payout: 0, settledAt: now } })
      ),
    ]);

    return NextResponse.json({ settled: true, winningDirection, closePrice, winners: winnerBets.length, losers: loserBets.length });
  } catch (err) {
    console.error("[settle]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
