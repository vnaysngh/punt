import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getPendingTransferInstructions, acceptTransferInstruction } from "@/lib/canton";
import { verifyCronSecret } from "@/lib/cron-auth";

/**
 * GET /api/cron/detect-deposits
 *
 * Runs every 2 minutes (see vercel.json).
 * Sweeps all TransferInstructions on-chain (including expired ones) and:
 *
 *  1. ACTIVE (not expired): accept on-chain + credit DB if not already processed.
 *     This is the fallback for deposits where the client-side 30s poll timed out.
 *
 *  2. EXPIRED + not in DB: the instruction timed out before we could accept it.
 *     The CBTC was NEVER transferred into our app wallet — it stays in the user's
 *     wallet (Canton auto-returns it when executeBefore passes). No money is lost.
 *     Log an alert so we're aware, but no DB action is needed.
 *
 *  3. EXPIRED + already in DB: we accepted it before it expired, cron is just seeing
 *     the confirmation event. Log and skip.
 *
 * Fully server-side — zero trust in frontend.
 */
export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Fetch ALL instructions, including expired — so we can detect and alert on lost ones
    const allInstructions = await getPendingTransferInstructions(true);
    const active  = allInstructions.filter((t) => !t.expired);
    const expired = allInstructions.filter((t) =>  t.expired);

    const results = [];

    // ── Active instructions: try to accept and credit ──────────────────────────
    for (const tx of active) {
      // Skip if already processed (by contractId)
      const existing = await prisma.deposit.findFirst({ where: { txId: tx.contractId } });
      if (existing) {
        results.push({ contractId: tx.contractId, amount: tx.amount, status: "already_processed" });
        continue;
      }

      // Check whether this transfer came through our app's deposit flow.
      // The memo is NOT a security check — anyone can write any memo. It's just a signal
      // that this transfer was initiated by our DepositModal (which sets PUNT-* memos).
      // The real identity check is senderPartyId below, which comes from Canton's on-chain
      // signing and cannot be spoofed.
      // Transfers without a PUNT-* memo are external / accidental — do NOT accept them.
      // Leaving them unaccepted means Canton will auto-return the CBTC to the sender
      // when their executeBefore window expires. No money is taken, no user is credited.
      const isOurMemo = /^PUNT-[A-Za-z0-9]{6,12}-\d{10,}$/.test(tx.memo);
      if (!isOurMemo) {
        console.warn(
          `[detect-deposits] UNRECOGNISED_MEMO — skipping (will auto-return to sender at executeBefore):\n` +
          `  contractId   : ${tx.contractId}\n` +
          `  senderPartyId: ${tx.senderPartyId}\n` +
          `  amount       : ${tx.amount} CBTC\n` +
          `  memo         : "${tx.memo}"`
        );
        results.push({
          contractId: tx.contractId,
          status: "unrecognised_memo",
          senderPartyId: tx.senderPartyId,
          amount: tx.amount,
          memo: tx.memo,
        });
        continue;
      }

      // Find user by senderPartyId — the on-chain sender must be a registered app user.
      // If they're not registered, we cannot attribute the deposit to anyone.
      // Do NOT accept — let it auto-return to the sender at executeBefore.
      const user = await prisma.user.findUnique({ where: { partyId: tx.senderPartyId } });
      if (!user) {
        console.warn(
          `[detect-deposits] UNREGISTERED_SENDER — skipping (will auto-return to sender at executeBefore):\n` +
          `  contractId   : ${tx.contractId}\n` +
          `  senderPartyId: ${tx.senderPartyId}\n` +
          `  amount       : ${tx.amount} CBTC\n` +
          `  memo         : "${tx.memo}"`
        );
        results.push({ contractId: tx.contractId, status: "unregistered_sender", senderPartyId: tx.senderPartyId, amount: tx.amount });
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

        console.log(`[detect-deposits] Credited ${tx.amount} CBTC to userId=${user.id} | updateId: ${updateId}`);
        results.push({ contractId: tx.contractId, amount: tx.amount, status: "credited", newBalance: updatedUser.appBalance.toNumber() });
      } catch (err) {
        console.error(`[detect-deposits] Failed to process ${tx.contractId}:`, err);
        results.push({ contractId: tx.contractId, status: "error", error: String(err) });
      }
    }

    // ── Expired instructions: detect if any were never credited ────────────────
    // If executeBefore passed without us accepting, Canton auto-returns the CBTC
    // to the sender's wallet. No money is lost — but we should know it happened
    // so we can communicate to users if they report a missing deposit.
    for (const tx of expired) {
      const existing = await prisma.deposit.findFirst({ where: { txId: tx.contractId } });
      if (existing) {
        // We accepted it before expiry — cron is seeing the expired confirmation. Fine.
        results.push({ contractId: tx.contractId, amount: tx.amount, status: "expired_already_processed" });
        continue;
      }

      // CBTC was never transferred into our wallet — user still has it.
      // This happens when: client timed out, cron also didn't run in time, and
      // the executeBefore window (set by user's wallet, typically 10 min) passed.
      // NO action needed — Canton auto-returned the funds. Just alert.
      console.error(
        `[detect-deposits] EXPIRED_UNPROCESSED_INSTRUCTION — CBTC auto-returned to sender:\n` +
        `  contractId   : ${tx.contractId}\n` +
        `  senderPartyId: ${tx.senderPartyId}\n` +
        `  amount       : ${tx.amount} CBTC\n` +
        `  memo         : ${tx.memo}\n` +
        `  NOTE: No balance was lost. Canton returned funds to the user automatically.\n` +
        `  If user reports a missing deposit, their CBTC is in their own wallet.`
      );
      results.push({
        contractId: tx.contractId,
        status: "expired_unprocessed",
        senderPartyId: tx.senderPartyId,
        amount: tx.amount,
        memo: tx.memo,
        note: "CBTC auto-returned to sender by Canton — no balance lost",
      });
    }

    const summary = {
      ok: true,
      active: active.length,
      expired: expired.length,
      credited:            results.filter((r) => r.status === "credited").length,
      alreadyProcessed:    results.filter((r) => r.status?.startsWith("already")).length,
      errors:              results.filter((r) => r.status === "error").length,
      expiredUnprocessed:  results.filter((r) => r.status === "expired_unprocessed").length,
      unrecognisedMemo:    results.filter((r) => r.status === "unrecognised_memo").length,
      unregisteredSender:  results.filter((r) => r.status === "unregistered_sender").length,
      results,
    };

    if (summary.expiredUnprocessed > 0) {
      console.error(`[detect-deposits] ${summary.expiredUnprocessed} expired instruction(s) went unprocessed — users retain their CBTC`);
    }
    if (summary.errors > 0) {
      console.error(`[detect-deposits] ${summary.errors} instruction(s) failed to process — will retry next cron tick`);
    }

    console.log(`[detect-deposits] Done:`, JSON.stringify({ ...summary, results: undefined }));
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[detect-deposits]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
