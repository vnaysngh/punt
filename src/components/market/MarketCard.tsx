"use client";

import { useState, useCallback } from "react";
import { motion } from "framer-motion";
import { TrendingUp, TrendingDown, Bitcoin, Lock } from "lucide-react";
import type { Market } from "@/store/market-store";
import MarketTimer from "./MarketTimer";
import BetModal from "./BetModal";
import { useWalletStore } from "@/store/wallet-store";
import clsx from "clsx";

type Props = {
  market: Market;
  myBetDirection?: "UP" | "DOWN";
  myBetAmount?: number;
  myBetStatus?: string;
  index?: number;
};

export default function MarketCard({ market, myBetDirection, myBetAmount, myBetStatus, index = 0 }: Props) {
  const [betOpen, setBetOpen] = useState(false);
  const [expired, setExpired] = useState(false);
  const { connected, setAppBalance } = useWalletStore();

  const isOpen = market.status === "OPEN" && !expired;
  const isSettled = market.status === "SETTLED";

  const totalPool = market.totalUp + market.totalDown;
  const upPct = totalPool > 0 ? (market.totalUp / totalPool) * 100 : 50;
  const downPct = 100 - upPct;

  const priceChange = isSettled && market.closePrice != null ? market.closePrice - market.startPrice : null;
  const pricePct = priceChange != null && market.startPrice > 0 ? (priceChange / market.startPrice) * 100 : null;

  const handleExpire = useCallback(() => setExpired(true), []);
  const handleBetPlaced = useCallback((b: number) => setAppBalance(b), [setAppBalance]);

  const wonBet = myBetStatus === "WON";
  const lostBet = myBetStatus === "LOST";

  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: index * 0.05, duration: 0.4 }}
        className={clsx(
          "group relative rounded-3xl overflow-hidden transition-all duration-500",
          isOpen
            ? "hover:-translate-y-1 hover:shadow-2xl hover:shadow-black/60"
            : "opacity-80 hover:opacity-100"
        )}
        style={{
          background: "linear-gradient(160deg, #111120 0%, #0d0d1a 100%)",
          border: isOpen
            ? "1px solid rgba(255,255,255,0.08)"
            : wonBet
            ? "1px solid rgba(34,197,94,0.15)"
            : lostBet
            ? "1px solid rgba(239,68,68,0.15)"
            : "1px solid rgba(255,255,255,0.05)",
        }}
      >
        {/* Ambient glow on hover (open markets only) */}
        {isOpen && (
          <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(249,115,22,0.05) 0%, transparent 70%)" }} />
        )}

        {/* Top accent */}
        <div className={clsx(
          "h-px",
          isOpen
            ? "bg-gradient-to-r from-transparent via-orange-500/40 to-transparent"
            : wonBet
            ? "bg-gradient-to-r from-transparent via-green-500/30 to-transparent"
            : lostBet
            ? "bg-gradient-to-r from-transparent via-red-500/30 to-transparent"
            : "bg-gradient-to-r from-transparent via-white/5 to-transparent"
        )} />

        <div className="p-5">
          {/* Header row */}
          <div className="flex items-start justify-between gap-3 mb-5">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className="text-[11px] font-bold px-2 py-0.5 rounded-lg tracking-wider"
                  style={{ background: "rgba(255,255,255,0.06)", color: "rgba(255,255,255,0.4)", border: "1px solid rgba(255,255,255,0.06)", fontFamily: "var(--font-space-mono)" }}
                >
                  {market.assetPair}
                </span>
                {isOpen && (
                  <span className="flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-lg" style={{ background: "rgba(249,115,22,0.1)", color: "#fb923c", border: "1px solid rgba(249,115,22,0.15)" }}>
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-400 pulse-dot" />
                    LIVE
                  </span>
                )}
                {isSettled && (
                  <span className={clsx(
                    "flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-lg",
                  )} style={{
                    background: market.direction === "UP" ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)",
                    color: market.direction === "UP" ? "#4ade80" : "#f87171",
                    border: `1px solid ${market.direction === "UP" ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                  }}>
                    {market.direction === "UP" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {market.direction} WON
                  </span>
                )}
              </div>
              <h3
                className="text-white font-semibold text-[15px] leading-snug line-clamp-2"
                style={{ fontFamily: "var(--font-syne)" }}
              >
                {market.question}
              </h3>
            </div>
            {isOpen && <MarketTimer closeAt={market.closeAt} onExpire={handleExpire} />}
          </div>

          {/* Price row */}
          <div className="grid grid-cols-2 gap-2.5 mb-4">
            <div className="rounded-2xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
              <p className="text-white/30 text-[10px] uppercase tracking-widest mb-1">Open</p>
              <p className="text-white font-bold text-base" style={{ fontFamily: "var(--font-space-mono)" }}>
                ${market.startPrice.toLocaleString()}
              </p>
            </div>
            {isSettled && market.closePrice != null ? (
              <div className="rounded-2xl p-3" style={{
                background: priceChange! >= 0 ? "rgba(34,197,94,0.05)" : "rgba(239,68,68,0.05)",
                border: `1px solid ${priceChange! >= 0 ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)"}`,
              }}>
                <p className="text-white/30 text-[10px] uppercase tracking-widest mb-1">Close</p>
                <div className="flex items-baseline gap-1.5">
                  <p className="text-white font-bold text-base" style={{ fontFamily: "var(--font-space-mono)" }}>
                    ${market.closePrice.toLocaleString()}
                  </p>
                  {pricePct != null && (
                    <span className={clsx("text-xs font-bold", priceChange! >= 0 ? "text-green-400" : "text-red-400")} style={{ fontFamily: "var(--font-space-mono)" }}>
                      {priceChange! >= 0 ? "+" : ""}{pricePct.toFixed(2)}%
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="rounded-2xl p-3" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.05)" }}>
                <p className="text-white/30 text-[10px] uppercase tracking-widest mb-1">Pool</p>
                <div className="flex items-center gap-1">
                  <Bitcoin className="w-3.5 h-3.5 text-orange-400" />
                  <p className="text-white font-bold text-base" style={{ fontFamily: "var(--font-space-mono)" }}>
                    {totalPool.toFixed(4)}
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* UP/DOWN bar */}
          <div className="mb-4">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-1.5">
                <TrendingUp className="w-3.5 h-3.5 text-green-400" />
                <span className="text-green-400 font-bold text-sm" style={{ fontFamily: "var(--font-space-mono)" }}>{upPct.toFixed(0)}%</span>
                <span className="text-white/20 text-xs" style={{ fontFamily: "var(--font-space-mono)" }}>{market.totalUp.toFixed(3)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-white/20 text-xs" style={{ fontFamily: "var(--font-space-mono)" }}>{market.totalDown.toFixed(3)}</span>
                <span className="text-red-400 font-bold text-sm" style={{ fontFamily: "var(--font-space-mono)" }}>{downPct.toFixed(0)}%</span>
                <TrendingDown className="w-3.5 h-3.5 text-red-400" />
              </div>
            </div>
            <div className="h-1.5 rounded-full overflow-hidden flex" style={{ background: "rgba(255,255,255,0.04)" }}>
              <motion.div
                animate={{ width: `${upPct}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="h-full"
                style={{ background: "linear-gradient(90deg, #16a34a, #22c55e)", borderRadius: "4px 0 0 4px" }}
              />
              <motion.div
                animate={{ width: `${downPct}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
                className="h-full"
                style={{ background: "linear-gradient(270deg, #dc2626, #ef4444)", borderRadius: "0 4px 4px 0" }}
              />
            </div>
          </div>

          {/* My bet badge */}
          {myBetDirection && (
            <div
              className="flex items-center justify-between px-3 py-2.5 rounded-xl mb-4"
              style={{
                background: wonBet ? "rgba(34,197,94,0.06)" : lostBet ? "rgba(239,68,68,0.06)" : "rgba(255,255,255,0.04)",
                border: wonBet ? "1px solid rgba(34,197,94,0.15)" : lostBet ? "1px solid rgba(239,68,68,0.15)" : "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: myBetDirection === "UP" ? "#22c55e" : "#ef4444" }} />
                <span className="text-white/50 text-xs font-medium">Your bet</span>
                <span className={clsx("text-xs font-bold", myBetDirection === "UP" ? "text-green-400" : "text-red-400")}>{myBetDirection}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Bitcoin className="w-3 h-3 text-orange-400/60" />
                <span className="text-white/50 text-xs font-bold" style={{ fontFamily: "var(--font-space-mono)" }}>{myBetAmount?.toFixed(4)}</span>
                {myBetStatus && myBetStatus !== "PENDING" && (
                  <span className={clsx("text-[10px] font-bold px-1.5 py-0.5 rounded-md", wonBet ? "text-green-400 bg-green-500/10" : lostBet ? "text-red-400 bg-red-500/10" : "text-blue-400 bg-blue-500/10")}>
                    {myBetStatus}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* CTA */}
          {isOpen && (
            <button
              onClick={() => setBetOpen(true)}
              disabled={!connected}
              className={clsx(
                "w-full py-3 rounded-2xl font-bold text-sm flex items-center justify-center gap-2 transition-all duration-300",
                connected
                  ? "text-white hover:shadow-lg hover:shadow-orange-500/20 active:scale-[0.98]"
                  : "text-white/30 cursor-not-allowed"
              )}
              style={{
                background: connected
                  ? "linear-gradient(135deg, #f97316 0%, #ea580c 100%)"
                  : "rgba(255,255,255,0.04)",
                border: connected ? "none" : "1px solid rgba(255,255,255,0.06)",
                fontFamily: "var(--font-syne)",
              }}
            >
              {!connected && <Lock className="w-3.5 h-3.5" />}
              {connected ? "Place Bet" : "Connect to Bet"}
            </button>
          )}

          {!isOpen && !isSettled && (
            <div className="w-full py-2.5 rounded-2xl text-center text-white/25 text-xs font-medium" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
              Awaiting settlement…
            </div>
          )}
        </div>
      </motion.div>

      <BetModal
        market={market}
        open={betOpen}
        onClose={() => setBetOpen(false)}
        onBetPlaced={handleBetPlaced}
      />
    </>
  );
}
