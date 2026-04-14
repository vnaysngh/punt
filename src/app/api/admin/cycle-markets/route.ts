import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBtcPrice } from "@/lib/price";
import { verifyCronSecret } from "@/lib/cron-auth";
import { addMinutes } from "date-fns";

export const dynamic = "force-dynamic";

// Work entirely in number (float64) after converting Decimal at the boundary.
// All arithmetic uses integer satoshi math to stay precise.
type BetRow = { id: string; userId: string; direction: string; amount: number };

const SATS         = 1e8;
const toSats       = (n: number) => Math.round(n * SATS);
const fromSats     = (n: number) => n / SATS;
const PLATFORM_FEE = 0.05; // 5% — deducted from total pool before winner distribution (PancakeSwap model)

async function settleMarket(marketId: string, closePrice: number) {
  const market = await prisma.market.findUnique({
    where: { id: marketId },
    include: { bets: true },
  });

  if (!market || market.status === "SETTLED") return null;

  // Safety: never settle a market whose close time is still in the future
  if (market.closeAt.getTime() > Date.now()) {
    console.warn(`[cycle-markets] Skipping ${marketId} — not expired yet (closeAt=${market.closeAt.toISOString()})`);
    return null;
  }

  // Convert Decimal → number at the boundary
  const startPrice  = market.startPrice.toNumber();
  const totalUp     = market.totalUp.toNumber();
  const totalDown   = market.totalDown.toNumber();
  const bets: BetRow[] = market.bets.map((b) => ({
    id:        b.id,
    userId:    b.userId,
    direction: b.direction,
    amount:    b.amount.toNumber(),
  }));

  const totalPool = totalUp + totalDown;
  const now = new Date();

  // DRAW: price didn't move — refund everyone, no winner
  const isDraw = closePrice === startPrice;
  const winningDirection = isDraw ? "DRAW" : closePrice > startPrice ? "UP" : "DOWN";
  const winningPool = isDraw ? 0 : winningDirection === "UP" ? totalUp : totalDown;

  if (totalPool === 0) {
    await prisma.$transaction([
      prisma.market.update({
        where: { id: marketId, status: { not: "SETTLED" } },
        data: { closePrice, direction: winningDirection, status: "SETTLED", settledAt: now },
      }),
    ]);
    return { marketId, closePrice, winningDirection, bets: 0 };
  }

  // Refund all if: draw, or nobody bet on the winning side
  if (isDraw || winningPool === 0) {
    await prisma.$transaction([
      prisma.market.update({
        where: { id: marketId, status: { not: "SETTLED" } },
        data: { closePrice, direction: winningDirection, status: "SETTLED", settledAt: now },
      }),
      ...bets.map((bet) =>
        prisma.bet.update({
          where: { id: bet.id },
          data: { status: "REFUNDED", payout: bet.amount, settledAt: now },
        })
      ),
      ...bets.map((bet) =>
        prisma.user.update({
          where: { id: bet.userId },
          data: { appBalance: { increment: bet.amount } },
        })
      ),
    ]);
    return { marketId, closePrice, winningDirection, refunded: bets.length };
  }

  const winnerBets = bets.filter((b) => b.direction === winningDirection);
  const loserBets  = bets.filter((b) => b.direction !== winningDirection);

  // 5% platform fee — deducted from total pool before distribution (PancakeSwap model)
  // adjustedPool = totalPool × 0.95 → distributed to winners
  // platformFee  = totalPool × 0.05 → kept by platform (stays in app wallet, never distributed)
  const adjustedPoolSats = Math.floor(toSats(totalPool) * (1 - PLATFORM_FEE));
  const winningPoolSats  = toSats(winningPool);
  const platformFee      = fromSats(toSats(totalPool) - adjustedPoolSats);

  const payouts = winnerBets.map((bet) => {
    const betSats    = toSats(bet.amount);
    const payoutSats = Math.floor((betSats * adjustedPoolSats) / winningPoolSats);
    return { bet, payout: fromSats(payoutSats) };
  });

  await prisma.$transaction([
    prisma.market.update({
      where: { id: marketId, status: { not: "SETTLED" } },
      data: { closePrice, direction: winningDirection, status: "SETTLED", settledAt: now },
    }),
    ...payouts.map(({ bet, payout }) =>
      prisma.bet.update({
        where: { id: bet.id },
        data: { status: "WON", payout, settledAt: now },
      })
    ),
    ...payouts.map(({ bet, payout }) =>
      prisma.user.update({
        where: { id: bet.userId },
        data: { appBalance: { increment: payout } },
      })
    ),
    ...loserBets.map((bet) =>
      prisma.bet.update({
        where: { id: bet.id },
        data: { status: "LOST", payout: 0, settledAt: now },
      })
    ),
  ]);

  console.log(`[cycle-markets] Fee collected: ${platformFee} CBTC from market ${marketId}`);
  return { marketId, closePrice, winningDirection, winners: winnerBets.length, losers: loserBets.length, platformFee };
}

async function runCycle(now: Date) {
  const settled: unknown[] = [];
  const errors: string[] = [];

  // Step 1: Settle ALL expired markets. Must complete before creating a new one.
  const expired = await prisma.market.findMany({
    where: { status: { in: ["OPEN", "CLOSED"] }, closeAt: { lte: now } },
  });

  if (expired.length > 0) {
    const closePrice = await getBtcPrice();
    for (const m of expired) {
      try {
        const result = await settleMarket(m.id, closePrice);
        if (result) {
          console.log(`[cycle-markets] Settled ${m.id} | ${result.winningDirection} @ ${closePrice}`);
          settled.push(result);
        }
      } catch (err) {
        // Log but continue — try to settle remaining markets
        console.error(`[cycle-markets] Failed to settle ${m.id}:`, err);
        errors.push(`${m.id}: ${String(err)}`);
      }
    }
  }

  // Step 2: Only create a new market if there are NO unsettled expired markets.
  // If settlement failed for any market, skip creation — the next tick will retry.
  const remainingExpired = await prisma.market.count({
    where: { status: { in: ["OPEN", "CLOSED"] }, closeAt: { lte: now } },
  });

  if (remainingExpired > 0) {
    console.warn(`[cycle-markets] ${remainingExpired} expired market(s) still unsettled — skipping new market creation`);
    return { settled: settled.length, created: false, errors };
  }

  // Step 3: Atomic INSERT — WHERE NOT EXISTS prevents concurrent creation.
  // Fetch a fresh price for the new market's lock price.
  const startPrice = await getBtcPrice();
  const id = `mkt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const openAt  = now.toISOString();
  const closeAt = addMinutes(now, 15).toISOString();

  const result = await prisma.$queryRaw<{ inserted: boolean }[]>`
    INSERT INTO markets (id, question, "assetPair", category, "startPrice", "totalUp", "totalDown", "openAt", "closeAt", status, "createdAt", "updatedAt")
    SELECT ${id}, 'What will BTC/USD be in 15 minutes?', 'BTC/USD', 'crypto',
           ${startPrice}::numeric, 0, 0,
           ${openAt}::timestamptz, ${closeAt}::timestamptz,
           'OPEN'::"MarketStatus", NOW(), NOW()
    WHERE NOT EXISTS (SELECT 1 FROM markets WHERE status = 'OPEN')
    RETURNING id
  `;

  const created = result.length > 0;
  if (created) {
    console.log(`[cycle-markets] Created new market @ ${startPrice}`);
  }

  return { settled: settled.length, created, ...(errors.length > 0 ? { errors } : {}) };
}

export async function POST(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runCycle(new Date());
    return NextResponse.json(result);
  } catch (err) {
    console.error("[cycle-markets]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await runCycle(new Date());
    return NextResponse.json(result);
  } catch (err) {
    console.error("[cycle-markets]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
