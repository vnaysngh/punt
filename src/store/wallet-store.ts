import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LoopProvider } from "@/lib/loop";

export type WalletType = "loop" | "console" | null;

export type WalletState = {
  connected: boolean;
  walletType: WalletType;
  partyId: string | null;
  email: string | null;
  publicKey: string | null;
  appBalance: number; // cBTC in app wallet
  loopProvider: LoopProvider | null;

  // actions
  setConnected: (params: {
    walletType: WalletType;
    partyId: string;
    email?: string;
    publicKey?: string;
    loopProvider?: LoopProvider;
  }) => void;
  setAppBalance: (balance: number) => void;
  disconnect: () => void;
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
      loopProvider: null,

      setConnected: ({ walletType, partyId, email, publicKey, loopProvider }) =>
        set({
          connected: true,
          walletType,
          partyId,
          email: email ?? null,
          publicKey: publicKey ?? null,
          loopProvider: loopProvider ?? null,
        }),

      setAppBalance: (balance) => set({ appBalance: balance }),

      disconnect: () =>
        set({
          connected: false,
          walletType: null,
          partyId: null,
          email: null,
          publicKey: null,
          appBalance: 0,
          loopProvider: null,
        }),
    }),
    {
      name: "betcc-wallet",
      partialize: (state) => ({
        connected: state.connected,
        walletType: state.walletType,
        partyId: state.partyId,
        email: state.email,
        publicKey: state.publicKey,
      }),
    }
  )
);
