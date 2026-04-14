import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";

const MIN_BET    = 0.00001; // 1000 satoshis — prevents spam/dust bets
const MAX_BET    = 1_000;   // 1000 CBTC hard cap
const LOCK_BUFFER_MS = 5 * 60 * 1000; // 5 minutes — betting locks 5 min before round close
const VALID_DIRECTIONS = new Set(["UP", "DOWN"]); // strict whitelist — DB stores as VARCHAR

// Round to 8 decimal places (1 satoshi precision) to kill floating-point noise
function roundSats(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

/**
 * POST /api/markets/[id]/bet
 *
 * Security guarantees:
 *   1. partyId comes from signed JWT — never from request body
 *   2. direction is strictly whitelisted (UP or DOWN) before it touches DB
 *   3. amount is clamped to satoshi precision, range-checked, and verified > 0
 *   4. One bet per user per market — enforced BOTH in transaction AND by @@unique DB constraint
 *   5. Balance is deducted atomically with WHERE appBalance >= amount (prevents overdraft)
 *   6. Market status + lock time re-checked INSIDE the transaction (prevents cron race)
 *   7. 5-minute lock buffer before close prevents last-second exploitation
 *   8. Market must not have already closed (closeAt > now)
 *   9. Request body is validated — extra fields are ignored
 *  10. P2002 (unique constraint) caught as fallback for concurrent duplicate bet race
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: marketId } = await params;

    // Validate market ID format (prevent injection of weird strings)
    if (!marketId || marketId.length > 100) {
      return NextResponse.json({ error: "Invalid market ID" }, { status: 400 });
    }

    // partyId comes exclusively from signed JWT — never from request body
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;
    const { partyId } = auth;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // Destructure only what we need — ignore any partyId/userId the client sneaks in
    const { direction, amount: rawAmount } = body as Record<string, unknown>;

    // Strict enum check — only exact "UP" or "DOWN", no trimming, no case folding
    if (typeof direction !== "string" || !VALID_DIRECTIONS.has(direction)) {
      return NextResponse.json({ error: "direction must be UP or DOWN" }, { status: 400 });
    }

    if (
      typeof rawAmount !== "number" ||
      !isFinite(rawAmount) ||
      rawAmount < MIN_BET ||
      rawAmount > MAX_BET
    ) {
      return NextResponse.json(
        { error: `Amount must be between ${MIN_BET} and ${MAX_BET} CBTC` },
        { status: 400 }
      );
    }

    // Clamp to satoshi precision — prevents sub-satoshi manipulation
    const amount = roundSats(rawAmount);

    // Re-validate after rounding (rounding could push below minimum)
    if (amount < MIN_BET || amount <= 0) {
      return NextResponse.json({ error: "Amount too small after precision rounding" }, { status: 400 });
    }

    // Verify market is open — do it before user lookup to fail fast
    const market = await prisma.market.findUnique({ where: { id: marketId } });
    if (!market) {
      return NextResponse.json({ error: "Market not found" }, { status: 404 });
    }
    if (market.status !== "OPEN") {
      return NextResponse.json({ error: "Market is not open" }, { status: 400 });
    }

    const now = Date.now();

    // Reject if market close time is already in the past (clock skew safety)
    if (now >= market.closeAt.getTime()) {
      return NextResponse.json({ error: "Market has already closed" }, { status: 400 });
    }

    // Betting locks 5 minutes before round close.
    // 15-min round = 10 min betting window + 5 min locked (price-only phase).
    // Prevents last-minute bets that exploit visible price trends near close.
    const lockTime = market.closeAt.getTime() - LOCK_BUFFER_MS;
    if (now >= lockTime) {
      const secsLeft = Math.max(0, Math.ceil((market.closeAt.getTime() - now) / 1000));
      return NextResponse.json(
        { error: `Betting is locked. Round closes in ${secsLeft}s. Wait for the next round.` },
        { status: 400 }
      );
    }

    const user = await prisma.user.findUnique({ where: { partyId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Pre-check balance before entering transaction (fail fast, reduce DB contention)
    if (user.appBalance.toNumber() < amount) {
      return NextResponse.json({ error: "Insufficient app balance" }, { status: 400 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let bet: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let updatedUser: any;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      [bet, updatedUser] = await prisma.$transaction(async (tx: any) => {
        // One bet per user per market — also backed by @@unique([userId, marketId])
        const existing = await tx.bet.findFirst({ where: { userId: user.id, marketId } });
        if (existing) throw new Error("DUPLICATE_BET");

        // Re-check market inside the transaction — cron could have closed it
        const liveMarket = await tx.market.findUnique({ where: { id: marketId } });
        if (!liveMarket || liveMarket.status !== "OPEN") {
          throw new Error("MARKET_CLOSED");
        }
        // Re-check lock time inside transaction
        const txNow = Date.now();
        if (txNow >= liveMarket.closeAt.getTime() - LOCK_BUFFER_MS) {
          throw new Error("MARKET_CLOSED");
        }

        // Atomic deduct — WHERE appBalance >= amount prevents overdraft at DB level
        // This is the REAL balance check — the pre-check above is just an optimization
        const updated = await tx.user.update({
          where: { id: user.id, appBalance: { gte: amount } },
          data:  { appBalance: { decrement: amount } },
        });

        const newBet = await tx.bet.create({
          data: {
            userId: user.id,
            marketId,
            direction,       // already validated to be exactly "UP" or "DOWN"
            amount,
            status: "PENDING",
          },
        });

        await tx.market.update({
          where: { id: marketId },
          data: {
            totalUp:   direction === "UP"   ? { increment: amount } : undefined,
            totalDown: direction === "DOWN" ? { increment: amount } : undefined,
          },
        });

        return [newBet, updated];
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "DUPLICATE_BET") {
        return NextResponse.json({ error: "You already have a bet on this market" }, { status: 409 });
      }
      if (msg === "MARKET_CLOSED") {
        return NextResponse.json({ error: "Market closed before your bet was processed" }, { status: 409 });
      }
      // Prisma P2025 = "Record to update not found" → balance WHERE clause failed
      if (msg.includes("P2025") || msg.includes("Record to update not found")) {
        return NextResponse.json({ error: "Insufficient app balance" }, { status: 400 });
      }
      // Prisma P2002 = unique constraint violation → duplicate bet race condition
      if (msg.includes("P2002") || msg.includes("Unique constraint")) {
        return NextResponse.json({ error: "You already have a bet on this market" }, { status: 409 });
      }
      throw err;
    }

    return NextResponse.json({
      bet: { ...bet, amount: bet.amount.toNumber(), payout: bet.payout?.toNumber() ?? null },
      appBalance: updatedUser.appBalance.toNumber(),
    }, { status: 201 });
  } catch (err) {
    console.error("[bet]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
