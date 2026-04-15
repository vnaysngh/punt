import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { sendTransfer } from "@/lib/canton";

// Canton party ID format: <alias>::<hex-fingerprint>
// Same regex used at session creation — re-validated here as defense in depth
// before we ever attempt an on-chain transfer to this address.
const PARTY_ID_RE = /^[A-Za-z0-9_-]{1,128}::[0-9a-f]{8,}$/i;

const MIN_WITHDRAWAL = 0.00001; // 1000 satoshis
const MAX_WITHDRAWAL = 100;     // 100 CBTC hard cap

// Round to 8 decimal places (1 satoshi precision)
function roundSats(n: number): number {
  return Math.round(n * 1e8) / 1e8;
}

// In-memory lock: one active withdrawal per user at a time.
// Prevents concurrent requests from both passing the balance check
// before either deducts (TOCTOU). The DB atomic deduct is the real
// guard, but this avoids wasted on-chain attempts.
const activeWithdrawals = new Set<string>();

/**
 * POST /api/withdraw
 *
 * Body: { amount: number }
 *
 * Security guarantees:
 *   1. partyId from signed JWT — never from request body
 *   2. Amount range-checked and clamped to satoshi precision
 *   3. Balance deducted atomically in DB with WHERE appBalance >= amount
 *      before any on-chain call — prevents overdraft at DB level
 *   4. On-chain transfer happens AFTER DB deduct — if it fails, DB is rolled back
 *   5. Withdrawal record written atomically with balance deduct
 *   6. Per-user in-memory lock prevents concurrent withdrawal races
 *   7. txId unique constraint on withdrawals table as final dedup guard
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;
    const { partyId } = auth;

    // Re-validate partyId format before any money movement.
    // The partyId was validated at session creation, but we enforce it again
    // here so a corrupt DB value can never trigger an on-chain transfer.
    if (!PARTY_ID_RE.test(partyId)) {
      console.error("[withdraw] Invalid partyId format in JWT:", partyId);
      return NextResponse.json({ error: "Invalid account — contact support" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { amount: rawAmount } = body as Record<string, unknown>;

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

    // Per-user lock — one withdrawal at a time
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

      // Pre-check balance (fail fast before entering transaction)
      if (user.appBalance.toNumber() < amount) {
        return NextResponse.json({ error: "Insufficient balance" }, { status: 400 });
      }

      // --- Step 1: Atomically deduct balance + create PENDING withdrawal record ---
      // We deduct BEFORE the on-chain transfer so the user can't double-spend
      // by firing concurrent requests. The WHERE appBalance >= amount clause
      // prevents overdraft at the DB level even if the pre-check above raced.
      let withdrawalId: string;
      let updatedUser: { appBalance: { toNumber(): number } };

      try {
        const [withdrawal, updated] = await prisma.$transaction([
          prisma.withdrawal.create({
            data: {
              userId: user.id,
              amount,
              status: "PENDING",
            },
          }),
          prisma.user.update({
            where: { id: user.id, appBalance: { gte: amount } },
            data: { appBalance: { decrement: amount } },
          }),
        ]);
        withdrawalId = withdrawal.id;
        updatedUser = updated;
      } catch (err) {
        const msg = err instanceof Error ? err.message : "";
        // P2025 = record to update not found = WHERE appBalance >= amount failed
        if (msg.includes("P2025") || msg.includes("Record to update not found")) {
          return NextResponse.json({ error: "Insufficient balance" }, { status: 400 });
        }
        throw err;
      }

      // --- Step 2: Execute on-chain transfer ---
      // If this fails, roll back the DB deduct so the user gets their balance back.
      const memo = `PUNT-WITHDRAW-${withdrawalId}`;
      let updateId: string;

      try {
        updateId = await sendTransfer(partyId, amount, memo);
      } catch (onChainErr) {
        // On-chain failed — roll back: refund balance + mark withdrawal FAILED
        const errMsg = onChainErr instanceof Error ? onChainErr.message : String(onChainErr);
        console.error("[withdraw] On-chain transfer failed, rolling back:", errMsg);
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
        return NextResponse.json(
          { error: "On-chain transfer failed. Your balance has been restored." },
          { status: 502 }
        );
      }

      // --- Step 3: Mark withdrawal CONFIRMED with txId ---
      await prisma.withdrawal.update({
        where: { id: withdrawalId },
        data: { status: "CONFIRMED", txId: updateId },
      });

      console.log(`[withdraw] ${amount} CBTC → ${partyId} | updateId: ${updateId}`);
      return NextResponse.json({
        success: true,
        amount,
        txId: updateId,
        appBalance: updatedUser.appBalance.toNumber(),
      });

    } finally {
      activeWithdrawals.delete(partyId);
    }

  } catch (err) {
    console.error("[withdraw]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
