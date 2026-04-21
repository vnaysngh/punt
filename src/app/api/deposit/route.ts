import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireAuth } from "@/lib/api-auth";
import { getPendingTransferInstructions, acceptTransferInstruction } from "@/lib/canton";

const MIN_DEPOSIT = 0.0001; // 10,000 satoshis — minimum viable deposit
const MAX_DEPOSIT = 100;    // 100 CBTC

// In-memory lock to prevent same user from running concurrent deposit polls.
// Without this, a user could open 10 tabs and hammer /api/deposit concurrently,
// and while the DB unique constraint prevents double-credit, they'd still waste
// server resources with 10 parallel 30s polling loops.
const activeDeposits = new Set<string>();

/**
 * POST /api/deposit
 *
 * Client sends: { amount, memo }
 *   - amount: what the user claims to have sent (floor check, not ceiling)
 *   - memo:   unique string passed to loop.wallet.transfer() to find the TX on-chain
 *
 * Security guarantees:
 *   1. partyId comes from signed JWT — never from request body
 *   2. We match the on-chain TransferInstruction by BOTH memo AND senderPartyId
 *   3. On-chain amount must be >= claimed amount (we credit on-chain amount)
 *   4. We accept the transfer on-chain BEFORE crediting DB — no credit without settlement
 *   5. Dedup uses contractId as the unique key (DB unique constraint).
 *      memo is only used to FIND the TX — once found, contractId is the canonical key.
 *   6. The DB insert uses the unique constraint as an idempotency guard —
 *      concurrent requests for the same contractId will fail on constraint violation,
 *      not double-credit.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAuth(req);
    if (auth instanceof NextResponse) return auth;
    const { partyId } = auth;

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { amount, memo, transferInstructionCid } = body as Record<string, unknown>;

    if (
      typeof amount !== "number" ||
      !isFinite(amount) ||
      amount < MIN_DEPOSIT ||
      amount > MAX_DEPOSIT
    ) {
      return NextResponse.json(
        { error: `Amount must be between ${MIN_DEPOSIT} and ${MAX_DEPOSIT} CBTC` },
        { status: 400 }
      );
    }

    if (!memo || typeof memo !== "string" || memo.length > 128) {
      return NextResponse.json({ error: "memo required (max 128 chars)" }, { status: 400 });
    }

    // Validate memo format: PUNT-{8 chars}-{timestamp}
    if (!/^PUNT-[A-Za-z0-9]{6,12}-\d{10,}$/.test(memo)) {
      return NextResponse.json({ error: "Invalid memo format" }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { partyId } });
    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Prevent concurrent deposit polls from the same user
    if (activeDeposits.has(partyId)) {
      return NextResponse.json(
        { error: "A deposit is already being processed. Please wait." },
        { status: 429 }
      );
    }
    activeDeposits.add(partyId);

    try {
    // Poll the Canton ledger for the TransferInstruction.
    // If the client passed the contractId directly from the SDK result, use it to find fast.
    let matchedTx: Awaited<ReturnType<typeof getPendingTransferInstructions>>[0] | null = null;
    const deadline = Date.now() + 30_000;

    while (Date.now() < deadline) {
      const pending = await getPendingTransferInstructions();

      // Fast path: client supplied the contractId directly from SDK response.
      // Still verify senderPartyId matches the authenticated user — contractId alone
      // is not enough because a different user could theoretically supply someone
      // else's contractId and claim their deposit.
      if (transferInstructionCid && typeof transferInstructionCid === "string") {
        matchedTx = pending.find(
          (t) => t.contractId === transferInstructionCid && t.senderPartyId === partyId
        ) ?? null;
      }

      // Fallback: match by memo + sender + amount
      if (!matchedTx) {
        matchedTx = pending.find(
          (t) =>
            t.memo === memo &&
            t.senderPartyId === partyId &&
            parseFloat(t.amount) >= (amount as number)
        ) ?? null;
      }

      if (matchedTx) break;
      await new Promise((r) => setTimeout(r, 2_000));
    }

    if (!matchedTx) {
      return NextResponse.json(
        { error: "Transfer not found on-chain. It may still be pending — try again in a moment." },
        { status: 404 }
      );
    }

    // Already processed? Return current balance — idempotent.
    const alreadyProcessed = await prisma.deposit.findUnique({
      where: { txId: matchedTx.contractId },
    });
    if (alreadyProcessed) {
      const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
      return NextResponse.json({ appBalance: (freshUser?.appBalance ?? user.appBalance).toNumber() });
    }

    // Accept on-chain — settles the CBTC transfer to app wallet.
    // This must happen BEFORE we credit the DB balance.
    const updateId = await acceptTransferInstruction(matchedTx.contractId, matchedTx.provider);

    // Atomically write deposit record + credit balance.
    // The unique constraint on txId (contractId) is the final race guard:
    // if two requests somehow both reach this point, one will get a
    // unique-constraint violation and the user gets the correct balance
    // from the other's successful write.
    const onChainAmount = parseFloat(matchedTx.amount);

    let updatedUser;
    try {
      [, updatedUser] = await prisma.$transaction([
        prisma.deposit.create({
          data: {
            userId: user.id,
            amount: onChainAmount,
            txId: matchedTx.contractId, // unique constraint — dedup key
            status: "CONFIRMED",
          },
        }),
        prisma.user.update({
          where: { id: user.id },
          data: { appBalance: { increment: onChainAmount } },
        }),
      ]);
    } catch (txErr: unknown) {
      // Unique constraint violation = another concurrent request already processed this
      const isUniqueViolation =
        txErr instanceof Error &&
        (txErr.message.includes("Unique constraint") || txErr.message.includes("P2002"));

      if (isUniqueViolation) {
        const freshUser = await prisma.user.findUnique({ where: { id: user.id } });
        return NextResponse.json({ appBalance: (freshUser?.appBalance ?? user.appBalance).toNumber() });
      }
      throw txErr;
    }

    console.log(`[deposit] Confirmed ${onChainAmount} CBTC | updateId: ${updateId}`);
    return NextResponse.json({ appBalance: updatedUser.appBalance.toNumber() });

    } finally {
      activeDeposits.delete(partyId);
    }

  } catch (err) {
    console.error("[deposit] ERROR:", String(err), err instanceof Error ? err.stack : "");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
