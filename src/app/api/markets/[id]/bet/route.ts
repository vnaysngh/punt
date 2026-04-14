import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import type { Bet, User } from "@prisma/client";

const MIN_BET = 0.00001; // 1000 satoshis — prevents spam/dust bets
const MAX_BET = 1_000;   // 1000 CBTC hard cap

// Round to 8 decimal places (1 satoshi precision) to kill floating-point noise
function roundSats(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: marketId } = await params;

    // partyId comes exclusively from signed JWT — never from request body
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;
    const { partyId } = auth;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    // Destructure only what we need — ignore any partyId the client sneaks in
    const { direction, amount: rawAmount } = body as Record<string, unknown>;

    if (!["UP", "DOWN"].includes(direction as string)) {
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
    const amount = roundSats(rawAmount as number);

    // Re-validate after rounding (rounding could push below minimum)
    if (amount < MIN_BET) {
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
    // Hard close-time check — reject bets within 5s of close to prevent
    // last-millisecond bets that land after settlement starts
    if (Date.now() >= market.closeAt.getTime() - 5_000) {
      return NextResponse.json({ error: "Market is closing — betting window ended" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { partyId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    let bet: Bet;
    let updatedUser: User;
    try {
      [bet, updatedUser] = await prisma.$transaction(async (tx) => {
        // One bet per user per market — also backed by @@unique([userId, marketId])
        const existing = await tx.bet.findFirst({ where: { userId: user.id, marketId } });
        if (existing) throw new Error("DUPLICATE_BET");

        // Re-check market inside the transaction — cron could have closed it
        const liveMarket = await tx.market.findUnique({ where: { id: marketId } });
        if (!liveMarket || liveMarket.status !== "OPEN" || Date.now() >= liveMarket.closeAt.getTime() - 5_000) {
          throw new Error("MARKET_CLOSED");
        }

        // Atomic deduct — WHERE appBalance >= amount prevents overdraft at DB level
        const updated = await tx.user.update({
          where: { id: user.id, appBalance: { gte: amount } },
          data:  { appBalance: { decrement: amount } },
        });

        const newBet = await tx.bet.create({
          data: { userId: user.id, marketId, direction: direction as string, amount, status: "PENDING" },
        });

        await tx.market.update({
          where: { id: marketId },
          data: {
            totalUp:   direction === "UP"   ? { increment: amount } : undefined,
            totalDown: direction === "DOWN" ? { increment: amount } : undefined,
          },
        });

        return [newBet, updated] as [Bet, User];
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (msg === "DUPLICATE_BET") {
        return NextResponse.json({ error: "You already have a bet on this market" }, { status: 409 });
      }
      if (msg === "MARKET_CLOSED") {
        return NextResponse.json({ error: "Market closed before your bet was processed" }, { status: 409 });
      }
      if (msg.includes("P2025") || msg.includes("Record to update not found")) {
        return NextResponse.json({ error: "Insufficient app balance" }, { status: 400 });
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
