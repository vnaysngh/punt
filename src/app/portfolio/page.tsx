"use client";

import { useEffect, useState, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Bitcoin, TrendingUp, TrendingDown, CheckCircle, XCircle,
  Clock, RotateCcw, ArrowDownToLine, Wallet, BarChart3,
} from "lucide-react";
import { useWalletStore } from "@/store/wallet-store";
import { useMarketStore, type Bet } from "@/store/market-store";
import { format } from "date-fns";
import clsx from "clsx";
import DepositModal from "@/components/wallet/DepositModal";
import WalletConnectModal from "@/components/wallet/WalletConnectModal";

export default function PortfolioPage() {
  const { connected, partyId, appBalance } = useWalletStore();
  const { myBets, setMyBets } = useMarketStore();
  const [loading, setLoading] = useState(false);
  const [depositOpen, setDepositOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);

  const fetchBets = useCallback(async () => {
    if (!partyId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/bets?partyId=${partyId}`);
      const data = await res.json();
      setMyBets(Array.isArray(data) ? data : []);
    } catch { /* silent */ } finally { setLoading(false); }
  }, [partyId, setMyBets]);

  useEffect(() => { fetchBets(); }, [fetchBets]);

  const won = myBets.filter((b: Bet) => b.status === "WON");
  const lost = myBets.filter((b: Bet) => b.status === "LOST");
  const pending = myBets.filter((b: Bet) => b.status === "PENDING");
  const totalWagered = myBets.reduce((acc: number, b: Bet) => acc + b.amount, 0);
  const totalWon = won.reduce((acc: number, b: Bet) => acc + (b.payout ?? 0), 0);
  const totalLost = lost.reduce((acc: number, b: Bet) => acc + b.amount, 0);
  const netPnl = totalWon - totalLost;
  const winRate = (won.length + lost.length) > 0 ? (won.length / (won.length + lost.length)) * 100 : 0;

  if (!connected) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-4 text-center relative">
        <div className="fixed inset-0 pointer-events-none">
          <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] rounded-full opacity-[0.04]" style={{ background: "radial-gradient(circle, #8b5cf6 0%, transparent 70%)" }} />
        </div>
        <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }}>
          <div className="w-24 h-24 rounded-3xl flex items-center justify-center mx-auto mb-6" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <Wallet className="w-10 h-10 text-white/15" />
          </div>
          <h2 className="text-3xl font-extrabold text-white mb-2" style={{ fontFamily: "var(--font-syne)" }}>Your Portfolio</h2>
          <p className="text-white/35 text-sm max-w-xs mx-auto mb-8">Connect your wallet to see your bets, P&amp;L, and app balance.</p>
          <button
            onClick={() => setConnectOpen(true)}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl font-bold text-white text-sm transition-all"
            style={{ background: "linear-gradient(135deg, #f97316, #ea580c)", fontFamily: "var(--font-syne)" }}
          >
            <Wallet className="w-4 h-4" />
            Connect Wallet
          </button>
        </motion.div>
        <WalletConnectModal open={connectOpen} onClose={() => setConnectOpen(false)} />
      </div>
    );
  }

  return (
    <div className="min-h-screen relative">
      {/* BG orbs */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-80 -right-40 w-[500px] h-[500px] rounded-full opacity-[0.03]" style={{ background: "radial-gradient(circle, #8b5cf6 0%, transparent 70%)" }} />
      </div>

      <div className="relative max-w-5xl mx-auto px-4 sm:px-6 py-10">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-4xl font-extrabold text-white" style={{ fontFamily: "var(--font-syne)" }}>Portfolio</h1>
          <p className="text-white/35 mt-1.5 text-sm">Your cBTC app balance, bets &amp; P&amp;L</p>
        </motion.div>

        {/* Balance hero */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="relative overflow-hidden rounded-3xl p-6 mb-6"
          style={{
            background: "linear-gradient(135deg, rgba(249,115,22,0.12) 0%, rgba(249,115,22,0.04) 50%, rgba(14,14,26,0.8) 100%)",
            border: "1px solid rgba(249,115,22,0.2)",
          }}
        >
          {/* Glow */}
          <div className="absolute top-0 right-0 w-64 h-64 rounded-full pointer-events-none" style={{ background: "radial-gradient(circle, rgba(249,115,22,0.08) 0%, transparent 70%)", transform: "translate(20%, -40%)" }} />

          <div className="relative">
            <p className="text-white/35 text-xs uppercase tracking-widest font-medium mb-2" style={{ fontFamily: "var(--font-space-mono)" }}>App Wallet Balance</p>
            <div className="flex items-baseline gap-3 mb-1">
              <span className="text-5xl font-extrabold text-white" style={{ fontFamily: "var(--font-space-mono)" }}>
                {appBalance.toFixed(5)}
              </span>
              <span className="text-orange-400 font-bold text-xl">cBTC</span>
            </div>
            <p className="text-white/20 text-xs mb-5">Funds are held in the BetCC app wallet, not your connected wallet</p>
            <button
              onClick={() => setDepositOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl font-bold text-white text-sm transition-all"
              style={{ background: "linear-gradient(135deg, #f97316, #ea580c)", fontFamily: "var(--font-syne)" }}
            >
              <ArrowDownToLine className="w-4 h-4" />
              Deposit cBTC
            </button>
          </div>
        </motion.div>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { label: "Wagered", value: `${totalWagered.toFixed(4)}`, unit: "cBTC", icon: <Bitcoin className="w-4 h-4 text-white/30" />, color: "text-white" },
            { label: "Win Rate", value: `${winRate.toFixed(0)}%`, unit: "", icon: <BarChart3 className="w-4 h-4 text-violet-400" />, color: "text-violet-300" },
            {
              label: "Net P&L",
              value: `${netPnl >= 0 ? "+" : ""}${netPnl.toFixed(4)}`,
              unit: "cBTC",
              icon: netPnl >= 0 ? <TrendingUp className="w-4 h-4 text-green-400" /> : <TrendingDown className="w-4 h-4 text-red-400" />,
              color: netPnl >= 0 ? "text-green-300" : "text-red-300",
            },
            { label: "Active", value: pending.length.toString(), unit: "bets", icon: <Clock className="w-4 h-4 text-orange-400" />, color: "text-orange-300" },
          ].map(({ label, value, unit, icon, color }, i) => (
            <motion.div
              key={label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.04 }}
              className="p-4 rounded-2xl"
              style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.05)" }}
            >
              <div className="flex items-center gap-2 mb-2.5">{icon}<span className="text-white/25 text-[10px] uppercase tracking-widest">{label}</span></div>
              <p className={clsx("font-bold text-sm", color)} style={{ fontFamily: "var(--font-space-mono)" }}>
                {value} <span className="text-white/30 font-normal text-xs">{unit}</span>
              </p>
            </motion.div>
          ))}
        </div>

        {/* Bet history */}
        <div>
          <h2 className="text-white font-bold text-xl mb-4" style={{ fontFamily: "var(--font-syne)" }}>Bet History</h2>

          {loading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-20 rounded-2xl skeleton" style={{ border: "1px solid rgba(255,255,255,0.05)" }} />)}
            </div>
          ) : myBets.length === 0 ? (
            <div className="flex flex-col items-center py-20 text-center">
              <div className="w-16 h-16 rounded-3xl flex items-center justify-center mb-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                <BarChart3 className="w-7 h-7 text-white/15" />
              </div>
              <p className="text-white/40 font-semibold" style={{ fontFamily: "var(--font-syne)" }}>No bets yet</p>
              <p className="text-white/20 text-sm mt-1">Head to Markets and place your first bet</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {myBets.map((bet: Bet, i: number) => {
                const isWon = bet.status === "WON";
                const isLost = bet.status === "LOST";
                const isRefund = bet.status === "REFUNDED";
                return (
                  <motion.div
                    key={bet.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.04 }}
                    className="flex items-center justify-between p-4 rounded-2xl transition-all"
                    style={{
                      background: isWon ? "rgba(34,197,94,0.04)" : isLost ? "rgba(239,68,68,0.04)" : isRefund ? "rgba(59,130,246,0.04)" : "rgba(255,255,255,0.02)",
                      border: isWon ? "1px solid rgba(34,197,94,0.12)" : isLost ? "1px solid rgba(239,68,68,0.12)" : isRefund ? "1px solid rgba(59,130,246,0.1)" : "1px solid rgba(255,255,255,0.05)",
                    }}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{
                          background: isWon ? "rgba(34,197,94,0.1)" : isLost ? "rgba(239,68,68,0.1)" : isRefund ? "rgba(59,130,246,0.1)" : "rgba(255,255,255,0.05)",
                        }}
                      >
                        {isWon ? <CheckCircle className="w-5 h-5 text-green-400" />
                          : isLost ? <XCircle className="w-5 h-5 text-red-400" />
                          : isRefund ? <RotateCcw className="w-5 h-5 text-blue-400" />
                          : <Clock className="w-5 h-5 text-orange-400" />}
                      </div>
                      <div className="min-w-0">
                        <p className="text-white/75 text-sm font-medium truncate" style={{ fontFamily: "var(--font-syne)" }}>
                          {bet.market?.question ?? "Market"}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className={clsx("flex items-center gap-0.5 text-[11px] font-bold", bet.direction === "UP" ? "text-green-400" : "text-red-400")}>
                            {bet.direction === "UP" ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                            {bet.direction}
                          </span>
                          <span className="text-white/15">·</span>
                          <span className="text-white/25 text-[11px]" style={{ fontFamily: "var(--font-space-mono)" }}>
                            {format(new Date(bet.placedAt), "MMM d, HH:mm")}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0 ml-3">
                      <div className="flex items-center gap-1 justify-end">
                        <Bitcoin className="w-3 h-3 text-orange-400/60" />
                        <span className="text-white font-bold text-sm" style={{ fontFamily: "var(--font-space-mono)" }}>{bet.amount.toFixed(4)}</span>
                      </div>
                      {isWon && bet.payout != null && (
                        <p className="text-green-400 text-xs font-bold mt-0.5" style={{ fontFamily: "var(--font-space-mono)" }}>
                          +{(bet.payout - bet.amount).toFixed(4)}
                        </p>
                      )}
                      {isLost && <p className="text-red-400/50 text-xs mt-0.5">lost</p>}
                      {bet.status === "PENDING" && <p className="text-orange-400/50 text-xs mt-0.5">pending</p>}
                      {isRefund && <p className="text-blue-400/50 text-xs mt-0.5">refunded</p>}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <DepositModal open={depositOpen} onClose={() => setDepositOpen(false)} />
    </div>
  );
}
