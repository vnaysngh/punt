import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSessionFromRequest } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * GET /api/transactions
 * Returns combined deposit + withdrawal history for the authenticated user.
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

    const [deposits, withdrawals] = await Promise.all([
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
    ]);

    const txs = [
      ...deposits.map((d) => ({
        id: d.id,
        type: "deposit" as const,
        amount: d.amount.toNumber(),
        status: d.status,
        txId: d.txId ?? null,
        createdAt: d.createdAt.toISOString(),
      })),
      ...withdrawals.map((w) => ({
        id: w.id,
        type: "withdrawal" as const,
        amount: w.amount.toNumber(),
        status: w.status,
        txId: w.txId ?? null,
        createdAt: w.createdAt.toISOString(),
      })),
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return NextResponse.json(txs);
  } catch (err) {
    console.error("[GET /api/transactions]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
