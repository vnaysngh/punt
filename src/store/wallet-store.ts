import { create } from "zustand";
import { persist } from "zustand/middleware";

export type WalletType = "loop" | "console" | null;

export type WalletState = {
  connected: boolean;
  walletType: WalletType;
  partyId: string | null;
  email: string | null;
  publicKey: string | null;
  appBalance: number;
  sessionToken: string | null;
  connectTrigger: number; // increment to trigger connect from anywhere

  setConnected: (params: {
    walletType: WalletType;
    partyId: string;
    email?: string | null;
    publicKey?: string | null;
    sessionToken?: string;
  }) => void;
  setAppBalance: (balance: number) => void;
  disconnect: () => void;
  handleSessionExpired: () => void;
  requestConnect: () => void;
};

export const useWalletStore = create<WalletState>()(
  persist(
    (set) => ({
      connected: false,
      walletType: null,
      partyId: null,
      email: null,
      publicKey: null,
      appBalance: 0,
      sessionToken: null,
      connectTrigger: 0,

      setConnected: ({ walletType, partyId, email, publicKey, sessionToken }) =>
        set({
          connected: true,
          walletType,
          partyId,
          email:        email     ?? null,
          publicKey:    publicKey ?? null,
          sessionToken: sessionToken ?? null,
        }),

      setAppBalance: (balance) => set({ appBalance: balance }),

      requestConnect: () => set((s) => ({ connectTrigger: s.connectTrigger + 1 })),

      disconnect: () =>
        set({
          connected: false,
          walletType: null,
          partyId: null,
          email: null,
          publicKey: null,
          appBalance: 0,
          sessionToken: null,
        }),

      // Call this whenever an API returns 401 — clears stale session so UI prompts reconnect.
      // Also calls logoutLoop() to reset the Loop SDK singleton so the next connect()
      // triggers the full approve popup (not just autoConnect's cached-session shortcut).
      handleSessionExpired: () => {
        // Dynamic import avoids bundling the "use client" loop-client module server-side.
        // Fire-and-forget — non-fatal if SDK not loaded (e.g. SSR context).
        if (typeof window !== "undefined") {
          import("@/lib/loop-client").then(({ logoutLoop }) => logoutLoop()).catch(() => {});
        }
        set({
          connected: false,
          walletType: null,
          partyId: null,
          email: null,
          publicKey: null,
          appBalance: 0,
          sessionToken: null,
        });
      },
    }),
    {
      name: "betcc-wallet",
      partialize: (state) => ({
        connected:    state.connected,
        walletType:   state.walletType,
        partyId:      state.partyId,
        email:        state.email,
        publicKey:    state.publicKey,
        sessionToken: state.sessionToken,
      }),
    }
  )
);
