import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/transactions
 * Returns a unified chronological ledger of all money movements:
 *   deposit    — on-chain deposit credited to app balance
 *   withdrawal — app balance sent on-chain to user wallet
 *   bet        — debit when bet is placed
 *   payout     — credit when bet is won (payout amount)
 *   refund     — credit when bet is refunded (draw / no counterparty)
 */
export async function GET(req: NextRequest) {
  try {
    const partyId = await getSessionFromRequest(req);
    if (!partyId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findUnique({ where: { partyId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    const [deposits, withdrawals, bets] = await Promise.all([
      prisma.deposit.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.withdrawal.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      prisma.bet.findMany({
        where: { userId: user.id },
        orderBy: { placedAt: "desc" },
        take: 100,
        include: { market: { select: { question: true } } },
      }),
    ]);

    const txs = [
      // Deposits
      ...deposits.map((d) => ({
        id: `dep-${d.id}`,
        type: "deposit" as const,
        amount: d.amount.toNumber(),
        description: null,
        status: d.status,
        txId: d.txId ?? null,
        createdAt: d.createdAt.toISOString(),
      })),

      // Withdrawals
      ...withdrawals.map((w) => ({
        id: `wth-${w.id}`,
        type: "withdrawal" as const,
        amount: w.amount.toNumber(),
        description: null,
        status: w.status,
        txId: w.txId ?? null,
        createdAt: w.createdAt.toISOString(),
      })),

      // Bet placed (debit) — every bet regardless of outcome
      ...bets.map((b) => ({
        id: `bet-${b.id}`,
        type: "bet" as const,
        amount: b.amount.toNumber(),
        description: b.market?.question ?? null,
        direction: b.direction,
        status: b.status,
        txId: null,
        createdAt: b.placedAt.toISOString(),
      })),

      // Payout (credit) — only WON bets, settled amount
      ...bets
        .filter((b) => b.status === "WON" && b.payout != null && b.settledAt != null)
        .map((b) => ({
          id: `pay-${b.id}`,
          type: "payout" as const,
          amount: b.payout!.toNumber(),
          description: b.market?.question ?? null,
          direction: b.direction,
          status: "CONFIRMED",
          txId: null,
          createdAt: b.settledAt!.toISOString(),
        })),

      // Refund (credit) — REFUNDED bets
      ...bets
        .filter((b) => b.status === "REFUNDED" && b.settledAt != null)
        .map((b) => ({
          id: `ref-${b.id}`,
          type: "refund" as const,
          amount: b.amount.toNumber(),
          description: b.market?.question ?? null,
          direction: b.direction,
          status: "CONFIRMED",
          txId: null,
          createdAt: b.settledAt!.toISOString(),
        })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json(txs);
  } catch (err) {
    console.error("[GET /api/transactions]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
