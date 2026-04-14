import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBtcPrice } from "@/lib/price";
import { addMinutes } from "date-fns";

export const dynamic = "force-dynamic";

// Work entirely in number (float64) after converting Decimal at the boundary.
type BetRow = { id: string; userId: string; direction: string; amount: number };
const SATS         = 1e8;
const toSats       = (n: number) => Math.round(n * SATS);
const fromSats     = (n: number) => n / SATS;
const PLATFORM_FEE = 0.05; // 5% — deducted from total pool before winner distribution

/**
 * Settle a single expired market. Duplicated from cycle-markets so this route
 * is fully self-contained — the cron is an optimization, not a requirement.
 */
async function settleMarketInline(marketId: string, closePrice: number) {
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: { bets: true },
  });
  if (!market || market.status === "SETTLED") return;

  // Safety: never settle a market whose close time is still in the future
  if (market.closeAt.getTime() > Date.now()) return;

  const startPrice = market.startPrice.toNumber();
  const totalUp    = market.totalUp.toNumber();
  const totalDown  = market.totalDown.toNumber();
  const bets: BetRow[] = market.bets.map((b: { id: string; userId: string; direction: string; amount: { toNumber(): number } }) => ({
    id: b.id, userId: b.userId, direction: b.direction, amount: b.amount.toNumber(),
  }));

  const totalPool = totalUp + totalDown;
  const now = new Date();

  const isDraw = closePrice === startPrice;
  const winningDirection = isDraw ? "DRAW" : closePrice > startPrice ? "UP" : "DOWN";
  const winningPool = isDraw ? 0 : winningDirection === "UP" ? totalUp : totalDown;

  if (totalPool === 0) {
    await prisma.market.update({
      where: { id: marketId, status: { not: "SETTLED" } },
      data: { closePrice, direction: winningDirection, status: "SETTLED", settledAt: now },
    });
    return;
  }

  if (isDraw || winningPool === 0) {
    await prisma.$transaction([
      prisma.market.update({
        where: { id: marketId, status: { not: "SETTLED" } },
        data: { closePrice, direction: winningDirection, status: "SETTLED", settledAt: now },
      }),
      ...bets.map((b) => prisma.bet.update({ where: { id: b.id }, data: { status: "REFUNDED", payout: b.amount, settledAt: now } })),
      ...bets.map((b) => prisma.user.update({ where: { id: b.userId }, data: { appBalance: { increment: b.amount } } })),
    ]);
    return;
  }

  const winnerBets = bets.filter((b) => b.direction === winningDirection);
  const loserBets  = bets.filter((b) => b.direction !== winningDirection);

  // 5% platform fee from total pool before distribution
  const adjustedPoolSats = Math.floor(toSats(totalPool) * (1 - PLATFORM_FEE));
  const winningPoolSats  = toSats(winningPool);

  const payouts = winnerBets.map((bet) => {
    const payoutSats = Math.floor((toSats(bet.amount) * adjustedPoolSats) / winningPoolSats);
    return { bet, payout: fromSats(payoutSats) };
  });

  await prisma.$transaction([
    prisma.market.update({
      where: { id: marketId, status: { not: "SETTLED" } },
      data: { closePrice, direction: winningDirection, status: "SETTLED", settledAt: now },
    }),
    ...payouts.map(({ bet, payout }) => prisma.bet.update({ where: { id: bet.id }, data: { status: "WON", payout, settledAt: now } })),
    ...payouts.map(({ bet, payout }) => prisma.user.update({ where: { id: bet.userId }, data: { appBalance: { increment: payout } } })),
    ...loserBets.map((b) => prisma.bet.update({ where: { id: b.id }, data: { status: "LOST", payout: 0, settledAt: now } })),
  ]);
}

/**
 * GET /api/markets
 *
 * Lazy-settle: if any markets are expired and unsettled, settle them inline
 * before returning data. Then create a new OPEN market if none exists.
 * This removes all dependency on the cron for correctness — the cron is
 * an optimization that keeps latency low, but the system is self-healing
 * even if the cron is down.
 */
export async function GET() {
  try {
    const now = new Date();

    // Step 1: Settle any expired, unsettled markets on-the-fly
    const expired = await prisma.market.findMany({
      where: { status: { in: ["OPEN", "CLOSED"] }, closeAt: { lte: now } },
      select: { id: true },
    });

    if (expired.length > 0) {
      try {
        const closePrice = await getBtcPrice();
        for (const m of expired) {
          try {
            await settleMarketInline(m.id, closePrice);
          } catch (err) {
            console.error(`[GET /api/markets] inline settle failed for ${m.id}:`, err);
          }
        }
      } catch (err) {
        // Price fetch failed — skip settlement, return stale data
        console.error("[GET /api/markets] price fetch failed, skipping settlement:", err);
      }
    }

    // Step 2: Create a new OPEN market if none exists (atomic, idempotent)
    const hasOpen = await prisma.market.count({ where: { status: "OPEN" } });
    if (hasOpen === 0) {
      try {
        const startPrice = await getBtcPrice();
        const id = `mkt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const openAt  = now.toISOString();
        const closeAt = addMinutes(now, 15).toISOString();

        await prisma.$queryRaw`
          INSERT INTO markets (id, question, "assetPair", category, "startPrice", "totalUp", "totalDown", "openAt", "closeAt", status, "createdAt", "updatedAt")
          SELECT ${id}, 'What will BTC/USD be in 15 minutes?', 'BTC/USD', 'crypto',
                 ${startPrice}::numeric, 0, 0,
                 ${openAt}::timestamptz, ${closeAt}::timestamptz,
                 'OPEN'::"MarketStatus", NOW(), NOW()
          WHERE NOT EXISTS (SELECT 1 FROM markets WHERE status = 'OPEN')
        `;
      } catch (err) {
        console.error("[GET /api/markets] failed to create new market:", err);
      }
    }

    // Step 3: Return market data
    const [markets, totalCount] = await Promise.all([
      prisma.market.findMany({
        where: { status: { in: ["OPEN", "SETTLED"] } },
        orderBy: { openAt: "desc" },
        take: 20,
        include: { _count: { select: { bets: true } } },
      }),
      prisma.market.count(),
    ]);

    const serialized = markets.map((m) => ({
      ...m,
      startPrice: m.startPrice.toNumber(),
      closePrice: m.closePrice?.toNumber() ?? null,
      totalUp:    m.totalUp.toNumber(),
      totalDown:  m.totalDown.toNumber(),
    }));

    return NextResponse.json(
      { markets: serialized, totalCount },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch (err) {
    console.error("[GET /api/markets]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
