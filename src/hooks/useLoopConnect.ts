"use client";

import { useState } from "react";
import { connectLoop, autoConnectLoop } from "@/lib/loop-client";
import { setLoopProvider, signMessage } from "@/lib/loop-wallet";
import { useWalletStore } from "@/store/wallet-store";
import type { LoopProvider } from "@/lib/loop-client";

async function createSession(provider: LoopProvider) {
  const partyId   = provider.party_id;
  const publicKey = provider.public_key;
  if (!publicKey) throw new Error("Wallet did not provide a public key");

  const challengeRes = await fetch(`/api/auth/challenge?partyId=${encodeURIComponent(partyId)}`);
  if (!challengeRes.ok) throw new Error("Failed to get auth challenge");
  const { challenge } = await challengeRes.json() as { challenge: string };

  const signature = await signMessage(challenge);

  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ partyId, publicKey, challenge, signature, email: provider.email ?? null }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string }).error ?? "Session creation failed");
  }
  return res.json() as Promise<{ token: string; appBalance: number }>;
}

export function useLoopConnect() {
  const [connecting, setConnecting]               = useState(false);
  const [verifyOpen, setVerifyOpen]               = useState(false);
  const [pendingProvider, setPendingProvider]     = useState<LoopProvider | null>(null);
  const { setConnected } = useWalletStore();

  const connect = async () => {
    if (connecting) return;
    setConnecting(true);
    try {
      const provider = await connectLoop();
      setLoopProvider(provider);
      // Loop tab has closed — user approved.
      // Now show the "Verify Identity" modal so the user explicitly triggers signing.
      // This avoids the race where signMessage fires before the WS is ready.
      setPendingProvider(provider);
      setVerifyOpen(true);
    } catch (err) {
      console.error("[useLoopConnect] connect failed:", err);
    } finally {
      setConnecting(false);
    }
  };

  // Called when user clicks "Sign to Verify" in the modal
  const handleSign = async () => {
    if (!pendingProvider) throw new Error("No pending provider");
    const { token, appBalance } = await createSession(pendingProvider);
    setConnected({
      walletType:   "loop",
      partyId:      pendingProvider.party_id,
      email:        pendingProvider.email     ?? null,
      publicKey:    pendingProvider.public_key ?? null,
      sessionToken: token,
    });
    useWalletStore.getState().setAppBalance(appBalance ?? 0);
    setVerifyOpen(false);
    setPendingProvider(null);
  };

  const handleVerifyCancel = () => {
    setVerifyOpen(false);
    setPendingProvider(null);
  };

  const autoConnect = async () => {
    const provider = await autoConnectLoop();
    if (!provider) return; // Loop SDK session gone — leave app session intact
    setLoopProvider(provider);
    // Token already in store — returning user, no need to re-sign.
    if (useWalletStore.getState().sessionToken) return;
  };

  return { connect, autoConnect, connecting, verifyOpen, handleSign, handleVerifyCancel };
}
