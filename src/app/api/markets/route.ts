import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBtcPrice } from "@/lib/price";
import { addMinutes } from "date-fns";

export const dynamic = "force-dynamic";

// Use BigInt satoshi arithmetic for payout math — avoids float64 overflow.
// betSats (max ~1e11) * adjustedPoolSats (max ~1e14) = ~1e25, exceeds Number.MAX_SAFE_INTEGER (9e15).
type BetRow = { id: string; userId: string; direction: string; amount: number };
const SATS         = 1e8;
const toSatsBig    = (n: number) => BigInt(Math.round(n * SATS));
const fromSatsBig  = (n: bigint) => Number(n) / SATS;
// 5% platform fee — BigInt(95)/BigInt(100) used directly in payout math (no float multiply)
// Epsilon for DRAW detection — strict float equality fails for exchange price rounding noise
const PRICE_EPSILON = 0.000001;

/**
 * Settle a single expired market. Uses SELECT FOR UPDATE pessimistic locking to
 * prevent double-settlement when both the cron and this lazy-settle path race.
 */
async function settleMarketInline(marketId: string, closePrice: number) {
  return prisma.$transaction(async (tx) => {
    // Pessimistic lock: first cron tick acquires the row lock; second blocks until
    // first commits, then sees SETTLED status and exits early.
    const locked = await tx.$queryRaw<{ id: string; status: string; closeAt: Date }[]>`
      SELECT id, status, "closeAt" FROM markets WHERE id = ${marketId} FOR UPDATE
    `;
    if (!locked.length || locked[0].status === "SETTLED") return;
    if (new Date(locked[0].closeAt).getTime() > Date.now()) return;

    const market = await tx.market.findUnique({
      where: { id: marketId },
      include: { bets: true },
    });
    if (!market || market.status === "SETTLED") return;
    if (market.closeAt.getTime() > Date.now()) return;

    const startPrice = market.startPrice.toNumber();
    const totalUp    = market.totalUp.toNumber();
    const totalDown  = market.totalDown.toNumber();
    const bets: BetRow[] = market.bets.map((b: { id: string; userId: string; direction: string; amount: { toNumber(): number } }) => ({
      id: b.id, userId: b.userId, direction: b.direction, amount: b.amount.toNumber(),
    }));

    const totalPool = totalUp + totalDown;
    const now = new Date();

    // DRAW: use epsilon comparison — strict equality fails for floating-point exchange prices
    const isDraw = Math.abs(closePrice - startPrice) < PRICE_EPSILON;
    const winningDirection = isDraw ? "DRAW" : closePrice > startPrice ? "UP" : "DOWN";
    const winningPool = isDraw ? 0 : winningDirection === "UP" ? totalUp : totalDown;

    if (totalPool === 0) {
      await tx.market.update({
        where: { id: marketId, status: { not: "SETTLED" } },
        data: { closePrice, direction: winningDirection, status: "SETTLED", settledAt: now },
      });
      return;
    }

    const winnerBets = bets.filter((b) => b.direction === winningDirection);
    const loserBets  = bets.filter((b) => b.direction !== winningDirection);

    if (isDraw || winningPool === 0 || loserBets.length === 0) {
      await tx.market.update({
        where: { id: marketId, status: { not: "SETTLED" } },
        data: { closePrice, direction: winningDirection, status: "SETTLED", settledAt: now },
      });
      for (const b of bets) {
        await tx.bet.update({ where: { id: b.id }, data: { status: "REFUNDED", payout: b.amount, settledAt: now } });
        await tx.user.update({ where: { id: b.userId }, data: { appBalance: { increment: b.amount } } });
      }
      return;
    }

    // 5% platform fee — BigInt arithmetic to avoid float64 overflow
    const totalPoolSatsBig    = toSatsBig(totalPool);
    const adjustedPoolSatsBig = (totalPoolSatsBig * BigInt(95)) / BigInt(100);
    const winningPoolSatsBig  = toSatsBig(winningPool);

    const payouts = winnerBets.map((bet) => {
      const betSatsBig    = toSatsBig(bet.amount);
      const payoutSatsBig = (betSatsBig * adjustedPoolSatsBig) / winningPoolSatsBig;
      return { bet, payout: fromSatsBig(payoutSatsBig) };
    });

    await tx.market.update({
      where: { id: marketId, status: { not: "SETTLED" } },
      data: { closePrice, direction: winningDirection, status: "SETTLED", settledAt: now },
    });
    for (const { bet, payout } of payouts) {
      await tx.bet.update({ where: { id: bet.id }, data: { status: "WON", payout, settledAt: now } });
      await tx.user.update({ where: { id: bet.userId }, data: { appBalance: { increment: payout } } });
    }
    for (const b of loserBets) {
      await tx.bet.update({ where: { id: b.id }, data: { status: "LOST", payout: 0, settledAt: now } });
    }
  });
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
        await prisma.$transaction(async (tx) => {
          const existing = await tx.market.findFirst({ where: { status: "OPEN" } });
          if (existing) return;
          await tx.market.create({
            data: {
              question:  "What will BTC/USD be in 15 minutes?",
              assetPair: "BTC/USD",
              category:  "crypto",
              startPrice,
              totalUp:   0,
              totalDown: 0,
              openAt:    now,
              closeAt:   addMinutes(now, 15),
              status:    "OPEN",
            },
          });
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (!msg.includes("P2002") && !msg.includes("Unique constraint")) {
          console.error("[GET /api/markets] failed to create new market:", err);
        }
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

    const serialized = markets.map((m: (typeof markets)[number]) => ({
      ...m,
      startPrice: m.startPrice.toNumber(),
      closePrice: m.closePrice?.toNumber() ?? null,
      totalUp:    m.totalUp.toNumber(),
      totalDown:  m.totalDown.toNumber(),
    }));

    return NextResponse.json(
      { markets: serialized, totalCount, serverTime: now.toISOString() },
      { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
    );
  } catch (err) {
    console.error("[GET /api/markets]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
