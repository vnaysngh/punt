import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { verifyCronSecret } from "@/lib/cron-auth";

/**
 * GET /api/cron/reconcile-withdrawals
 *
 * Runs every 5 minutes. Heals withdrawals that got stuck PENDING because
 * the UI crashed, the server process was killed, or a network timeout
 * interrupted the flow between Step 1 (DB deduct) and Step 3 (CONFIRMED write).
 *
 * Two distinct stuck states, two different recovery actions:
 *
 * ── State A: PENDING, no txId, older than 12 minutes ──────────────────────
 *   Canton was given a 10-minute executeBefore window. If it's been 12 minutes
 *   and there's still no txId, one of two things happened:
 *
 *   (a) The server crashed BEFORE calling sendTransfer() — no on-chain transfer
 *       happened. The balance is stuck deducted in DB with no funds sent.
 *       → Safe to refund: mark FAILED, increment user balance.
 *
 *   (b) The server crashed AFTER sendTransfer() succeeded but BEFORE the CONFIRMED
 *       write — funds ARE on the ledger. Refunding would double-pay the user.
 *
 *   We can't tell (a) from (b) programmatically without querying the Canton ledger
 *   for the specific transaction, which requires the txId we don't have.
 *   However: the memo embedded in every withdrawal is `PUNT-WITHDRAW-<withdrawalId>`.
 *   That memo is searchable on the Canton ledger explorer. The cron logs the
 *   withdrawalId so ops can verify on-chain in ~30 seconds before deciding.
 *
 *   For safety: if the withdrawal is older than 12 minutes with no txId, we do NOT
 *   auto-refund. We log a loud REQUIRES_MANUAL_REVIEW alert with full details.
 *   Ops can verify on-chain and either:
 *     - Mark CONFIRMED manually (if Canton shows the transfer) → user already has funds
 *     - Mark FAILED + refund manually (if Canton shows nothing) → user gets balance back
 *
 *   The window for this situation is very small (Canton calls rarely take >10s), but
 *   the consequence of auto-refunding incorrectly (double-pay) is worse than requiring
 *   ops to spend 30 seconds checking. We prefer correctness over automation here.
 *
 * ── State B: PENDING, has txId starting with "MISSING-", any age ──────────
 *   This means sendTransfer() returned an unrecognised response (not update_id,
 *   not command_id). The transfer very likely succeeded — we just couldn't prove it.
 *   The CONFIRMED write succeeded with a synthetic txId for traceability.
 *   → Log for ops to verify on-chain and update txId with the real one if found.
 *   → These are already CONFIRMED in the DB (the write succeeded), so they're
 *     not actually stuck — this cron doesn't touch them, just surfaces them.
 *
 * ── State C: PENDING, has real txId, older than 12 minutes ────────────────
 *   This should never happen in normal operation — the only way to have a txId
 *   without CONFIRMED status is if the CONFIRMED update failed after a successful
 *   sendTransfer(). The Step 3 catch block in withdraw/route.ts logs this case.
 *   → Auto-fix: mark CONFIRMED. The txId proves the transfer happened.
 */

// A PENDING withdrawal with no txId older than this is flagged for manual review.
// Must be > Canton's executeBefore window (10 min) so expired transfers are included.
const STUCK_THRESHOLD_MS = 12 * 60 * 1000; // 12 minutes

export async function GET(req: NextRequest) {
  if (!verifyCronSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const cutoff = new Date(Date.now() - STUCK_THRESHOLD_MS);

    const stuckWithdrawals = await prisma.withdrawal.findMany({
      where: { status: "PENDING" },
      include: { user: { select: { id: true, partyId: true, appBalance: true } } },
      orderBy: { createdAt: "asc" },
    });

    if (stuckWithdrawals.length === 0) {
      return NextResponse.json({ ok: true, checked: 0 });
    }

    const results = [];

    for (const w of stuckWithdrawals) {
      const ageMs = Date.now() - w.createdAt.getTime();
      const ageMin = Math.round(ageMs / 60_000);

      // ── State C: has a real txId but still PENDING ──────────────────────
      // txId exists = sendTransfer() returned a recognised ID = transfer happened.
      // The CONFIRMED write must have failed. Auto-fix: mark CONFIRMED now.
      if (w.txId && !w.txId.startsWith("MISSING-")) {
        try {
          await prisma.withdrawal.update({
            where: { id: w.id },
            data: { status: "CONFIRMED" },
          });
          console.log(
            `[reconcile-withdrawals] AUTO-CONFIRMED withdrawal ${w.id} ` +
            `txId=${w.txId} userId=${w.user.id} amount=${w.amount} age=${ageMin}min`
          );
          results.push({ id: w.id, action: "AUTO_CONFIRMED", txId: w.txId, ageMin });
        } catch (err) {
          console.error(`[reconcile-withdrawals] Failed to auto-confirm ${w.id}:`, err);
          results.push({ id: w.id, action: "AUTO_CONFIRM_FAILED", error: String(err) });
        }
        continue;
      }

      // ── State B: has a MISSING- synthetic txId ──────────────────────────
      // Already CONFIRMED in DB (shouldn't be PENDING). Log for visibility.
      // If somehow it is PENDING with a MISSING- txId, treat same as State A.
      if (w.txId?.startsWith("MISSING-")) {
        console.warn(
          `[reconcile-withdrawals] SYNTHETIC_TXID withdrawal ${w.id} ` +
          `txId=${w.txId} userId=${w.user.id} partyId=${w.user.partyId} ` +
          `amount=${w.amount} age=${ageMin}min — verify on Canton ledger by memo PUNT-WITHDRAW-${w.id}`
        );
        results.push({ id: w.id, action: "SYNTHETIC_TXID_REVIEW", txId: w.txId, ageMin });
        continue;
      }

      // ── State A: no txId, check age ─────────────────────────────────────
      if (w.createdAt > cutoff) {
        // Less than 12 minutes old — still within Canton's execution window.
        // Could be actively processing. Don't touch it yet.
        results.push({ id: w.id, action: "WAIT", ageMin });
        continue;
      }

      // Older than 12 minutes, no txId.
      // We cannot safely auto-refund without knowing if Canton sent funds.
      // Log with everything ops needs to resolve in ~30 seconds:
      //   1. Search Canton ledger explorer for memo: PUNT-WITHDRAW-<id>
      //   2. If found: run  UPDATE withdrawals SET status='CONFIRMED', tx_id='<updateId>' WHERE id='<id>';
      //   3. If not found: run  UPDATE withdrawals SET status='FAILED' WHERE id='<id>';
      //                         UPDATE users SET app_balance = app_balance + <amount> WHERE id='<userId>';
      console.error(
        `[reconcile-withdrawals] REQUIRES_MANUAL_REVIEW — stuck PENDING withdrawal:\n` +
        `  withdrawalId : ${w.id}\n` +
        `  userId       : ${w.user.id}\n` +
        `  partyId      : ${w.user.partyId}\n` +
        `  amount       : ${w.amount} CBTC\n` +
        `  createdAt    : ${w.createdAt.toISOString()}\n` +
        `  age          : ${ageMin} minutes\n` +
        `  ledger memo  : PUNT-WITHDRAW-${w.id}\n` +
        `  action if transfer FOUND on-chain  : UPDATE withdrawals SET status='CONFIRMED', tx_id='<updateId>' WHERE id='${w.id}';\n` +
        `  action if transfer NOT found       : UPDATE withdrawals SET status='FAILED' WHERE id='${w.id}'; UPDATE users SET app_balance = app_balance + ${w.amount} WHERE id='${w.user.id}';`
      );
      results.push({
        id: w.id,
        action: "REQUIRES_MANUAL_REVIEW",
        partyId: w.user.partyId,
        amount: Number(w.amount),
        ageMin,
        ledgerMemo: `PUNT-WITHDRAW-${w.id}`,
      });
    }

    const summary = {
      ok: true,
      checked: stuckWithdrawals.length,
      autoConfirmed: results.filter((r) => r.action === "AUTO_CONFIRMED").length,
      waiting:       results.filter((r) => r.action === "WAIT").length,
      manualReview:  results.filter((r) => r.action === "REQUIRES_MANUAL_REVIEW").length,
      syntheticTxId: results.filter((r) => r.action === "SYNTHETIC_TXID_REVIEW").length,
      results,
    };

    console.log(`[reconcile-withdrawals] Done:`, JSON.stringify(summary, null, 2));
    return NextResponse.json(summary);

  } catch (err) {
    console.error("[reconcile-withdrawals]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
