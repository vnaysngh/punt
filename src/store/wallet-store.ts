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

  setConnected: (params: {
    walletType: WalletType;
    partyId: string;
    email?: string | null;
    publicKey?: string | null;
    sessionToken?: string;
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
      sessionToken: null,

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
