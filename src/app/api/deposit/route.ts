import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/deposit
// Called after user sends cBTC from their wallet to the app party
// We verify and credit app balance
export async function POST(req: NextRequest) {
  try {
    const { partyId, amount, txId } = await req.json();

    if (!partyId || !amount || amount <= 0) {
      return NextResponse.json({ error: "Invalid params" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { partyId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // In production: verify txId on Canton ledger before crediting
    // For now we trust the submission confirmation
    const [deposit, updatedUser] = await prisma.$transaction([
      prisma.deposit.create({
        data: {
          userId: user.id,
          amount,
          txId: txId ?? null,
          status: "CONFIRMED",
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { appBalance: { increment: amount } },
      }),
    ]);

    return NextResponse.json({ deposit, appBalance: updatedUser.appBalance });
  } catch (err) {
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
