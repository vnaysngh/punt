"use client";

import { useState } from "react";
import { connectLoop, autoConnectLoop } from "@/lib/loop-client";
import { setLoopProvider, signMessage } from "@/lib/loop-wallet";
import { useWalletStore } from "@/store/wallet-store";

async function createSession(provider: { party_id: string; email?: string; public_key?: string }) {
  const partyId   = provider.party_id;
  const publicKey = provider.public_key;

  if (!publicKey) throw new Error("Wallet did not provide a public key");

  // Step 1: get a one-time challenge from the server
  const challengeRes = await fetch(`/api/auth/challenge?partyId=${encodeURIComponent(partyId)}`);
  if (!challengeRes.ok) throw new Error("Failed to get auth challenge");
  const { challenge } = await challengeRes.json() as { challenge: string };

  // Step 2: sign the challenge with the Loop wallet private key
  // This triggers the "Signature Request" popup in the Loop wallet
  const signature = await signMessage(challenge);

  // Step 3: send partyId + publicKey + challenge + signature to server
  // Server verifies Ed25519 signature — proves wallet ownership
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      partyId,
      publicKey,
      challenge,
      signature,
      email: provider.email ?? null,
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Session creation failed");
  }
  return res.json() as Promise<{ token: string; appBalance: number }>;
}

export function useLoopConnect() {
  const [connecting, setConnecting] = useState(false);
  const { setConnected } = useWalletStore();

  const connect = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      const provider = await connectLoop();
      setLoopProvider(provider);
      const { token, appBalance } = await createSession(provider);
      setConnected({
        walletType:   "loop",
        partyId:      provider.party_id,
        email:        provider.email     ?? null,
        publicKey:    provider.public_key ?? null,
        sessionToken: token,
      });
      useWalletStore.getState().setAppBalance(appBalance ?? 0);
    } catch {
      // user closed QR or rejected — silently fail
    } finally {
      setConnecting(false);
    }
  };

  const autoConnect = async () => {
    const provider = await autoConnectLoop();
    if (!provider) return;
    // Always restore the in-memory provider — it's lost on every page load
    setLoopProvider(provider);
    // Only create a new session if we don't already have one
    if (useWalletStore.getState().sessionToken) return;
    try {
      const { token, appBalance } = await createSession(provider);
      setConnected({
        walletType:   "loop",
        partyId:      provider.party_id,
        email:        provider.email     ?? null,
        publicKey:    provider.public_key ?? null,
        sessionToken: token,
      });
      useWalletStore.getState().setAppBalance(appBalance ?? 0);
    } catch {
      // auto-connect failed silently
    }
  };

  return { connect, autoConnect, connecting };
}
