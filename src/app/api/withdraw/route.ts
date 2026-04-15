import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { sendTransfer } from "@/lib/canton";
import { consumeChallengeForParty } from "@/app/api/auth/challenge/route";
import forge from "node-forge";

// Canton party ID format: <alias>::<hex-fingerprint>
// Same regex used at session creation — re-validated here as defense in depth
// before we ever attempt an on-chain transfer to this address.
const PARTY_ID_RE = /^[A-Za-z0-9_-]{1,128}::[0-9a-f]{8,}$/i;

function verifyEd25519(publicKeyHex: string, message: string, signatureHex: string): boolean {
  try {
    return forge.pki.ed25519.verify({
      message,
      encoding: "utf8",
      publicKey: forge.util.hexToBytes(publicKeyHex),
      signature: forge.util.hexToBytes(signatureHex),
    });
  } catch {
    return false;
  }
}

const MIN_WITHDRAWAL = 0.00001; // 1000 satoshis
const MAX_WITHDRAWAL = 100;     // 100 CBTC hard cap

// Round to 8 decimal places (1 satoshi precision)
function roundSats(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

// In-memory lock: one active withdrawal per user at a time.
// PRIMARY purpose: avoid firing two on-chain calls for the same user on the same process.
// NOT a distributed lock — multiple Railway containers won't share this Set.
// The real overdraft guard is the DB atomic deduct (WHERE appBalance >= amount).
// The real duplicate-send guard is the DB unique constraint on txId + PENDING status check below.
const activeWithdrawals = new Set<string>();

/**
 * POST /api/withdraw
 *
 * Failure guarantees:
 *
 *   BEFORE on-chain call (Step 1):
 *     - DB $transaction fails → nothing deducted, nothing sent. User retries safely.
 *     - WHERE appBalance >= amount fails → P2025 → "Insufficient balance". Safe.
 *
 *   DURING on-chain call (Step 2 throws):
 *     - Canton threw a clear error → rollback: refund balance + mark FAILED in $transaction.
 *     - If rollback itself throws → CRITICAL: withdrawal stays PENDING, balance stays deducted.
 *       Caught and logged as "[withdraw] ROLLBACK FAILED" — ops must reconcile manually.
 *       No double-send happened (Canton threw), but user is missing balance until ops fix it.
 *
 *   AFTER on-chain call, BEFORE Step 3 (process crash / timeout):
 *     - Transfer happened on-chain. DB has PENDING withdrawal, no txId.
 *     - Balance was already deducted. No double-send — user got funds.
 *     - The withdrawal stays PENDING. Reconciliation: any PENDING withdrawal older than
 *       10 minutes with no txId is a candidate for manual review.
 *     - The user receives a 500/504 response, but their on-chain balance is correct.
 *       They can contact support — we can verify on-chain via the memo (PUNT-WITHDRAW-<id>).
 *
 *   DURING Step 3 (CONFIRMED write fails):
 *     - Same as process crash above — transfer succeeded, PENDING stuck.
 *     - We attempt the CONFIRMED write in a finally block with a fallback log so ops
 *       can locate it: "[withdraw] CONFIRMED write failed — txId orphaned".
 *
 *   DUPLICATE prevention:
 *     - In-memory lock: blocks second request on same process instance.
 *     - DB: before Step 2, we verify no other PENDING withdrawal exists for this user.
 *       If one does, we refuse — the earlier attempt may have already sent on-chain.
 *     - txId @unique constraint: if somehow two CONFIRMED writes land the same txId, DB rejects the second.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;
    const { partyId } = auth;

    // Re-validate partyId format before any money movement.
    if (!PARTY_ID_RE.test(partyId)) {
      console.error("[withdraw] Invalid partyId format in JWT:", partyId);
      return NextResponse.json({ error: "Invalid account — contact support" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { amount: rawAmount, challenge, signature } = body as Record<string, unknown>;

    // --- Wallet ownership re-verification ---
    if (!challenge || typeof challenge !== "string") {
      return NextResponse.json({ error: "Challenge required" }, { status: 400 });
    }
    if (!signature || typeof signature !== "string" || !/^[0-9a-fA-F]+$/.test(signature)) {
      return NextResponse.json({ error: "Signature required" }, { status: 400 });
    }

    // Consume challenge — one-time use, validates it hasn't expired
    const storedChallenge = consumeChallengeForParty(partyId);
    if (!storedChallenge || storedChallenge !== challenge) {
      return NextResponse.json(
        { error: "Challenge expired or invalid. Request a new one." },
        { status: 401 }
      );
    }

    const userForVerify = await prisma.user.findUnique({ where: { partyId } });
    if (!userForVerify?.publicKey) {
      return NextResponse.json(
        { error: "No public key on file. Please reconnect your wallet." },
        { status: 401 }
      );
    }

    if (!verifyEd25519(userForVerify.publicKey, challenge, signature)) {
      console.warn("[withdraw] Signature verification failed for partyId:", partyId);
      return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
    }

    if (
      typeof rawAmount !== "number" ||
      !isFinite(rawAmount) ||
      rawAmount < MIN_WITHDRAWAL ||
      rawAmount > MAX_WITHDRAWAL
    ) {
      return NextResponse.json(
        { error: `Amount must be between ${MIN_WITHDRAWAL} and ${MAX_WITHDRAWAL} CBTC` },
        { status: 400 }
      );
    }

    const amount = roundSats(rawAmount);
    if (amount < MIN_WITHDRAWAL || amount <= 0) {
      return NextResponse.json({ error: "Amount too small after precision rounding" }, { status: 400 });
    }

    // Per-process lock — blocks concurrent requests on the same server instance
    if (activeWithdrawals.has(partyId)) {
      return NextResponse.json(
        { error: "A withdrawal is already being processed. Please wait." },
        { status: 429 }
      );
    }
    activeWithdrawals.add(partyId);

    try {
      const user = await prisma.user.findUnique({ where: { partyId } });
      if (!user) {
        return NextResponse.json({ error: "User not found" }, { status: 404 });
      }

      // Pre-check balance (fail fast — real guard is the atomic deduct below)
      if (user.appBalance.toNumber() < amount) {
        return NextResponse.json({ error: "Insufficient balance" }, { status: 400 });
      }

      // --- Step 1: Atomically deduct balance + create PENDING withdrawal record ---
      //
      // Duplicate-request protection is enforced at TWO levels:
      //
      //   Level 1 — application (above): in-memory lock blocks concurrent requests
      //   on the same server process.
      //
      //   Level 2 — database: a partial unique index on (userId) WHERE status='PENDING'
      //   means only ONE pending withdrawal per user can exist in the DB at any time.
      //   If a second request races through (different server instance, async interleave),
      //   the $transaction INSERT throws P2002 — before any balance is touched.
      //   This is the real guard. The application check below is just a fast-fail
      //   that produces a clearer error message before hitting the DB constraint.
      //
      // Deduct BEFORE on-chain call. WHERE appBalance >= amount prevents overdraft at DB level.
      const pendingWithdrawal = await prisma.withdrawal.findFirst({
        where: { userId: user.id, status: "PENDING" },
      });
      if (pendingWithdrawal) {
        console.warn(
          `[withdraw] Blocked duplicate — PENDING withdrawal ${pendingWithdrawal.id} exists for user ${user.id}`
        );
        return NextResponse.json(
          { error: "A previous withdrawal is still pending. If this persists, contact support." },
          { status: 409 }
        );
      }

      let withdrawalId: string;
      let deductedBalance: number;

      try {
        const [withdrawal, updated] = await prisma.$transaction([
          prisma.withdrawal.create({
            data: { userId: user.id, amount, status: "PENDING" },
          }),
          prisma.user.update({
            where: { id: user.id, appBalance: { gte: amount } },
            data: { appBalance: { decrement: amount } },
          }),
        ]);
        withdrawalId = withdrawal.id;
        deductedBalance = updated.appBalance.toNumber();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        if (msg.includes("P2025") || msg.includes("Record to update not found")) {
          return NextResponse.json({ error: "Insufficient balance" }, { status: 400 });
        }
        // P2002 = unique constraint violation on withdrawals_one_pending_per_user index.
        // A concurrent request already created a PENDING withdrawal — this one loses the race.
        // No balance was touched. Safe to reject.
        if (msg.includes("P2002") || msg.includes("Unique constraint")) {
          console.warn(`[withdraw] P2002 race blocked duplicate withdrawal for user ${user.id}`);
          return NextResponse.json(
            { error: "A previous withdrawal is still pending. If this persists, contact support." },
            { status: 409 }
          );
        }
        throw err;
      }

      // Memo embeds withdrawalId so on-chain transactions can be matched to DB records.
      // Format: PUNT-WITHDRAW-<cuid> — searchable in Canton ledger explorer.
      const memo = `PUNT-WITHDRAW-${withdrawalId}`;

      // --- Step 2: Execute on-chain transfer ---
      let updateId: string;
      try {
        updateId = await sendTransfer(partyId, amount, memo);
      } catch (onChainErr) {
        // Canton threw a clear error — transfer did NOT happen.
        // Roll back: refund balance + mark withdrawal FAILED.
        const errMsg = onChainErr instanceof Error ? onChainErr.message : String(onChainErr);
        console.error("[withdraw] On-chain transfer failed, rolling back:", errMsg);

        try {
          await prisma.$transaction([
            prisma.user.update({
              where: { id: user.id },
              data: { appBalance: { increment: amount } },
            }),
            prisma.withdrawal.update({
              where: { id: withdrawalId },
              data: { status: "FAILED" },
            }),
          ]);
        } catch (rollbackErr) {
          // CRITICAL: rollback failed — user's balance is missing from DB but no transfer happened.
          // Ops must manually: UPDATE withdrawals SET status='FAILED' WHERE id=<id>;
          //                    UPDATE users SET app_balance = app_balance + <amount> WHERE id=<userId>;
          console.error(
            `[withdraw] ROLLBACK FAILED for withdrawal ${withdrawalId} — manual reconciliation required.`,
            `userId=${user.id} amount=${amount} CBTC`,
            rollbackErr
          );
        }

        return NextResponse.json(
          { error: "On-chain transfer failed. Your balance has been restored." },
          { status: 502 }
        );
      }

      // Validate the updateId returned by Canton is a real identifier, not the "ok" fallback.
      // "ok" means Canton's SDK didn't return a recognisable field — we can't dedup by it.
      if (!updateId || updateId === "ok") {
        console.error(
          `[withdraw] Canton returned no updateId for withdrawal ${withdrawalId}. ` +
          `Transfer likely succeeded — marking CONFIRMED without txId for manual review.`
        );
        // Don't refund — the transfer probably happened. Mark CONFIRMED with a synthetic
        // traceable ID so ops can find it in the ledger by memo (PUNT-WITHDRAW-<id>).
        updateId = `MISSING-${withdrawalId}`;
      }

      // --- Step 3: Mark withdrawal CONFIRMED ---
      // Transfer already happened on-chain. Even if this write fails (DB down, process crash),
      // the user has their CBTC. The worst outcome is a stuck PENDING row — not a double send.
      // We log with enough detail for ops to reconcile without user impact.
      try {
        await prisma.withdrawal.update({
          where: { id: withdrawalId },
          data: { status: "CONFIRMED", txId: updateId },
        });
      } catch (confirmErr) {
        // Transfer succeeded on-chain but we couldn't write CONFIRMED.
        // Withdrawal is PENDING in DB. Balance was already deducted. No money lost.
        // Ops: UPDATE withdrawals SET status='CONFIRMED', tx_id='<updateId>' WHERE id='<withdrawalId>';
        console.error(
          `[withdraw] CONFIRMED write failed — transfer succeeded on-chain but DB not updated. ` +
          `withdrawalId=${withdrawalId} txId=${updateId} userId=${user.id} amount=${amount} CBTC`,
          confirmErr
        );
        // Still return success to the client — they got the funds. The DB inconsistency is ops' problem.
      }

      console.log(`[withdraw] ${amount} CBTC → ${partyId} | withdrawalId=${withdrawalId} txId=${updateId}`);
      return NextResponse.json({
        success: true,
        amount,
        txId: updateId,
        appBalance: deductedBalance,
      });

    } finally {
      activeWithdrawals.delete(partyId);
    }

  } catch (err) {
    console.error("[withdraw]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
