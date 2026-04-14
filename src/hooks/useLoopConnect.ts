"use client";

import { useState } from "react";
import { connectLoop, autoConnectLoop } from "@/lib/loop-client";
import { setLoopProvider } from "@/lib/loop-wallet";
import { useWalletStore } from "@/store/wallet-store";

async function createSession(provider: { party_id: string; email?: string; public_key?: string }) {
  const res = await fetch("/api/auth/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      partyId:   provider.party_id,
      email:     provider.email     ?? null,
      publicKey: provider.public_key ?? null,
    }),
  });
  if (!res.ok) throw new Error("Session creation failed");
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
