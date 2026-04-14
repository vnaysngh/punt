"use client";

/**
 * In-memory Loop wallet state.
 * Same pattern as lastgwei/src/lib/wallet-store.ts
 *
 * The provider object is a live SDK handle — it cannot be serialized/persisted.
 * We keep it here in module scope and expose pay() so components never touch
 * the provider directly.
 */

import type { LoopProvider } from "@/lib/loop-client";
import { autoConnectLoop } from "@/lib/loop-client";

type State = {
  provider: LoopProvider | null;
};

let _state: State = { provider: null };

export function setLoopProvider(provider: LoopProvider) {
  _state = { provider };
}

export function getLoopProvider(): LoopProvider | null {
  return _state.provider;
}

export function clearLoopProvider() {
  _state = { provider: null };
}


/**
 * Send CBTC via Loop wallet.
 * Matches lastgwei wallet-store pay() — revalidates session before transfer,
 * always passes amount as string, and supports optional instrument.
 */
export async function pay(
  recipient: string,
  amount: string,
  memo: string,
  instrument?: { instrument_admin?: string; instrument_id: string },
): Promise<unknown> {
  if (!_state.provider) {
    throw new Error("Loop wallet not connected. Please reconnect.");
  }

  // Revalidate session — same as lastgwei's revalidateLoop() pattern.
  // The user may have switched accounts or their session may have expired.
  const liveProvider = await autoConnectLoop();
  if (!liveProvider) {
    _state = { provider: null };
    throw new Error("Your Loop wallet session has expired. Please reconnect.");
  }
  // Update provider reference in case token refreshed
  _state = { provider: liveProvider };

  // executionMode: "async" leaves the TransferInstruction pending on-chain
  // for the server to accept (called immediately from frontend after pay).
  return _state.provider.transfer(recipient, amount, instrument, {
    memo,
    executionMode: "async",
  });
}
