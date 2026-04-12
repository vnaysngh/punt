import { create } from "zustand";

export type MarketStatus = "OPEN" | "CLOSED" | "SETTLED" | "CANCELLED";

export type Market = {
  id: string;
  question: string;
  description?: string;
  category: string;
  assetPair: string;
  startPrice: number;
  closePrice?: number;
  direction?: string;
  status: MarketStatus;
  openAt: string;
  closeAt: string;
  settledAt?: string;
  totalUp: number;
  totalDown: number;
};

export type Bet = {
  id: string;
  marketId: string;
  direction: "UP" | "DOWN";
  amount: number;
  payout?: number;
  status: "PENDING" | "WON" | "LOST" | "REFUNDED";
  placedAt: string;
  market?: Market;
};

type MarketStore = {
  markets: Market[];
  myBets: Bet[];
  loading: boolean;
  setMarkets: (markets: Market[]) => void;
  setMyBets: (bets: Bet[]) => void;
  setLoading: (loading: boolean) => void;
  updateMarket: (id: string, data: Partial<Market>) => void;
};

export const useMarketStore = create<MarketStore>((set) => ({
  markets: [],
  myBets: [],
  loading: false,
  setMarkets: (markets) => set({ markets }),
  setMyBets: (myBets) => set({ myBets }),
  setLoading: (loading) => set({ loading }),
  updateMarket: (id, data) =>
    set((state) => ({
      markets: state.markets.map((m) => (m.id === id ? { ...m, ...data } : m)),
    })),
}));
