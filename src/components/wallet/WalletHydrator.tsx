"use client";

import { useEffect } from "react";
import { useWalletStore } from "@/store/wallet-store";

// Rehydrates the wallet store from localStorage on first client render,
// then re-fetches the live app balance from the DB.
export default function WalletHydrator() {
  useEffect(() => {
    // Trigger zustand persist rehydration
    useWalletStore.persist.rehydrate();
  }, []);

  useEffect(() => {
    const unsub = useWalletStore.subscribe(async (state) => {
      // Once rehydrated and connected, fetch fresh balance from DB
      if (state.connected && state.partyId) {
        try {
          const res = await fetch(`/api/users?partyId=${state.partyId}`);
          if (res.ok) {
            const data = await res.json();
            if (typeof data.appBalance === "number") {
              useWalletStore.getState().setAppBalance(data.appBalance);
            }
          }
        } catch { /* silent */ }
        // Only need to do this once
        unsub();
      }
    });
    return () => unsub();
  }, []);

  return null;
}
