import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPendingTransferInstructions, acceptTransferInstruction } from "@/lib/canton";
import { verifyCronSecret } from "@/lib/cron-auth";

/**
 * GET /api/cron/detect-deposits
 *
 * Runs every 5 minutes (see vercel.json).
 * Sweeps all pending TransferInstructions on-chain and credits any that
 * haven't been processed yet. This is the fallback for deposits where the
 * immediate 15s poll in /api/deposit timed out.
 *
 * Fully server-side — zero trust in frontend.
 */
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const pending = await getPendingTransferInstructions();
    const results = [];

    for (const tx of pending) {
      // Skip if already processed (by contractId)
      const existing = await prisma.deposit.findFirst({ where: { txId: tx.contractId } });
      if (existing) continue;

      // Find user by senderPartyId
      const user = await prisma.user.findUnique({ where: { partyId: tx.senderPartyId } });
      if (!user) {
        console.warn(`[detect-deposits] No user found for partyId: ${tx.senderPartyId}`);
        continue;
      }

      try {
        // Accept on-chain
        const updateId = await acceptTransferInstruction(tx.contractId, tx.provider);

        // Credit DB — unique constraint on txId prevents double-credit
        // if /api/deposit already processed this transfer concurrently
        let updatedUser;
        try {
          [, updatedUser] = await prisma.$transaction([
            prisma.deposit.create({
              data: {
                userId: user.id,
                amount: parseFloat(tx.amount),
                txId: tx.contractId,
                status: "CONFIRMED",
              },
            }),
            prisma.user.update({
              where: { id: user.id },
              data: { appBalance: { increment: parseFloat(tx.amount) } },
            }),
          ]);
        } catch (txErr: unknown) {
          // Unique constraint violation = /api/deposit already credited this
          const isUniqueViolation =
            txErr instanceof Error &&
            (txErr.message.includes("Unique constraint") || txErr.message.includes("P2002"));
          if (isUniqueViolation) {
            console.log(`[detect-deposits] Already processed ${tx.contractId} (dedup)`);
            results.push({ contractId: tx.contractId, amount: tx.amount, status: "already_processed" });
            continue;
          }
          throw txErr;
        }

        console.log(`[detect-deposits] Credited ${tx.amount} CBTC | updateId: ${updateId}`);
        results.push({ contractId: tx.contractId, amount: tx.amount, newBalance: updatedUser.appBalance.toNumber() });
      } catch (err) {
        console.error(`[detect-deposits] Failed to process ${tx.contractId}:`, err);
        results.push({ contractId: tx.contractId, error: String(err) });
      }
    }

    return NextResponse.json({ processed: results.length, results });
  } catch (err) {
    console.error("[detect-deposits]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
