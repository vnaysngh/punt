/**
 * Server-side Canton / Loop SDK integration.
 * Uses @fivenorth/loop-sdk/server — operator's private key, never sent to browser.
 *
 * Flow:
 *  1. Browser wallet calls transfer() with executionMode:"async" → leaves a
 *     pending TransferInstruction on the ledger
 *  2. Client POSTs memo to /api/deposit/confirm
 *  3. Server calls getPendingTransferInstructions() to find it by memo
 *  4. Server verifies amount >= expected, senderPartyId matches session token
 *  5. Server calls acceptTransferInstruction() to settle on-chain
 *  6. Only then does DB balance get credited
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _loop: any = null;
let _authenticated = false;

async function getLoop() {
  if (!_loop) {
    const sdk = await import("@fivenorth/loop-sdk/server");
    _loop = sdk.loop;
  }
  return _loop;
}

export async function initLoopServer(): Promise<void> {
  if (_authenticated) return;

  const privateKey = process.env.LOOP_PRIVATE_KEY;
  const partyId = process.env.APP_PARTY_ID;
  const network = process.env.NEXT_PUBLIC_LOOP_NETWORK;
  const walletUrl = process.env.LOOP_WALLET_URL || undefined;
  const apiUrl = process.env.LOOP_API_URL || undefined;

  if (!privateKey || !partyId) {
    throw new Error("Missing LOOP_PRIVATE_KEY or APP_PARTY_ID env vars");
  }

  const loop = await getLoop();
  loop.init({
    privateKey,
    partyId,
    ...(network && { network: network as "mainnet" | "devnet" | "local" }),
    ...(walletUrl && { walletUrl }),
    ...(apiUrl && { apiUrl }),
  });
  await loop.authenticate();
  _authenticated = true;
  console.log("[Canton] Server SDK authenticated for party:", partyId);
}

export interface PendingTransferInstruction {
  contractId: string;
  senderPartyId: string;
  receiverPartyId: string;
  amount: string;
  memo: string;
  provider: string;
  expired: boolean;
}

const TRANSFER_INSTRUCTION_INTERFACE_ID =
  "#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction";

/**
 * Fetch all pending TransferInstructions where the app wallet is the receiver.
 * READ-ONLY — no signing.
 *
 * @param includeExpired - If true, also returns expired instructions (for alerting).
 *   The cron uses this to detect unrecoverable deposits (expired before acceptance).
 *   The normal deposit flow should never pass true — expired instructions cannot be accepted.
 */
export async function getPendingTransferInstructions(includeExpired = false): Promise<PendingTransferInstruction[]> {
  await initLoopServer();
  const loop = await getLoop();

  const provider = loop.getProvider();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any[] = await provider.getActiveContracts({
    interfaceId: TRANSFER_INSTRUCTION_INTERFACE_ID,
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw: any[] = Array.isArray(result) ? result : (result as any)?.activeContracts ?? [];

  return raw
    .map((c) => {
      const createdEvent = c.contractEntry?.JsActiveContract?.createdEvent ?? {};
      const contractId: string = createdEvent.contractId ?? c.contractId ?? "";
      const transfer = createdEvent.createArgument?.transfer ?? {};

      const senderPartyId: string = transfer.sender ?? "";
      const receiverPartyId: string = transfer.receiver ?? "";
      const amount: string = String(transfer.amount ?? "0");

      const metaValues: Record<string, string> = transfer?.meta?.values ?? {};
      const memo: string =
        metaValues["splice.lfdecentralizedtrust.org/reason"] ??
        metaValues["memo"] ??
        metaValues["description"] ??
        "";

      // provider for accept URL — comes from createArgument.provider (CBTC provider party)
      // Same field lastgwei uses. Do NOT fallback to instrumentId.admin.
      const provider: string = createdEvent.createArgument?.provider ?? "";

      // Skip expired instructions
      const executeBefore: string = transfer.executeBefore ?? "";
      const expired = executeBefore ? new Date(executeBefore) < new Date() : false;

      return { contractId, senderPartyId, receiverPartyId, amount, memo, provider, expired };
    })
    .filter((t) => t.contractId && t.senderPartyId && t.provider && (includeExpired || !t.expired));
}

/**
 * Get the app wallet's current CBTC balance.
 * Used as a pre-flight check before initiating a withdrawal to fail fast
 * instead of deducting user balance and then discovering the master wallet is empty.
 */
export async function getAppWalletBalance(): Promise<number> {
  await initLoopServer();
  const loop = await getLoop();

  const instrumentId = process.env.NEXT_PUBLIC_CBTC_INSTRUMENT_ID;
  const instrumentAdmin = process.env.NEXT_PUBLIC_CBTC_INSTRUMENT_ADMIN;
  if (!instrumentId || !instrumentAdmin) {
    throw new Error("Missing CBTC instrument env vars");
  }

  try {
    const provider = loop.getProvider();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const holdings: any = await provider.getHoldings({
      instrument: { instrument_id: instrumentId, instrument_admin: instrumentAdmin },
    });
    // holdings is typically { amount: "0.05", ... } or an array
    const raw = Array.isArray(holdings) ? holdings : [holdings];
    const total = raw.reduce((sum: number, h: { amount?: string }) => {
      return sum + parseFloat(h?.amount ?? "0");
    }, 0);
    return isFinite(total) ? total : 0;
  } catch (err) {
    console.warn("[Canton] Could not fetch app wallet balance:", err);
    // Return -1 to signal unknown — caller decides whether to proceed
    return -1;
  }
}

/**
 * Send CBTC from the app wallet to a user's partyId.
 * Used for withdrawals — the inverse of acceptTransferInstruction.
 * Returns the update_id of the settled transaction.
 */
export async function sendTransfer(
  recipientPartyId: string,
  amount: number,
  memo: string
): Promise<string> {
  await initLoopServer();
  const loop = await getLoop();

  // CBTC instrument — must be specified explicitly, otherwise provider.transfer()
  // defaults to CC (Canton Coin / gas token) instead of CBTC.
  // Same values used by DepositModal on the client side.
  const instrumentId = process.env.NEXT_PUBLIC_CBTC_INSTRUMENT_ID;
  const instrumentAdmin = process.env.NEXT_PUBLIC_CBTC_INSTRUMENT_ADMIN;
  if (!instrumentId || !instrumentAdmin) {
    throw new Error(
      "Missing NEXT_PUBLIC_CBTC_INSTRUMENT_ID or NEXT_PUBLIC_CBTC_INSTRUMENT_ADMIN env vars — " +
      "cannot send CBTC withdrawal without specifying the instrument"
    );
  }
  const instrument = { instrument_id: instrumentId, instrument_admin: instrumentAdmin };

  // Pre-flight gas check
  try {
    const dueGas = await loop.checkDueGas();
    if (dueGas?.pending && dueGas?.tracking_id) {
      await loop.payGas(dueGas.tracking_id);
    }
  } catch {
    console.warn("[Canton] Pre-flight gas check failed (non-fatal)");
  }

  // Server-side RpcProvider.transfer() only prepares the payload — it does NOT submit.
  // We must feed the prepared commands into loop.executeTransaction() which handles
  // prepare → sign (with operator private key) → execute on-chain.
  const provider = loop.getProvider();
  const now = new Date();
  const executeBefore = new Date(now.getTime() + 10 * 60 * 1000); // 10 min expiry

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const prepared: any = await provider.transfer(recipientPartyId, String(amount), instrument, {
    memo,
    requestedAt: now.toISOString(),
    executeBefore: executeBefore.toISOString(),
  });

  // prepared is a ConnectTransferResponse: { payload: PreparedTransferPayload }
  // which contains { commands, disclosedContracts, actAs, readAs, synchronizerId, ... }
  const payload = prepared?.payload ?? prepared;

  const result = await loop.executeTransaction({
    commands:                      payload.commands               ?? [],
    disclosedContracts:            payload.disclosedContracts     ?? [],
    packageIdSelectionPreference:  payload.packageIdSelectionPreference ?? [],
    actAs:                         payload.actAs,
    readAs:                        payload.readAs,
    synchronizerId:                payload.synchronizerId,
  });

  // Post-flight gas
  try {
    const dueGas = await loop.checkDueGas();
    if (dueGas?.pending && dueGas?.tracking_id) {
      await loop.payGas(dueGas.tracking_id);
    }
  } catch {
    console.warn("[Canton] Post-transfer gas check failed (non-fatal)");
  }

  const updateId: string = result?.update_id ?? result?.command_id ?? "ok";
  console.log(`[Canton] Sent ${amount} CBTC → ${recipientPartyId} | updateId: ${updateId}`);
  return updateId;
}

/**
 * Accept a pending TransferInstruction on-chain.
 * Signs with the operator private key — settles the CBTC transfer.
 * Returns the update_id of the settled transaction.
 */
export async function acceptTransferInstruction(
  contractId: string,
  providerPartyId: string
): Promise<string> {
  await initLoopServer();
  const loop = await getLoop();

  if (!providerPartyId) throw new Error("Missing providerPartyId");

  const loopApiBase =
    process.env.LOOP_API_URL ??
    (process.env.NEXT_PUBLIC_LOOP_NETWORK === "mainnet"
      ? "https://canton.network"
      : "https://devnet.cantonloop.com");

  const signer = loop.getSigner();
  const userApiKey = loop.session?.userApiKey;

  // Pre-flight gas check
  try {
    const dueGas = await loop.checkDueGas();
    if (dueGas?.pending && dueGas?.tracking_id) {
      await loop.payGas(dueGas.tracking_id);
    }
  } catch {
    console.warn("[Canton] Pre-flight gas check failed (non-fatal)");
  }

  // Step 1: get unsigned transaction hash
  const acceptUrl = `${loopApiBase}/api/v1/token-standard/transfer-instructions/${encodeURIComponent(providerPartyId)}/${encodeURIComponent(contractId)}/accept`;
  const acceptRes = await fetch(acceptUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${userApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (!acceptRes.ok) {
    const err = await acceptRes.text();
    throw new Error(`accept failed: ${acceptRes.status} ${err}`);
  }
  const { transaction_hash } = await acceptRes.json() as { transaction_hash: string };
  if (!transaction_hash) throw new Error("No transaction_hash in accept response");

  // Step 2: sign with operator private key
  const signature = signer.signTransactionHash(transaction_hash);

  // Step 3: execute
  const executeUrl = `${loopApiBase}/api/v1/token-standard/transfer-instructions/execute`;
  const executeRes = await fetch(executeUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${userApiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ signature, transaction_hash }),
  });
  if (!executeRes.ok) {
    const err = await executeRes.text();
    throw new Error(`execute failed: ${executeRes.status} ${err}`);
  }

  const executeData = await executeRes.json() as { status: string; update_id?: string };
  console.log(`[Canton] Accepted transfer ${contractId} → ${executeData.status}`);

  // Post-flight gas
  try {
    const dueGas = await loop.checkDueGas();
    if (dueGas?.pending && dueGas?.tracking_id) {
      await loop.payGas(dueGas.tracking_id);
    }
  } catch {
    console.warn("[Canton] Post-accept gas check failed (non-fatal)");
  }

  return executeData.update_id ?? executeData.status ?? "ok";
}
